import uuid
from datetime import datetime
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
