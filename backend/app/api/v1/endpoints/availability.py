from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db.database import get_session
from app.db.models import Engagement
from app.schemas.schedule import (
    ConflictCheckRequest,
    ConflictCheckResponse,
    FreeSlot,
    FreeSlotsRequest,
    FreeSlotsResponse,
)
from app.services.schedule_service import check_conflict, get_free_slots

router = APIRouter()


@router.post("/free-slots", response_model=FreeSlotsResponse)
def free_slots(
    payload: FreeSlotsRequest, session: Session = Depends(get_session)
) -> FreeSlotsResponse:
    engagements = session.exec(select(Engagement)).all()
    slots = get_free_slots(
        start_range=payload.start_range,
        end_range=payload.end_range,
        existing_engagements=engagements,
        working_hours_start=payload.working_hours_start,
        working_hours_end=payload.working_hours_end,
        buffer_minutes=payload.buffer_minutes,
    )
    return FreeSlotsResponse(slots=[FreeSlot(start=slot.start, end=slot.end) for slot in slots])


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
