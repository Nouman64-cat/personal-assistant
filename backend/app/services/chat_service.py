from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import openai
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import settings
from app.db.models import ChatMessage, ChatRole, ChatSession, EngagementCategory
from app.schemas.chat import BusyEngagementInfo, EngagementAction, EngagementActionType
from app.schemas.engagement import EngagementCreate, EngagementRead, EngagementUpdate
from app.schemas.schedule import FreeSlotItem
from app.services import engagement_service
from app.services.engagement_service import EngagementConflictError, EngagementNotFoundError
from app.services.schedule_service import resolve_free_slots_for_range

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
                        "description": "ISO-8601 timestamp including a UTC offset, e.g. '2026-08-11T15:00:00+00:00'.",
                    },
                    "end_time": {
                        "type": "string",
                        "description": "ISO-8601 timestamp including a UTC offset.",
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
                    "start_time": {"type": "string", "description": "ISO-8601 timestamp with UTC offset."},
                    "end_time": {"type": "string", "description": "ISO-8601 timestamp with UTC offset."},
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
                "Look up existing engagements to resolve references like 'that meeting' or 'the "
                "interview tomorrow'. Always call this first if you don't already know the "
                "engagement_id from earlier in this conversation. Never guess an id.\n\n"
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
]


def _build_system_prompt(reference_datetime: datetime, timezone_name: str) -> str:
    return (
        "You are a scheduling assistant that manages the user's calendar through natural "
        "conversation. Use the provided tools to create, edit, delete, and look up engagements, "
        "and to check free time slots — never claim to have done something without calling the "
        "matching tool. Resolve relative or vague date/time expressions (e.g. 'tomorrow at 3pm', "
        "'next Tuesday') using the reference datetime below as 'now'. Always pass start_time/"
        "end_time to tools as ISO-8601 timestamps including a UTC offset. Timestamps that tools "
        "return to you (engagements, free slots) are already in the user's local timezone (given "
        "below), each with that zone's own UTC offset — read the wall-clock digits directly when "
        "describing them, no conversion needed.\n\n"
        "When the user refers to an existing engagement ('that meeting', 'the interview'), "
        "resolve it via list_engagements (or an id you already learned earlier in this "
        "conversation) before calling update_engagement or delete_engagement — never guess an id. "
        "After completing the requested actions, reply with a brief, natural confirmation of what "
        "changed; don't narrate tool mechanics. After check_free_slots, keep the reply to a short "
        "sentence or two (e.g. how many days had openings, or anything notable) — the app displays "
        "the actual slot list as its own widget, so don't repeat it in prose.\n\n"
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
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


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


ToolResult = Tuple[dict, Optional[EngagementAction], List[FreeSlotItem], List[BusyEngagementInfo]]


def _execute_tool(session: Session, tool_call, tzinfo: ZoneInfo) -> ToolResult:
    name = tool_call.function.name
    try:
        args = json.loads(tool_call.function.arguments or "{}")
    except json.JSONDecodeError as exc:
        return {"status": "error", "message": f"Malformed arguments: {exc}"}, None, [], []

    try:
        if name == "create_engagement":
            payload = EngagementCreate(
                title=args["title"],
                description=args.get("description"),
                start_time=args["start_time"],
                end_time=args["end_time"],
                category=args["category"],
                is_blocking=args.get("is_blocking", True),
            )
            engagement = engagement_service.create_engagement(session, payload)
            action = EngagementAction(
                type=EngagementActionType.CREATED,
                engagement=EngagementRead.model_validate(engagement),
            )
            result = {"status": "ok", "engagement": _localize_engagement(action.engagement.model_dump(mode="json"), tzinfo)}
            return result, action, [], []

        if name == "update_engagement":
            engagement_id = _parse_uuid(args.get("engagement_id"))
            if engagement_id is None:
                return {"status": "error", "message": "engagement_id is missing or not a valid UUID"}, None, [], []
            update_fields = {k: v for k, v in args.items() if k != "engagement_id"}
            payload = EngagementUpdate(**update_fields)
            engagement = engagement_service.update_engagement(session, engagement_id, payload)
            action = EngagementAction(
                type=EngagementActionType.UPDATED,
                engagement=EngagementRead.model_validate(engagement),
            )
            result = {"status": "ok", "engagement": _localize_engagement(action.engagement.model_dump(mode="json"), tzinfo)}
            return result, action, [], []

        if name == "delete_engagement":
            engagement_id = _parse_uuid(args.get("engagement_id"))
            if engagement_id is None:
                return {"status": "error", "message": "engagement_id is missing or not a valid UUID"}, None, [], []
            snapshot = engagement_service.delete_engagement(session, engagement_id)
            action = EngagementAction(
                type=EngagementActionType.DELETED,
                engagement=EngagementRead.model_validate(snapshot),
            )
            result = {"status": "ok", "engagement": _localize_engagement(action.engagement.model_dump(mode="json"), tzinfo)}
            return result, action, [], []

        if name == "list_engagements":
            results = engagement_service.list_engagements(
                session,
                title_contains=args.get("title_contains"),
                start_after=_parse_optional_datetime(args.get("start_after")),
                start_before=_parse_optional_datetime(args.get("start_before")),
                limit=min(int(args.get("limit") or 10), 50),
            )
            return {
                "status": "ok",
                "engagements": [
                    _localize_engagement(EngagementRead.model_validate(e).model_dump(mode="json"), tzinfo)
                    for e in results
                ],
            }, None, [], []

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
            return result, None, free_slots, busy_engagements

        return {"status": "error", "message": f"Unknown tool {name!r}"}, None, [], []

    except (EngagementNotFoundError, EngagementConflictError) as exc:
        return {"status": "error", "message": str(exc)}, None, []
    except (ValidationError, ValueError, KeyError, TypeError) as exc:
        return {"status": "error", "message": f"Invalid arguments: {exc}"}, None, []


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
                result, action, slots, busy = _execute_tool(session, tool_call, tzinfo)
                if action is not None:
                    actions.append(action)
                if slots:
                    free_slots.extend(slots)
                if busy:
                    busy_engagements.extend(busy)
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
