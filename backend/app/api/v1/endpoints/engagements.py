from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.db.database import get_session
from app.db.models import Engagement
from app.schemas.engagement import EngagementCreate, EngagementRead, EngagementUpdate
from app.services import engagement_service
from app.services.engagement_service import EngagementConflictError, EngagementNotFoundError

router = APIRouter()


@router.post("/", response_model=EngagementRead, status_code=status.HTTP_201_CREATED)
def create_engagement(
    payload: EngagementCreate, session: Session = Depends(get_session)
) -> Engagement:
    try:
        return engagement_service.create_engagement(session, payload)
    except EngagementConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/", response_model=List[EngagementRead])
def list_engagements(session: Session = Depends(get_session)) -> List[Engagement]:
    return engagement_service.list_engagements(session, limit=10_000)


@router.get("/{engagement_id}", response_model=EngagementRead)
def get_engagement(engagement_id: UUID, session: Session = Depends(get_session)) -> Engagement:
    try:
        return engagement_service.get_engagement_or_404(session, engagement_id)
    except EngagementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{engagement_id}", response_model=EngagementRead)
def update_engagement(
    engagement_id: UUID,
    payload: EngagementUpdate,
    session: Session = Depends(get_session),
) -> Engagement:
    try:
        return engagement_service.update_engagement(session, engagement_id, payload)
    except EngagementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EngagementConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/{engagement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_engagement(engagement_id: UUID, session: Session = Depends(get_session)) -> None:
    try:
        engagement_service.delete_engagement(session, engagement_id)
    except EngagementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
