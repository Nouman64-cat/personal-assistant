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
