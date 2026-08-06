from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.core.time_utils import to_naive_utc
from app.db.models import EngagementCategory


class EngagementBase(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    category: EngagementCategory
    is_blocking: bool = True

    @field_validator("start_time", "end_time")
    @classmethod
    def normalize_to_utc(cls, value: datetime) -> datetime:
        return to_naive_utc(value)

    @model_validator(mode="after")
    def validate_time_range(self) -> "EngagementBase":
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class EngagementCreate(EngagementBase):
    pass


class EngagementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    category: Optional[EngagementCategory] = None
    is_blocking: Optional[bool] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def normalize_to_utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return to_naive_utc(value) if value is not None else None

    @model_validator(mode="after")
    def validate_time_range(self) -> "EngagementUpdate":
        if (
            self.start_time is not None
            and self.end_time is not None
            and self.start_time >= self.end_time
        ):
            raise ValueError("start_time must be before end_time")
        return self


class EngagementRead(EngagementBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
