from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import openai
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import settings
from app.core.time_utils import to_naive_utc
from app.db.models import ChatMessage, ChatRole, ChatSession, Engagement, EngagementCategory
from app.schemas.chat import BusyEngagementInfo, ConflictInfo, EngagementAction, EngagementActionType
from app.schemas.engagement import EngagementCreate, EngagementRead, EngagementUpdate
from app.schemas.schedule import FreeSlotItem
from app.services import engagement_service
from app.services.engagement_service import EngagementConflictError, EngagementNotFoundError
from app.services.schedule_service import find_conflicting_engagement, resolve_free_slots_for_range

logger = logging.getLogger(__name__)


class ChatServiceError(Exception):
    """Raised when a chat turn cannot complete.

    Carries an HTTP status code so the endpoint layer can translate it
    directly into an `HTTPException` without re-deriving intent.
    """

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class ChatTurnResult:
    session_id: UUID
    reply: str
    actions: List[EngagementAction] = field(default_factory=list)
    free_slots: List[FreeSlotItem] = field(default_factory=list)
    busy_engagements: List[BusyEngagementInfo] = field(default_factory=list)
    conflict: Optional[ConflictInfo] = None


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_engagement",
            "description": (
                "Create a new calendar engagement (meeting, interview, office hours, or personal "
                "appointment). If no explicit duration or end time is stated, assume a 1-hour "
                "duration. Set is_blocking=true for essentially every real commitment — meetings, "
                "interviews, standups/DSUs, calls, appointments all occupy the calendar. Only use "
                "is_blocking=false for something explicitly informational that doesn't reserve the "
                "person's time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "start_time": {
                        "type": "string",
                        "description": (
                            "The clock digits EXACTLY as the user said them — a straight transcription, "
                            "not a conversion. NO UTC offset, e.g. '2026-08-11T15:00:00' for 'tomorrow at "
                            "3pm'. If they said '10am EST', write 10:00 here (not whatever 10am EST would "
                            "be in your own or the user's zone) — `timezone` below is what carries the "
                            "zone those digits belong to; that's its only job. Never do the arithmetic to "
                            "shift these digits into another zone yourself, in either direction."
                        ),
                    },
                    "end_time": {
                        "type": "string",
                        "description": "Clock digits exactly as stated, no UTC offset — same rules as start_time.",
                    },
                    "timezone": {
                        "type": "string",
                        "description": (
                            "IANA name of whichever zone the start_time/end_time digits above were "
                            "actually spoken in. Defaults to the user's own timezone (given in the "
                            "system prompt) when they named no zone at all. When they DID name a zone "
                            "for this event (an abbreviation, UTC offset, or city/region), this must be "
                            "THAT zone, resolved to its IANA name — EST/EDT = America/New_York, CST/CDT "
                            "= America/Chicago, MST/MDT = America/Denver, PST/PDT = America/Los_Angeles "
                            "— paired with the UNCONVERTED digits above. Example: user's own zone is "
                            "Asia/Karachi and they say '10am EST' — start_time='...T10:00:00' (10, not "
                            "converted to any other hour) and timezone='America/New_York' (the zone they "
                            "named, not the user's own). Getting either half of this pair wrong — "
                            "converting the digits AND keeping the original zone name, or vice versa — "
                            "double-converts or under-converts and lands on the wrong instant."
                        ),
                    },
                    "weekday": {
                        "type": "string",
                        "enum": [
                            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                        ],
                        "description": (
                            "Set this ONLY when the user named a bare day-of-week with no explicit "
                            "calendar date ('Monday', 'next Friday', 'this Saturday') — NOT for an "
                            "explicit date, 'today', or 'tomorrow' (leave unset for those; resolve them "
                            "yourself as usual, that arithmetic is simple and reliable). When set, the "
                            "app — not you — computes which exact date that weekday falls on; the date "
                            "digits you wrote in start_time/end_time above are discarded and only their "
                            "clock time is kept, so don't worry about getting the date right there."
                        ),
                    },
                    "weekday_qualifier": {
                        "type": "string",
                        "enum": ["soonest", "next"],
                        "description": (
                            "Only meaningful alongside `weekday`. 'soonest' (the default — omit this "
                            "field to get it) resolves to the nearest occurrence of that weekday, "
                            "counting today itself if today already is that weekday. Set to 'next' only "
                            "when the user explicitly used the word 'next' (e.g. 'next Monday') — that "
                            "always skips ahead one more week, even if this week's occurrence hasn't "
                            "happened yet."
                        ),
                    },
                    "category": {"type": "string", "enum": [c.value for c in EngagementCategory]},
                    "is_blocking": {"type": "boolean"},
                },
                "required": ["title", "start_time", "end_time", "category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_engagement",
            "description": "Edit an existing engagement. Only include the fields that are changing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "engagement_id": {"type": "string", "description": "UUID of the engagement to update."},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "start_time": {
                        "type": "string",
                        "description": "Clock digits exactly as stated, no UTC offset — see create_engagement.",
                    },
                    "end_time": {
                        "type": "string",
                        "description": "Clock digits exactly as stated, no UTC offset — see create_engagement.",
                    },
                    "timezone": {
                        "type": "string",
                        "description": "IANA zone the start_time/end_time digits are in — see create_engagement. Only needed when start_time or end_time is being changed.",
                    },
                    "weekday": {
                        "type": "string",
                        "enum": [
                            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                        ],
                        "description": "Set only when moving this to a bare day-of-week with no explicit date — see create_engagement.",
                    },
                    "weekday_qualifier": {
                        "type": "string",
                        "enum": ["soonest", "next"],
                        "description": "Only meaningful alongside `weekday` — see create_engagement.",
                    },
                    "category": {"type": "string", "enum": [c.value for c in EngagementCategory]},
                    "is_blocking": {"type": "boolean"},
                },
                "required": ["engagement_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_engagement",
            "description": "Permanently remove an engagement from the calendar.",
            "parameters": {
                "type": "object",
                "properties": {
                    "engagement_id": {"type": "string", "description": "UUID of the engagement to delete."},
                },
                "required": ["engagement_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_engagements",
            "description": (
                "Look up existing engagements — both to answer any question about what's on the "
                "calendar (e.g. 'do I have anything today', 'what's my schedule tomorrow') and to "
                "resolve references like 'that meeting' or 'the interview tomorrow' before an "
                "update/delete. Never guess an id.\n\n"
                "For 'what's my next/most upcoming engagement' — set start_after to the reference "
                "datetime (now), leave descending false, and limit to 1; the earliest match at or "
                "after now is the soonest one. For 'what's my most recent/last engagement' (the most "
                "recently PAST one) — set start_before to the reference datetime, descending true, "
                "and limit to 1; without descending true you'd get the oldest engagement in history "
                "instead of the latest past one. Never answer either question from an engagement "
                "already mentioned earlier in this conversation — always issue this exact fresh call, "
                "since 'next' and 'most recent' are relative to the current moment, not to whatever "
                "was last discussed.\n\n"
                "Call this fresh every time, even if this same conversation already listed "
                "engagements earlier — the user can add, edit, or delete things outside this chat "
                "(directly in the app) between messages, so an earlier tool result in this "
                "conversation is not reliable evidence of the current state. Only skip the lookup "
                "when you already learned the specific engagement_id you need earlier in this same "
                "conversation and nothing about that engagement is in question.\n\n"
                "title_contains is a literal substring match against the stored title — it does NOT "
                "understand synonyms, and the user's own words for the category (e.g. calling it 'the "
                "interview') may not match what it was actually saved as (e.g. 'Meeting with Faraz'). "
                "Search on the most distinctive fragment only — typically a person's name or a unique "
                "word — never the user's full phrase, and never a category/type word alone. If a "
                "search comes back empty, retry once with a shorter or different fragment (or omit "
                "title_contains and use the date filters alone) before telling the user it can't be "
                "found."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title_contains": {
                        "type": "string",
                        "description": (
                            "A short, distinctive substring of the title (e.g. a name) — not the "
                            "user's full sentence, and not a category word they may have gotten wrong."
                        ),
                    },
                    "start_after": {
                        "type": "string",
                        "description": "ISO-8601 timestamp, inclusive lower bound on start_time.",
                    },
                    "start_before": {
                        "type": "string",
                        "description": "ISO-8601 timestamp, inclusive upper bound on start_time.",
                    },
                    "limit": {"type": "integer"},
                    "descending": {
                        "type": "boolean",
                        "description": (
                            "False (default) returns the earliest matches first — use for 'next/"
                            "upcoming' queries. True returns the latest matches first — use for "
                            "'most recent/last' queries, otherwise limit would keep the oldest "
                            "results instead of the newest."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_free_slots",
            "description": (
                "Find open time slots within the user's working hours over a date range. The app "
                "renders the returned slots itself as a visual list, including what's occupying the "
                "busy stretches — don't itemize them again in your reply.\n\n"
                "date_from/date_to must match only the scope the user actually asked for — never "
                "pad or widen it. 'today' -> date_from == date_to == today. 'tomorrow' -> both == "
                "tomorrow. 'this week' -> today through the end of this week. 'next 3 days' -> today "
                "through today+2. An explicit date/weekday -> that single day (date_from == "
                "date_to). If the user gave no range at all, default to today only — do not assume "
                "a multi-day window they didn't ask for."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date_from": {
                        "type": "string",
                        "description": "YYYY-MM-DD. The first day of exactly the range the user asked for.",
                    },
                    "date_to": {
                        "type": "string",
                        "description": (
                            "YYYY-MM-DD. The last day of exactly the range the user asked for — equal to "
                            "date_from for a single-day request such as 'today' or 'tomorrow'."
                        ),
                    },
                    "min_duration_minutes": {"type": "integer"},
                },
                "required": ["date_from", "date_to"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_availability",
            "description": (
                "Deterministically check whether the user is free for a SPECIFIC time window — "
                "use this for any yes/no availability question ('am I available at X', 'are you "
                "free Tuesday at 3pm', 'can I do a 1-hour call at 2pm EST on the 10th'). Never "
                "answer a question like this yourself by eyeballing check_free_slots or "
                "list_engagements results — manually comparing a specific time against a list of "
                "busy stretches is exactly the kind of exact computation that's unreliable to do "
                "by reading, not calculating (the same reason weekday and timezone math are "
                "handled deterministically elsewhere). This tool does the exact overlap check in "
                "code and returns a definitive available: true/false — if false, exactly which "
                "existing engagement conflicts, plus that day's free slots so you can suggest "
                "alternatives without a second call.\n\n"
                "If the user gave a duration instead of an explicit end time (e.g. 'free for an "
                "hour at 2pm'), compute end_time yourself as start_time + that duration."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_time": {
                        "type": "string",
                        "description": "Clock digits exactly as stated, no UTC offset — see create_engagement.",
                    },
                    "end_time": {
                        "type": "string",
                        "description": "Clock digits exactly as stated, no UTC offset — see create_engagement.",
                    },
                    "timezone": {
                        "type": "string",
                        "description": "IANA zone the digits above are in — see create_engagement.",
                    },
                    "weekday": {
                        "type": "string",
                        "enum": [
                            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                        ],
                        "description": "Set only for a bare day-of-week with no explicit date — see create_engagement.",
                    },
                    "weekday_qualifier": {
                        "type": "string",
                        "enum": ["soonest", "next"],
                        "description": "Only meaningful alongside `weekday` — see create_engagement.",
                    },
                },
                "required": ["start_time", "end_time"],
            },
        },
    },
]


