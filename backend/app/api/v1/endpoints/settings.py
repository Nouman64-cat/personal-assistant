from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.db.database import get_session
from app.db.models import ShiftSettings
from app.schemas.settings import ShiftSettingsRead, ShiftSettingsUpdate
from app.services.settings_service import get_or_create_shift_settings

router = APIRouter()


@router.get("/shift", response_model=ShiftSettingsRead)
def get_shift_settings(session: Session = Depends(get_session)) -> ShiftSettings:
    return get_or_create_shift_settings(session)


@router.put("/shift", response_model=ShiftSettingsRead)
def update_shift_settings(
    payload: ShiftSettingsUpdate, session: Session = Depends(get_session)
) -> ShiftSettings:
    shift = get_or_create_shift_settings(session)
    shift.day_start_hour = payload.day_start_hour
    shift.day_end_hour = payload.day_end_hour
    shift.timezone = payload.timezone
    shift.buffer_minutes = payload.buffer_minutes

    session.add(shift)
    session.commit()
    session.refresh(shift)
    return shift
