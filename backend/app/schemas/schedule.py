from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, field_validator, model_validator

from app.core.time_utils import to_naive_utc


class FreeSlotItem(BaseModel):
    start_time: datetime
    end_time: datetime
    duration_minutes: int


class FreeSlotsResponse(BaseModel):
    slots: List[FreeSlotItem]


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