def _build_system_prompt(reference_datetime: datetime, timezone_name: str) -> str:
    return (
        "You are a scheduling assistant that manages the user's calendar through natural "
        "conversation. Use the provided tools to create, edit, delete, and look up engagements, "
        "and to check free time slots — never claim to have done something without calling the "
        "matching tool. For any direct yes/no availability question about a SPECIFIC time window "
        "('am I free at X', 'are you available Tuesday at 3pm', 'can I do an hour at 2pm EST') "
        "always call check_availability rather than answering it yourself from check_free_slots "
        "or list_engagements results — deciding whether one specific time overlaps a list of busy "
        "stretches is exact computation you get wrong often enough to be untrustworthy (it has "
        "cited an unrelated engagement hours away and declared the user busy at a time that was "
        "actually free), the same failure mode as weekday and timezone arithmetic below. Use "
        "check_free_slots instead only for open-ended browsing ('what's free this week', 'find me "
        "an hour tomorrow') where there's no single specific time to check. The user can also add, "
        "edit, or delete engagements directly in the app "
        "outside this chat, at any point — so never answer a question about their current "
        "schedule, availability, or whether a specific engagement still exists from memory of an "
        "earlier list_engagements/check_free_slots result in this same conversation; always call "
        "the tool again first, even if you answered the same question a moment ago. Resolve "
        "relative date expressions (e.g. 'today', 'tomorrow', an explicit date) yourself using "
        "the reference datetime below as 'now' — that's simple day-count arithmetic. A bare "
        "day-of-week with no explicit date ('Monday', 'next Tuesday') is different and mandatory "
        "to handle specially: before every single create_engagement/update_engagement call, check "
        "whether the user named a day-of-week with no explicit date for it, and if so you MUST set "
        "that tool's `weekday` field — there is no case where computing the date yourself instead "
        "is acceptable. This isn't a suggestion to prefer when convenient; skipping it is a "
        "correctness bug, and it is the single most common way this app books an event on the "
        "wrong day. DO NOT compute which calendar date the named weekday falls on yourself, even "
        "as a fallback value written into start_time/end_time — weekday arithmetic is exactly the "
        "kind of exact computation you get wrong often enough to be untrustworthy for this (a "
        "plain 'Monday' has been booked several days off, once landing on a Saturday). What you "
        "write in start_time/end_time's date portion in that case doesn't matter at all — the app "
        "discards it — so there's no reason not to set `weekday`; only the clock digits you write "
        "there survive. Timestamps that tools "
        "return to you (engagements, free slots) are already in the user's local timezone (given "
        "below), each with that zone's own UTC offset — read the wall-clock digits directly when "
        "describing them, no conversion needed.\n\n"
        "For create_engagement/update_engagement, give start_time/end_time as the clock digits "
        "EXACTLY as the user stated them, with NO UTC offset — a transcription, not a conversion. "
        "Pass the separate `timezone` field naming whichever IANA zone those exact digits belong "
        "to: the user's own timezone (given below) by default, or the specific zone they "
        "explicitly named for that event otherwise (an abbreviation, UTC offset, or city/region — "
        "resolve it to its IANA name yourself, e.g. EST/EDT = America/New_York). Do the zone "
        "lookup, but never the arithmetic — don't shift the digits into another zone by hand in "
        "either direction, and don't figure out what the equivalent time would be in the user's "
        "own zone and pass THAT instead. Example: user's own zone is Asia/Karachi and they say "
        "'10am EST' — start_time gets '...T10:00:00' (10 untouched, not converted to any other "
        "hour) and timezone gets 'America/New_York' (the zone they actually named, not the user's "
        "own) — the app converts that pair to the correct absolute instant deterministically. "
        "Mixing the two — converted digits paired with the original zone name, or vice versa — "
        "silently lands on the wrong instant (and often the wrong calendar day too).\n\n"
        "When the user refers to an existing engagement ('that meeting', 'the interview'), "
        "resolve it via list_engagements (or an id you already learned earlier in this "
        "conversation) before calling update_engagement or delete_engagement — never guess an id. "
        "After completing the requested actions, reply with a brief, natural confirmation of what "
        "changed; don't narrate tool mechanics. After check_free_slots, keep the reply to a short "
        "sentence or two (e.g. how many days had openings, or anything notable) — the app displays "
        "the actual slot list as its own widget, so don't repeat it in prose.\n\n"
        "If create_engagement/update_engagement comes back with a scheduling conflict, or "
        "check_availability returns available: false, the tool result already includes that same "
        "day's free/busy schedule — the app renders it as a visual widget with the conflicting "
        "engagement highlighted, right alongside your reply. Don't ask the user whether they'd "
        "like you to check availability; that's already done. Just state plainly, in one or two "
        "sentences, what conflicted with what (name both engagements and the overlapping time), "
        "and that they can pick one of the open times shown below — don't itemize the slots "
        "yourself. If check_availability instead returns available: true, the app still renders "
        "that day's schedule as a widget confirming it — just state plainly, in one sentence, that "
        "the requested time is free; don't itemize the day's other engagements yourself.\n\n"
        f"Reference datetime (the user's current local time), treat this as 'now': "
        f"{reference_datetime.isoformat()} ({timezone_name})."
    )


