from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db.database import get_session
from app.db.models import Engagement
from app.schemas.parser import ParsedEngagement, ParseRequest, ParseResponse
from app.services.parser_service import ParserServiceError, parse_engagements_from_text
from app.services.schedule_service import check_conflict

router = APIRouter()


@router.post("/parse", response_model=ParseResponse)
def parse_text(payload: ParseRequest, session: Session = Depends(get_session)) -> ParseResponse:
    try:
        result = parse_engagements_from_text(
            text=payload.text,
            reference_datetime=payload.reference_datetime,
            timezone_name=payload.timezone,
        )
    except ParserServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    existing_engagements = session.exec(select(Engagement)).all()

    engagements = [
        ParsedEngagement(
            title=candidate.title,
            description=candidate.description,
            start_time=candidate.start_time,
            end_time=candidate.end_time,
            category=candidate.category,
            is_blocking=candidate.is_blocking,
            has_conflict=candidate.is_blocking
            and check_conflict(candidate.start_time, candidate.end_time, existing_engagements),
        )
        for candidate in result.candidates
    ]

    return ParseResponse(engagements=engagements, warnings=result.warnings)
