from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.db.database import get_session
from app.db.models import Engagement
from app.schemas.schedule import (
    ConflictCheckRequest,
    ConflictCheckResponse,
    FreeSlotItem,
    FreeSlotsResponse,
)
from app.services.schedule_service import check_conflict, resolve_free_slots_for_range

router = APIRouter()


@router.get("/free-slots", response_model=FreeSlotsResponse)
def free_slots(
    date_from: date = Query(..., description="Start of the search range (inclusive)."),
    date_to: date = Query(..., description="End of the search range (inclusive)."),
    day_start_hour: Optional[time] = Query(
        default=None, description="Daily working-hours start. Defaults to your saved shift."
    ),
    day_end_hour: Optional[time] = Query(
        default=None,
        description=(
            "Daily working-hours end. Defaults to your saved shift. If earlier than "
            "day_start_hour (e.g. 18:00 to 02:00), treated as an overnight window ending "
            "the next day."
        ),
    ),
    min_duration_minutes: int = Query(
        default=30, ge=1, description="Minimum length a free slot must have to be returned."
    ),
    session: Session = Depends(get_session),
) -> FreeSlotsResponse:
    try:
        result = resolve_free_slots_for_range(
            session,
            date_from=date_from,
            date_to=date_to,
            day_start_hour=day_start_hour,
            day_end_hour=day_end_hour,
            min_duration_minutes=min_duration_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return FreeSlotsResponse(
        slots=[
            FreeSlotItem(
                start_time=slot.start,
                end_time=slot.end,
                duration_minutes=int((slot.end - slot.start).total_seconds() // 60),
            )
            for slot in result.slots
        ]
    )


@router.post("/check-conflict", response_model=ConflictCheckResponse)
def check_conflict_endpoint(
    payload: ConflictCheckRequest, session: Session = Depends(get_session)
) -> ConflictCheckResponse:
    engagements = session.exec(select(Engagement)).all()
    has_conflict = check_conflict(
        new_start=payload.start_time,
        new_end=payload.end_time,
        existing_engagements=engagements,
        exclude_id=payload.exclude_id,
    )
    return ConflictCheckResponse(has_conflict=has_conflict)
