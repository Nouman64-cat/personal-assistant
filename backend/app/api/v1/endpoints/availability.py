from datetime import date, datetime, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.core.time_utils import local_time_to_utc
from app.db.database import get_session
from app.db.models import Engagement
from app.schemas.schedule import (
    ConflictCheckRequest,
    ConflictCheckResponse,
    FreeSlotItem,
    FreeSlotsResponse,
)
from app.services.schedule_service import check_conflict, get_free_slots
from app.services.settings_service import get_or_create_shift_settings

router = APIRouter()


@router.get("/free-slots", response_model=FreeSlotsResponse)
def free_slots(
    date_from: date = Query(..., description="Start of the search range (inclusive)."),
    date_to: date = Query(..., description="End of the search range (inclusive)."),
    day_start_hour: Optional[time] = Query(
        default=None, description="Daily working-hours start. Defaults to your saved shift."
    ),
    day_end_hour: Optional[time] = Query(
        default=None, description="Daily working-hours end. Defaults to your saved shift."
    ),
    min_duration_minutes: int = Query(
        default=30, ge=1, description="Minimum length a free slot must have to be returned."
    ),
    session: Session = Depends(get_session),
) -> FreeSlotsResponse:
    if date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_from must not be after date_to",
        )

    if day_start_hour is None or day_end_hour is None:
        shift = get_or_create_shift_settings(session)
        if day_start_hour is None:
            day_start_hour = local_time_to_utc(date_from, shift.day_start_hour, shift.timezone)
        if day_end_hour is None:
            day_end_hour = local_time_to_utc(date_from, shift.day_end_hour, shift.timezone)

    if day_start_hour >= day_end_hour:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="day_start_hour must be before day_end_hour",
        )

    start_range = datetime.combine(date_from, time.min)
    end_range = datetime.combine(date_to, time.max)

    blocking_engagements = session.exec(
        select(Engagement).where(
            Engagement.is_blocking == True,  # noqa: E712
            Engagement.start_time < end_range,
            Engagement.end_time > start_range,
        )
    ).all()

    slots = get_free_slots(
        start_range=start_range,
        end_range=end_range,
        existing_engagements=blocking_engagements,
        working_hours_start=day_start_hour,
        working_hours_end=day_end_hour,
        buffer_minutes=0,
        min_duration_minutes=min_duration_minutes,
    )

    return FreeSlotsResponse(
        slots=[
            FreeSlotItem(
                start_time=slot.start,
                end_time=slot.end,
                duration_minutes=int((slot.end - slot.start).total_seconds() // 60),
            )
            for slot in slots
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
