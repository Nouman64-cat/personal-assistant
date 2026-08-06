from datetime import datetime, time
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.time_utils import to_naive_utc


class FreeSlot(BaseModel):
    start: datetime
    end: datetime


class FreeSlotsRequest(BaseModel):
    start_range: datetime
    end_range: datetime
    working_hours_start: time = time(9, 0)
    working_hours_end: time = time(17, 0)
    buffer_minutes: int = Field(default=10, ge=0)

    @field_validator("start_range", "end_range")
    @classmethod
    def normalize_to_utc(cls, value: datetime) -> datetime:
        return to_naive_utc(value)

    @model_validator(mode="after")
    def validate_ranges(self) -> "FreeSlotsRequest":
        if self.start_range >= self.end_range:
            raise ValueError("start_range must be before end_range")
        if self.working_hours_start >= self.working_hours_end:
            raise ValueError("working_hours_start must be before working_hours_end")
        return self


class FreeSlotsResponse(BaseModel):
    slots: List[FreeSlot]


class ConflictCheckRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    exclude_id: Optional[UUID] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def normalize_to_utc(cls, value: datetime) -> datetime:
        return to_naive_utc(value)

    @model_validator(mode="after")
    def validate_range(self) -> "ConflictCheckRequest":
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class ConflictCheckResponse(BaseModel):
    has_conflict: bool