def _resolve_timezone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ChatServiceError(f"Unknown timezone: {timezone_name!r}", status_code=400) from exc


def _resolve_session(session: Session, chat_session_id: Optional[UUID]) -> ChatSession:
    if chat_session_id is None:
        chat_session = ChatSession()
        session.add(chat_session)
        session.commit()
        session.refresh(chat_session)
        return chat_session

    chat_session = session.get(ChatSession, chat_session_id)
    if chat_session is None:
        raise ChatServiceError(f"Unknown session_id: {chat_session_id}", status_code=404)
    return chat_session


def _replay_messages(session: Session, chat_session_id: UUID) -> List[dict]:
    rows = session.exec(
        select(ChatMessage)
        .where(ChatMessage.session_id == chat_session_id)
        .order_by(ChatMessage.id)
    ).all()

    messages: List[dict] = []
    for row in rows:
        if row.role == ChatRole.USER:
            messages.append({"role": "user", "content": row.content})
        elif row.role == ChatRole.ASSISTANT:
            if row.tool_calls_json:
                messages.append(
                    {
                        "role": "assistant",
                        "content": row.content,
                        "tool_calls": json.loads(row.tool_calls_json),
                    }
                )
            else:
                messages.append({"role": "assistant", "content": row.content})
        elif row.role == ChatRole.TOOL:
            messages.append(
                {"role": "tool", "tool_call_id": row.tool_call_id, "content": row.content}
            )
    return messages


