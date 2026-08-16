from typing import Literal

from pydantic import BaseModel


class RecommendationRequest(BaseModel):
    """`kind` is decided client-side from whether the user is currently in a
    blocking engagement (wellness nudge) or a free stretch (growth nudge) —
    see JulieRecommendationProvider.tsx."""

    kind: Literal["wellness", "growth"]


class RecommendationResponse(BaseModel):
    text: str
