from fastapi import APIRouter, HTTPException

from app.schemas.recommendation import RecommendationRequest, RecommendationResponse
from app.services import recommendation_service
from app.services.chat_service import ChatServiceError

router = APIRouter()


@router.post("/", response_model=RecommendationResponse)
def generate_recommendation(payload: RecommendationRequest) -> RecommendationResponse:
    try:
        text = recommendation_service.generate_recommendation(payload.kind)
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return RecommendationResponse(text=text)