def _parse_uuid(value: object) -> Optional[UUID]:
    if not value:
        return None
    try:
        return UUID(str(value))
    except (ValueError, AttributeError):
        return None


def _parse_optional_datetime(value: object) -> Optional[datetime]:
    """Parse a tool-supplied ISO timestamp for a `list_engagements` bound.

    Normalized through `to_naive_utc` for the same reason create/update
    payloads are: `Engagement.start_time` is stored naive UTC, and SQLite
    compares datetimes as text — an offset-aware value (e.g. the model's own
    local-zone reference datetime, "...+05:00") sorts wrong against those
    naive strings unless it's stripped to plain UTC first. Left aware, a
    query like "everything after now" can silently drop rows that are
    genuinely after now, because their naive UTC text sorts lower than the
    offset-bearing bound's text.
    """
    if not value:
        return None
    try:
        return to_naive_utc(datetime.fromisoformat(str(value)))
    except ValueError:
        return None


def _resolve_event_timezone(tz_name: object, default_tzinfo: ZoneInfo) -> ZoneInfo:
    """The zone an engagement's start_time/end_time digits are stated in.

    Falls back to the user's own reference timezone when the model omitted
    `timezone` (the common case — most events are in the user's own zone) or
    named something `zoneinfo` doesn't recognize, rather than failing the
    whole request over a bad zone name.
    """
    if isinstance(tz_name, str) and tz_name:
        try:
            return ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            pass
    return default_tzinfo


def _localize_tool_datetime(value: object, event_tzinfo: ZoneInfo) -> object:
    """Attach the resolved event timezone to a model-supplied local clock time.

    The model is asked for bare wall-clock digits (no offset) plus a
    separate IANA `timezone` name — `zoneinfo` then does the actual
    DST-aware UTC conversion deterministically, rather than asking the model
    to compute a UTC offset itself. That arithmetic (especially across an
    unusual pair like PKT and a US zone, with its own date-rollover) is
    exactly the kind of exact computation LLMs get wrong often enough to be
    untrustworthy for something that would otherwise silently corrupt a
    stored time. A value that already carries its own offset — the model
    ignoring instructions — is left untouched rather than double-converted.
    """
    if not isinstance(value, str) or not value:
        return value
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return value
    if parsed.tzinfo is not None:
        return value
    return parsed.replace(tzinfo=event_tzinfo).isoformat()


_WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def _resolve_weekday_date(reference_date: date, weekday_name: object, qualifier: object) -> date:
    """Deterministically resolve a bare day-of-week (e.g. 'monday') to a concrete date.

    Weekday arithmetic is exactly the kind of exact computation the model
    gets wrong often enough to be untrustworthy (mirrors the timezone-offset
    problem) — a request for a plain 'Monday' has landed on a Saturday five
    days later. Doing it here instead makes that class of bug structurally
    impossible. 'soonest' (the default) counts today itself if today already
    matches; 'next' always skips ahead one more week, for when the user
    explicitly said the word 'next'.
    """
    target = _WEEKDAY_INDEX.get(str(weekday_name).strip().lower())
    if target is None:
        raise ValueError(f"Unknown weekday: {weekday_name!r}")
    days_ahead = (target - reference_date.weekday()) % 7
    resolved = reference_date + timedelta(days=days_ahead)
    if str(qualifier).strip().lower() == "next":
        resolved += timedelta(days=7)
    return resolved


def _apply_weekday_override(value: object, resolved_date: date) -> object:
    """Replace the date portion of a model-supplied local datetime string with
    a deterministically-resolved date, keeping only its clock digits.

    Used whenever the model set `weekday` — its own guess at which calendar
    date that weekday falls on (baked into start_time/end_time as ordinary
    ISO digits) is discarded in favor of the code-computed date from
    `_resolve_weekday_date`; only the hour/minute/second survive. The model
    quite reasonably sometimes writes bare clock digits with no date at all
    here (since it knows `weekday` governs the date) — handle that directly
    rather than letting it fall through to a hard Pydantic validation error,
    which has been observed to make a retry abandon `weekday` altogether and
    land on the wrong day anyway.
    """
    if not isinstance(value, str) or not value:
        return value
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.replace(year=resolved_date.year, month=resolved_date.month, day=resolved_date.day).isoformat()
    except ValueError:
        pass
    try:
        parsed_time = dt_time.fromisoformat(value)
    except ValueError:
        return value
    return datetime.combine(resolved_date, parsed_time).isoformat()


def _utc_to_local_iso(value: datetime, tzinfo: ZoneInfo) -> str:
    """Convert a naive UTC datetime to an ISO string in the user's local zone.

    Stored/returned start_time and end_time are naive datetimes that the rest
    of the app treats as UTC by convention. Tagging them with just a "+00:00"
    offset and asking the model to do the hour-shift arithmetic itself turned
    out to be unreliable in practice (it echoed the UTC digits unconverted,
    reporting a 6 PM–9 PM local shift as "1 PM to 4 PM"). Converting here
    means the model only has to read off already-correct local wall-clock
    digits, no arithmetic required.
    """
    return value.replace(tzinfo=timezone.utc).astimezone(tzinfo).isoformat()


def _localize_engagement(engagement_dump: dict, tzinfo: ZoneInfo) -> dict:
    for key in ("start_time", "end_time"):
        if engagement_dump.get(key):
            engagement_dump[key] = _utc_to_local_iso(datetime.fromisoformat(engagement_dump[key]), tzinfo)
    return engagement_dump


ToolResult = Tuple[dict, Optional[EngagementAction], List[FreeSlotItem], List[BusyEngagementInfo], Optional[ConflictInfo]]


