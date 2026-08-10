from datetime import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ShiftSettingsBase(BaseModel):
    day_start_hour: time
    # If earlier than day_start_hour (e.g. 18:00 to 02:00), the shift is
    # treated as overnight, ending the next day.
    day_end_hour: time
    timezone: str
    # Minimum gap kept on both sides of every blocking engagement when
    # suggesting free slots — keeps back-to-back interviews/meetings from
    # being offered with zero breathing room in between.
    buffer_minutes: int = Field(default=10, ge=0, le=120)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone: {value!r}") from exc
        return value

    @model_validator(mode="after")
    def validate_range(self) -> "ShiftSettingsBase":
        if self.day_start_hour == self.day_end_hour:
            raise ValueError("day_start_hour and day_end_hour must not be equal")
        return self


class ShiftSettingsUpdate(ShiftSettingsBase):
    pass


class ShiftSettingsRead(ShiftSettingsBase):
    model_config = ConfigDict(from_attributes=True)
