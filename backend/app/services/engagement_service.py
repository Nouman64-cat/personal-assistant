from typing import List, Optional
from datetime import datetime
from uuid import UUID

from sqlmodel import Session, select

from app.db.models import Engagement
from app.schemas.engagement import EngagementCreate, EngagementUpdate
from app.services.schedule_service import check_conflict


class EngagementNotFoundError(Exception):
    """Raised when a referenced engagement id does not exist."""


class EngagementConflictError(Exception):
    """Raised when a create/update would overlap an existing blocking engagement."""


def create_engagement(session: Session, payload: EngagementCreate) -> Engagement:
    existing = session.exec(select(Engagement)).all()
    if payload.is_blocking and check_conflict(payload.start_time, payload.end_time, existing):
        raise EngagementConflictError("Engagement conflicts with an existing blocking engagement")

    engagement = Engagement(**payload.model_dump())
    session.add(engagement)
    session.commit()
    session.refresh(engagement)
    return engagement


def get_engagement_or_404(session: Session, engagement_id: UUID) -> Engagement:
    engagement = session.get(Engagement, engagement_id)
    if engagement is None:
        raise EngagementNotFoundError(f"Engagement {engagement_id} not found")
    return engagement


def update_engagement(session: Session, engagement_id: UUID, payload: EngagementUpdate) -> Engagement:
    engagement = get_engagement_or_404(session, engagement_id)

    updates = payload.model_dump(exclude_unset=True)
    new_start = updates.get("start_time", engagement.start_time)
    new_end = updates.get("end_time", engagement.end_time)
    new_is_blocking = updates.get("is_blocking", engagement.is_blocking)

    if new_start >= new_end:
        raise ValueError("start_time must be before end_time")

    if new_is_blocking:
        others = [e for e in session.exec(select(Engagement)).all() if e.id != engagement_id]
        if check_conflict(new_start, new_end, others):
            raise EngagementConflictError("Engagement conflicts with an existing blocking engagement")

    for field, value in updates.items():
        setattr(engagement, field, value)

    session.add(engagement)
    session.commit()
    session.refresh(engagement)
    return engagement


def delete_engagement(session: Session, engagement_id: UUID) -> Engagement:
    """Delete an engagement, returning a snapshot taken before the delete.

    SQLAlchemy expires an object's attributes on commit, so a snapshot is
    captured first for callers (e.g. the chat tool executor) that need to
    report what was deleted after it's gone.
    """
    engagement = get_engagement_or_404(session, engagement_id)
    snapshot = engagement.model_copy()
    session.delete(engagement)
    session.commit()
    return snapshot


def list_engagements(
    session: Session,
    title_contains: Optional[str] = None,
    start_after: Optional[datetime] = None,
    start_before: Optional[datetime] = None,
    limit: int = 20,
) -> List[Engagement]:
    query = select(Engagement)
    if title_contains:
        query = query.where(Engagement.title.ilike(f"%{title_contains}%"))
    if start_after is not None:
        query = query.where(Engagement.start_time >= start_after)
    if start_before is not None:
        query = query.where(Engagement.start_time <= start_before)
    query = query.order_by(Engagement.start_time).limit(limit)
    return list(session.exec(query).all())
