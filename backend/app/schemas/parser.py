from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.db.models import EngagementCategory


class ParseRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Raw text to extract engagements from.")
    timezone: str = Field(
        default="UTC",
        description=(
            "IANA timezone name (e.g. 'America/New_York') used as the frame of "
            "reference for resolving relative date/time expressions."
        ),
    )
    reference_datetime: Optional[datetime] = Field(
        default=None,
        description=(
            "The 'now' relative expressions should resolve against. Defaults to "
            "the current time in `timezone` when omitted."
        ),
    )


class ParsedEngagement(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    category: EngagementCategory
    is_blocking: bool
    has_conflict: bool = Field(
        description="True if this candidate overlaps an existing blocking engagement."
    )


class ParseResponse(BaseModel):
    engagements: List[ParsedEngagement]
    warnings: List[str] = Field(
        default_factory=list,
        description="Candidates the model returned that could not be validated and were dropped.",
    )
