from fastapi import APIRouter

from app.api.v1.endpoints import availability, chat, engagements, settings

api_router = APIRouter()
api_router.include_router(engagements.router, prefix="/engagements", tags=["engagements"])
api_router.include_router(availability.router, prefix="/availability", tags=["availability"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
