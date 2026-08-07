from sqlmodel import Session

from app.db.models import ShiftSettings

SHIFT_SETTINGS_ID = 1


def get_or_create_shift_settings(session: Session) -> ShiftSettings:
    """Fetch the single saved shift, creating it with defaults on first use."""
    shift = session.get(ShiftSettings, SHIFT_SETTINGS_ID)
    if shift is None:
        shift = ShiftSettings(id=SHIFT_SETTINGS_ID)
        session.add(shift)
        session.commit()
        session.refresh(shift)
    return shift
