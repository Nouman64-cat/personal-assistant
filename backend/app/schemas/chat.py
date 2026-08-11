from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.db.models import EngagementCategory
from app.schemas.engagement import EngagementRead
from app.schemas.schedule import FreeSlotItem


class EngagementActionType(str, Enum):
    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"


class EngagementAction(BaseModel):
    type: EngagementActionType
    engagement: EngagementRead


class BusyEngagementInfo(BaseModel):
    """A lightweight, non-UTC-normalizing view of a blocking engagement, used
    only to describe *why* a stretch in the free-slots widget is busy (e.g. a
    hover tooltip). Deliberately not `EngagementRead` — that schema's
    start_time/end_time validator always renormalizes to naive UTC, which
    would silently undo the local-timezone conversion this needs."""

    title: str
    category: EngagementCategory
    start_time: datetime
    end_time: datetime


class LookedUpEngagement(BusyEngagementInfo):
    """A single engagement returned by a list_engagements lookup — e.g.
    answering "what's my next engagement" — rendered as a small card next to
    the reply instead of leaving the user with prose alone. Same local-
    timezone-preserving shape as BusyEngagementInfo (see its docstring for
    why that's not EngagementRead), plus the id for a stable React key."""

    id: UUID


class ConflictInfo(BaseModel):
    """The result of checking a specific time window against the calendar —
    either because create_engagement/update_engagement hit a conflict, or
    because check_availability answered a direct yes/no question. `available`
    tells the UI which widget to render (a green confirmation vs. an amber
    conflict callout with the blocking engagement highlighted); `conflicting_with`
    is only set when `available` is False. Only attached to the live turn's
    response, not persisted/replayed with chat history — the plain busy-slots
    widget and reply text still explain what happened on reload."""

    available: bool
    attempted_title: str
    attempted_start_time: datetime
    attempted_end_time: datetime
    conflicting_with: Optional[BusyEngagementInfo] = None


class ChatMessageRequest(BaseModel):
    session_id: Optional[UUID] = Field(
        default=None, description="Omit on the first message of a new conversation."
    )
    message: str = Field(..., min_length=1)
    timezone: str = Field(
        default="UTC",
        description="IANA timezone name used to resolve relative date/time expressions.",
    )
    reference_datetime: Optional[datetime] = Field(
        default=None,
        description="The 'now' relative expressions should resolve against. Defaults to the current time in `timezone`.",
    )


class ChatMessageResponse(BaseModel):
    session_id: UUID
    reply: str
    actions: List[EngagementAction] = Field(default_factory=list)
    free_slots: List[FreeSlotItem] = Field(default_factory=list)
    # The blocking engagements considered while computing free_slots, so the
    # UI can describe *why* a stretch is busy (e.g. a hover tooltip) instead
    # of just showing "Busy".
    busy_engagements: List[BusyEngagementInfo] = Field(default_factory=list)
    conflict: Optional[ConflictInfo] = None
    # Engagement(s) a list_engagements lookup actually surfaced (e.g. "what's
    # my next engagement") — rendered as a card so the answer isn't prose-only.
    looked_up_engagements: List[LookedUpEngagement] = Field(default_factory=list)


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    actions: List[EngagementAction] = Field(default_factory=list)
    free_slots: List[FreeSlotItem] = Field(default_factory=list)
    busy_engagements: List[BusyEngagementInfo] = Field(default_factory=list)
    looked_up_engagements: List[LookedUpEngagement] = Field(default_factory=list)


class ChatHistoryResponse(BaseModel):
    session_id: UUID
    messages: List[ChatHistoryMessage]


class VoiceTranscribeResponse(BaseModel):
    text: str


class VoiceSpeakRequest(BaseModel):
    text: str = Field(..., min_length=1)
