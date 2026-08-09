from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.engagement import EngagementRead


class EngagementActionType(str, Enum):
    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"


class EngagementAction(BaseModel):
    type: EngagementActionType
    engagement: EngagementRead


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


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    actions: List[EngagementAction] = Field(default_factory=list)


class ChatHistoryResponse(BaseModel):
    session_id: UUID
    messages: List[ChatHistoryMessage]
