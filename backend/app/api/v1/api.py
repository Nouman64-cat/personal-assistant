from fastapi import APIRouter

from app.api.v1.endpoints import availability, engagements, parser, settings

api_router = APIRouter()
api_router.include_router(engagements.router, prefix="/engagements", tags=["engagements"])
api_router.include_router(availability.router, prefix="/availability", tags=["availability"])
api_router.include_router(parser.router, tags=["parser"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