def _fetch_day_schedule(
    session: Session, local_day: date, tzinfo: ZoneInfo
) -> Tuple[List[FreeSlotItem], List[BusyEngagementInfo]]:
    """That day's free slots and busy engagements, in the user's local zone —
    shared by the conflict and availability-confirmed result builders below
    (both want the same "here's the whole day for context" widget data)."""
    range_result = resolve_free_slots_for_range(
        session, date_from=local_day, date_to=local_day, min_duration_minutes=30,
    )
    free_slots = [
        FreeSlotItem(
            start_time=_utc_to_local_iso(slot.start, tzinfo),
            end_time=_utc_to_local_iso(slot.end, tzinfo),
            duration_minutes=int((slot.end - slot.start).total_seconds() // 60),
        )
        for slot in range_result.slots[:20]
    ]
    busy_engagements = [
        BusyEngagementInfo(
            title=engagement.title,
            category=engagement.category,
            start_time=_utc_to_local_iso(engagement.start_time, tzinfo),
            end_time=_utc_to_local_iso(engagement.end_time, tzinfo),
        )
        for engagement in range_result.blocking_engagements[:50]
    ]
    return free_slots, busy_engagements


def _build_conflict_result(session: Session, exc: EngagementConflictError, tzinfo: ZoneInfo) -> ToolResult:
    """On a scheduling conflict, don't just report failure — also compute
    that day's free slots and busy engagements (as if the model had called
    check_free_slots itself) so the app renders the same visual widget right
    away, plus structured info identifying exactly which existing engagement
    is in the way, so the UI can highlight it instead of relying on prose.
    """
    attempted_title = exc.attempted_title
    attempted_start_utc = exc.attempted_start
    attempted_end_utc = exc.attempted_end
    if attempted_title is None or attempted_start_utc is None or attempted_end_utc is None:
        return {"status": "error", "message": str(exc)}, None, [], [], None

    local_day = attempted_start_utc.replace(tzinfo=timezone.utc).astimezone(tzinfo).date()
    free_slots, busy_engagements = _fetch_day_schedule(session, local_day, tzinfo)

    conflicting: Optional[Engagement] = exc.conflicting_engagement
    if conflicting is not None:
        conflict_info = ConflictInfo(
            available=False,
            attempted_title=attempted_title,
            attempted_start_time=_utc_to_local_iso(attempted_start_utc, tzinfo),
            attempted_end_time=_utc_to_local_iso(attempted_end_utc, tzinfo),
            conflicting_with=BusyEngagementInfo(
                title=conflicting.title,
                category=conflicting.category,
                start_time=_utc_to_local_iso(conflicting.start_time, tzinfo),
                end_time=_utc_to_local_iso(conflicting.end_time, tzinfo),
            ),
        )
        message = (
            f"'{attempted_title}' ({_utc_to_local_iso(attempted_start_utc, tzinfo)} to "
            f"{_utc_to_local_iso(attempted_end_utc, tzinfo)}) conflicts with existing engagement "
            f"'{conflicting.title}' ({conflict_info.conflicting_with.start_time.isoformat()} to "
            f"{conflict_info.conflicting_with.end_time.isoformat()})."
        )
    else:
        conflict_info = None
        message = str(exc)

    result = {
        "status": "error",
        "message": message,
        "free_slots_that_day": [item.model_dump(mode="json") for item in free_slots],
    }
    return result, None, free_slots, busy_engagements, conflict_info


def _build_availability_result(
    session: Session, title: str, start_utc: datetime, end_utc: datetime, tzinfo: ZoneInfo
) -> ToolResult:
    """check_availability found nothing in the way — still surface that day's
    schedule for context and a structured confirmation (available=True), so
    the UI renders a definitive "you're free" widget rather than only prose.
    """
    local_day = start_utc.replace(tzinfo=timezone.utc).astimezone(tzinfo).date()
    free_slots, busy_engagements = _fetch_day_schedule(session, local_day, tzinfo)
    availability_info = ConflictInfo(
        available=True,
        attempted_title=title,
        attempted_start_time=_utc_to_local_iso(start_utc, tzinfo),
        attempted_end_time=_utc_to_local_iso(end_utc, tzinfo),
        conflicting_with=None,
    )
    result = {"status": "ok", "available": True}
    return result, None, free_slots, busy_engagements, availability_info


def _apply_weekday_args(
    start_value: object, end_value: object, weekday: object, qualifier: object, reference_datetime: datetime
) -> Tuple[object, object]:
    """If `weekday` was set, override start/end's date with the deterministically
    resolved one, then fix up overnight rollover (an event whose resolved end
    clock time isn't after its start clock time crosses midnight, so its date
    needs to land one day later than the start's).
    """
    if not weekday:
        return start_value, end_value

    resolved_date = _resolve_weekday_date(reference_datetime.date(), weekday, qualifier)
    start_value = _apply_weekday_override(start_value, resolved_date)
    end_value = _apply_weekday_override(end_value, resolved_date)

    if isinstance(start_value, str) and isinstance(end_value, str):
        try:
            parsed_start = datetime.fromisoformat(start_value)
            parsed_end = datetime.fromisoformat(end_value)
        except ValueError:
            return start_value, end_value
        if parsed_end <= parsed_start:
            end_value = (parsed_end + timedelta(days=1)).isoformat()

    return start_value, end_value


def _execute_tool(session: Session, tool_call, tzinfo: ZoneInfo, reference_datetime: datetime) -> ToolResult:
    name = tool_call.function.name
    try:
        args = json.loads(tool_call.function.arguments or "{}")
    except json.JSONDecodeError as exc:
        return {"status": "error", "message": f"Malformed arguments: {exc}"}, None, [], [], None

    try:
        if name == "create_engagement":
            event_tzinfo = _resolve_event_timezone(args.get("timezone"), tzinfo)
            start_value, end_value = _apply_weekday_args(
                args["start_time"], args["end_time"], args.get("weekday"), args.get("weekday_qualifier"),
                reference_datetime,
            )
            payload = EngagementCreate(
                title=args["title"],
                description=args.get("description"),
                start_time=_localize_tool_datetime(start_value, event_tzinfo),
                end_time=_localize_tool_datetime(end_value, event_tzinfo),
                category=args["category"],
                is_blocking=args.get("is_blocking", True),
            )
            try:
                engagement = engagement_service.create_engagement(session, payload)
            except EngagementConflictError as exc:
                return _build_conflict_result(session, exc, tzinfo)
            action = EngagementAction(
                type=EngagementActionType.CREATED,
                engagement=EngagementRead.model_validate(engagement),
            )
            result = {"status": "ok", "engagement": _localize_engagement(action.engagement.model_dump(mode="json"), tzinfo)}
            return result, action, [], [], None

        if name == "update_engagement":
            engagement_id = _parse_uuid(args.get("engagement_id"))
            if engagement_id is None:
                return {"status": "error", "message": "engagement_id is missing or not a valid UUID"}, None, [], [], None
            event_tzinfo = _resolve_event_timezone(args.get("timezone"), tzinfo)
            update_fields = {
                k: v for k, v in args.items()
                if k not in ("engagement_id", "timezone", "weekday", "weekday_qualifier")
            }
            if "start_time" in update_fields or "end_time" in update_fields:
                new_start, new_end = _apply_weekday_args(
                    update_fields.get("start_time"), update_fields.get("end_time"),
                    args.get("weekday"), args.get("weekday_qualifier"), reference_datetime,
                )
                # Only write back keys the model actually included — synthesizing
                # e.g. an end_time=None here (when only start_time was being
                # changed) would make EngagementUpdate treat it as an explicit
                # "clear this field" instead of "leave it alone".
                if "start_time" in update_fields:
                    update_fields["start_time"] = new_start
                if "end_time" in update_fields:
                    update_fields["end_time"] = new_end
            for key in ("start_time", "end_time"):
                if key in update_fields:
                    update_fields[key] = _localize_tool_datetime(update_fields[key], event_tzinfo)
            payload = EngagementUpdate(**update_fields)
            try:
                engagement = engagement_service.update_engagement(session, engagement_id, payload)
            except EngagementConflictError as exc:
                return _build_conflict_result(session, exc, tzinfo)
            action = EngagementAction(
                type=EngagementActionType.UPDATED,
                engagement=EngagementRead.model_validate(engagement),
            )
            result = {"status": "ok", "engagement": _localize_engagement(action.engagement.model_dump(mode="json"), tzinfo)}
            return result, action, [], [], None

        if name == "delete_engagement":
            engagement_id = _parse_uuid(args.get("engagement_id"))
            if engagement_id is None:
                return {"status": "error", "message": "engagement_id is missing or not a valid UUID"}, None, [], [], None
            snapshot = engagement_service.delete_engagement(session, engagement_id)
            action = EngagementAction(
                type=EngagementActionType.DELETED,
                engagement=EngagementRead.model_validate(snapshot),
            )
            result = {"status": "ok", "engagement": _localize_engagement(action.engagement.model_dump(mode="json"), tzinfo)}
            return result, action, [], [], None

        if name == "list_engagements":
            results = engagement_service.list_engagements(
                session,
                title_contains=args.get("title_contains"),
                start_after=_parse_optional_datetime(args.get("start_after")),
                start_before=_parse_optional_datetime(args.get("start_before")),
                limit=min(int(args.get("limit") or 10), 50),
                descending=bool(args.get("descending", False)),
            )
            return {
                "status": "ok",
                "engagements": [
                    _localize_engagement(EngagementRead.model_validate(e).model_dump(mode="json"), tzinfo)
                    for e in results
                ],
            }, None, [], [], None

        if name == "check_free_slots":
            range_result = resolve_free_slots_for_range(
                session,
                date_from=date.fromisoformat(args["date_from"]),
                date_to=date.fromisoformat(args["date_to"]),
                min_duration_minutes=int(args.get("min_duration_minutes") or 30),
            )
            free_slots = [
                FreeSlotItem(
                    start_time=_utc_to_local_iso(slot.start, tzinfo),
                    end_time=_utc_to_local_iso(slot.end, tzinfo),
                    duration_minutes=int((slot.end - slot.start).total_seconds() // 60),
                )
                for slot in range_result.slots[:20]
            ]
            busy_engagements = [
                BusyEngagementInfo(
                    title=engagement.title,
                    category=engagement.category,
                    start_time=_utc_to_local_iso(engagement.start_time, tzinfo),
                    end_time=_utc_to_local_iso(engagement.end_time, tzinfo),
                )
                for engagement in range_result.blocking_engagements[:50]
            ]
            result = {
                "status": "ok",
                "slots": [item.model_dump(mode="json") for item in free_slots],
                "busy": [item.model_dump(mode="json") for item in busy_engagements],
            }
            return result, None, free_slots, busy_engagements, None

        if name == "check_availability":
            event_tzinfo = _resolve_event_timezone(args.get("timezone"), tzinfo)
            start_value, end_value = _apply_weekday_args(
                args["start_time"], args["end_time"], args.get("weekday"), args.get("weekday_qualifier"),
                reference_datetime,
            )
            start_local = _localize_tool_datetime(start_value, event_tzinfo)
            end_local = _localize_tool_datetime(end_value, event_tzinfo)
            start_utc = to_naive_utc(datetime.fromisoformat(start_local))
            end_utc = to_naive_utc(datetime.fromisoformat(end_local))
            if start_utc >= end_utc:
                return {"status": "error", "message": "start_time must be before end_time"}, None, [], [], None

            existing = session.exec(select(Engagement)).all()
            conflict = find_conflicting_engagement(start_utc, end_utc, existing)
            if conflict is None:
                return _build_availability_result(session, "Requested time", start_utc, end_utc, tzinfo)

            fabricated_exc = EngagementConflictError(
                "",
                conflicting_engagement=conflict,
                attempted_title="Requested time",
                attempted_start=start_utc,
                attempted_end=end_utc,
            )
            return _build_conflict_result(session, fabricated_exc, tzinfo)

        return {"status": "error", "message": f"Unknown tool {name!r}"}, None, [], [], None

    except (EngagementNotFoundError, EngagementConflictError) as exc:
        return {"status": "error", "message": str(exc)}, None, [], [], None
    except (ValidationError, ValueError, KeyError, TypeError) as exc:
        return {"status": "error", "message": f"Invalid arguments: {exc}"}, None, [], [], None


def send_message(
    session: Session,
    chat_session_id: Optional[UUID],
    user_message: str,
    timezone_name: str = "UTC",
    reference_datetime: Optional[datetime] = None,
) -> ChatTurnResult:
    if not user_message or not user_message.strip():
        raise ChatServiceError("Message must not be empty", status_code=400)

    if not settings.OPENAI_API_KEY:
        raise ChatServiceError("OPENAI_API_KEY is not configured on the server", status_code=503)

    tzinfo = _resolve_timezone(timezone_name)
    if reference_datetime is None:
        reference_datetime = datetime.now(tzinfo)
    elif reference_datetime.tzinfo is None:
        reference_datetime = reference_datetime.replace(tzinfo=tzinfo)

    chat_session = _resolve_session(session, chat_session_id)

    # Persisted before the OpenAI call so the user's message survives even if
    # that call fails outright — matches ordinary chat-app UX.
    session.add(ChatMessage(session_id=chat_session.id, role=ChatRole.USER, content=user_message))
    session.commit()

    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    system_message = {
        "role": "system",
        "content": _build_system_prompt(reference_datetime, timezone_name),
    }

    actions: List[EngagementAction] = []
    free_slots: List[FreeSlotItem] = []
    busy_engagements: List[BusyEngagementInfo] = []
    conflict: Optional[ConflictInfo] = None

    for _ in range(settings.CHAT_MAX_TOOL_ROUNDTRIPS):
        messages_for_api = [system_message] + _replay_messages(session, chat_session.id)

        try:
            completion = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages_for_api,
                tools=TOOLS,
                tool_choice="auto",
                timeout=settings.OPENAI_REQUEST_TIMEOUT_SECONDS,
            )
        except openai.AuthenticationError as exc:
            raise ChatServiceError(
                "OpenAI authentication failed; check OPENAI_API_KEY", status_code=503
            ) from exc
        except openai.RateLimitError as exc:
            raise ChatServiceError(
                "OpenAI rate limit exceeded, please retry shortly", status_code=429
            ) from exc
        except (openai.APIConnectionError, openai.APITimeoutError) as exc:
            raise ChatServiceError("Could not reach the OpenAI API", status_code=503) from exc
        except openai.LengthFinishReasonError as exc:
            raise ChatServiceError(
                "OpenAI response was truncated before completion", status_code=502
            ) from exc
        except openai.ContentFilterFinishReasonError as exc:
            raise ChatServiceError(
                "OpenAI declined to process this content", status_code=422
            ) from exc
        except openai.BadRequestError as exc:
            raise ChatServiceError(f"OpenAI rejected the request: {exc}", status_code=400) from exc
        except openai.APIStatusError as exc:
            raise ChatServiceError(f"OpenAI API error: {exc}", status_code=502) from exc

        message = completion.choices[0].message

        if message.tool_calls:
            tool_calls_payload = [
                {
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.function.name,
                        "arguments": tool_call.function.arguments,
                    },
                }
                for tool_call in message.tool_calls
            ]
            session.add(
                ChatMessage(
                    session_id=chat_session.id,
                    role=ChatRole.ASSISTANT,
                    content=message.content,
                    tool_calls_json=json.dumps(tool_calls_payload),
                )
            )
            session.commit()

            for tool_call in message.tool_calls:
                result, action, slots, busy, tool_conflict = _execute_tool(
                    session, tool_call, tzinfo, reference_datetime
                )
                if action is not None:
                    actions.append(action)
                if slots:
                    free_slots.extend(slots)
                if busy:
                    busy_engagements.extend(busy)
                if tool_conflict is not None:
                    conflict = tool_conflict
                session.add(
                    ChatMessage(
                        session_id=chat_session.id,
                        role=ChatRole.TOOL,
                        tool_call_id=tool_call.id,
                        name=tool_call.function.name,
                        content=json.dumps(result),
                    )
                )
                session.commit()

            continue

        reply = message.content or ""
        session.add(
            ChatMessage(
                session_id=chat_session.id,
                role=ChatRole.ASSISTANT,
                content=reply,
                actions_json=json.dumps([action.model_dump(mode="json") for action in actions]),
                free_slots_json=json.dumps([slot.model_dump(mode="json") for slot in free_slots]),
                busy_engagements_json=json.dumps(
                    [engagement.model_dump(mode="json") for engagement in busy_engagements]
                ),
            )
        )
        session.commit()

        return ChatTurnResult(
            session_id=chat_session.id,
            reply=reply,
            actions=actions,
            free_slots=free_slots,
            busy_engagements=busy_engagements,
            conflict=conflict,
        )

    raise ChatServiceError(
        "Assistant could not complete this request after several tool calls", status_code=502
    )


def get_history(session: Session, chat_session_id: UUID) -> List[ChatMessage]:
    chat_session = session.get(ChatSession, chat_session_id)
    if chat_session is None:
        raise ChatServiceError(f"Unknown session_id: {chat_session_id}", status_code=404)

    rows = session.exec(
        select(ChatMessage)
        .where(ChatMessage.session_id == chat_session_id)
        .where(
            (ChatMessage.role == ChatRole.USER)
            | (
                (ChatMessage.role == ChatRole.ASSISTANT)
                & ChatMessage.tool_calls_json.is_(None)
                & ChatMessage.content.is_not(None)
            )
        )
        .order_by(ChatMessage.id)
    ).all()
    return list(rows)
