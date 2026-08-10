from typing import List, Optional
from datetime import datetime
from uuid import UUID

from sqlmodel import Session, select

from app.db.models import Engagement
from app.schemas.engagement import EngagementCreate, EngagementUpdate
from app.services.schedule_service import find_conflicting_engagement


def _format_conflict_message(conflict: Engagement) -> str:
    return (
        f"Conflicts with existing engagement '{conflict.title}' "
        f"({conflict.start_time.isoformat()} to {conflict.end_time.isoformat()} UTC)"
    )


class EngagementNotFoundError(Exception):
    """Raised when a referenced engagement id does not exist."""


class EngagementConflictError(Exception):
    """Raised when a create/update would overlap an existing blocking engagement.

    Carries the conflicting engagement plus what was actually being attempted
    (title/start/end, post-merge for an update) so callers — e.g. the chat
    tool executor — can report specifics and surface that day's free slots
    without re-deriving the merge logic themselves.
    """

    def __init__(
        self,
        message: str,
        conflicting_engagement: Optional[Engagement] = None,
        attempted_title: Optional[str] = None,
        attempted_start: Optional[datetime] = None,
        attempted_end: Optional[datetime] = None,
    ) -> None:
        super().__init__(message)
        self.conflicting_engagement = conflicting_engagement
        self.attempted_title = attempted_title
        self.attempted_start = attempted_start
        self.attempted_end = attempted_end


def create_engagement(session: Session, payload: EngagementCreate) -> Engagement:
    existing = session.exec(select(Engagement)).all()
    if payload.is_blocking:
        conflict = find_conflicting_engagement(payload.start_time, payload.end_time, existing)
        if conflict is not None:
            raise EngagementConflictError(
                _format_conflict_message(conflict),
                conflicting_engagement=conflict,
                attempted_title=payload.title,
                attempted_start=payload.start_time,
                attempted_end=payload.end_time,
            )

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
    new_title = updates.get("title", engagement.title)
    new_is_blocking = updates.get("is_blocking", engagement.is_blocking)

    if new_start >= new_end:
        raise ValueError("start_time must be before end_time")

    if new_is_blocking:
        others = [e for e in session.exec(select(Engagement)).all() if e.id != engagement_id]
        conflict = find_conflicting_engagement(new_start, new_end, others)
        if conflict is not None:
            raise EngagementConflictError(
                _format_conflict_message(conflict),
                conflicting_engagement=conflict,
                attempted_title=new_title,
                attempted_start=new_start,
                attempted_end=new_end,
            )

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
    descending: bool = False,
) -> List[Engagement]:
    query = select(Engagement)
    if title_contains:
        query = query.where(Engagement.title.ilike(f"%{title_contains}%"))
    if start_after is not None:
        query = query.where(Engagement.start_time >= start_after)
    if start_before is not None:
        query = query.where(Engagement.start_time <= start_before)
    order = Engagement.start_time.desc() if descending else Engagement.start_time
    query = query.order_by(order).limit(limit)
    return list(session.exec(query).all())
