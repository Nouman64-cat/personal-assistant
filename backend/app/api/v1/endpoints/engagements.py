from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.db.database import get_session
from app.db.models import Engagement
from app.schemas.engagement import EngagementCreate, EngagementRead, EngagementUpdate
from app.services.schedule_service import check_conflict

router = APIRouter()


@router.post("/", response_model=EngagementRead, status_code=status.HTTP_201_CREATED)
def create_engagement(
    payload: EngagementCreate, session: Session = Depends(get_session)
) -> Engagement:
    existing = session.exec(select(Engagement)).all()
    if payload.is_blocking and check_conflict(payload.start_time, payload.end_time, existing):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Engagement conflicts with an existing blocking engagement",
        )

    engagement = Engagement(**payload.model_dump())
    session.add(engagement)
    session.commit()
    session.refresh(engagement)
    return engagement


@router.get("/", response_model=List[EngagementRead])
def list_engagements(session: Session = Depends(get_session)) -> List[Engagement]:
    return list(session.exec(select(Engagement).order_by(Engagement.start_time)).all())


@router.get("/{engagement_id}", response_model=EngagementRead)
def get_engagement(engagement_id: UUID, session: Session = Depends(get_session)) -> Engagement:
    engagement = session.get(Engagement, engagement_id)
    if engagement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Engagement not found")
    return engagement


@router.patch("/{engagement_id}", response_model=EngagementRead)
def update_engagement(
    engagement_id: UUID,
    payload: EngagementUpdate,
    session: Session = Depends(get_session),
) -> Engagement:
    engagement = session.get(Engagement, engagement_id)
    if engagement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Engagement not found")

    updates = payload.model_dump(exclude_unset=True)
    new_start = updates.get("start_time", engagement.start_time)
    new_end = updates.get("end_time", engagement.end_time)
    new_is_blocking = updates.get("is_blocking", engagement.is_blocking)

    if new_start >= new_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="start_time must be before end_time",
        )

    if new_is_blocking:
        others = [e for e in session.exec(select(Engagement)).all() if e.id != engagement_id]
        if check_conflict(new_start, new_end, others):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Engagement conflicts with an existing blocking engagement",
            )

    for field, value in updates.items():
        setattr(engagement, field, value)

    session.add(engagement)
    session.commit()
    session.refresh(engagement)
    return engagement


@router.delete("/{engagement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_engagement(engagement_id: UUID, session: Session = Depends(get_session)) -> None:
    engagement = session.get(Engagement, engagement_id)
    if engagement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Engagement not found")
    session.delete(engagement)
    session.commit()
