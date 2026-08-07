from datetime import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class ShiftSettingsBase(BaseModel):
    day_start_hour: time
    day_end_hour: time
    timezone: str

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
        if self.day_start_hour >= self.day_end_hour:
            raise ValueError("day_start_hour must be before day_end_hour")
        return self


class ShiftSettingsUpdate(ShiftSettingsBase):
    pass


class ShiftSettingsRead(ShiftSettingsBase):
    model_config = ConfigDict(from_attributes=True)
