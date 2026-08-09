import uuid
from datetime import datetime, time
from enum import Enum
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class EngagementCategory(str, Enum):
    MEETING = "meeting"
    INTERVIEW = "interview"
    OFFICE_HOURS = "office_hours"
    PERSONAL = "personal"


class Engagement(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    title: str
    description: Optional[str] = Field(default=None)
    start_time: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    end_time: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    category: EngagementCategory
    is_blocking: bool = Field(default=True)


class ShiftSettings(SQLModel, table=True):
    """The user's recurring working hours, used as the default window for
    availability calculations. Single-row table (id is always 1) since this
    app has one user."""

    id: int = Field(default=1, primary_key=True)
    day_start_hour: time = Field(default=time(9, 0))
    day_end_hour: time = Field(default=time(18, 0))
    timezone: str = Field(default="UTC")


class ChatRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ChatSession(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ChatMessage(SQLModel, table=True):
    """One turn of a chat conversation, including the internal tool-call /
    tool-result round trips. `id` is a plain autoincrement int (not a UUID
    like other tables) because history replay depends on exact insertion
    order, and OpenAI requires tool-result messages to appear in the same
    order as the tool_calls that requested them."""

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: uuid.UUID = Field(foreign_key="chatsession.id", index=True)
    role: ChatRole
    content: Optional[str] = Field(default=None)
    tool_call_id: Optional[str] = Field(default=None)
    name: Optional[str] = Field(default=None)
    tool_calls_json: Optional[str] = Field(default=None)
    actions_json: Optional[str] = Field(default=None)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime, index=True)
    )
