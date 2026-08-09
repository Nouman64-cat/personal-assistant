import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db.database import get_session
from app.db.models import ChatRole
from app.schemas.chat import ChatHistoryMessage, ChatHistoryResponse, ChatMessageRequest, ChatMessageResponse
from app.services import chat_service
from app.services.chat_service import ChatServiceError

router = APIRouter()


@router.post("/messages", response_model=ChatMessageResponse)
def send_message(
    payload: ChatMessageRequest, session: Session = Depends(get_session)
) -> ChatMessageResponse:
    try:
        result = chat_service.send_message(
            session,
            chat_session_id=payload.session_id,
            user_message=payload.message,
            timezone_name=payload.timezone,
            reference_datetime=payload.reference_datetime,
        )
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return ChatMessageResponse(
        session_id=result.session_id,
        reply=result.reply,
        actions=result.actions,
        free_slots=result.free_slots,
    )


@router.get("/{session_id}/messages", response_model=ChatHistoryResponse)
def get_messages(session_id: UUID, session: Session = Depends(get_session)) -> ChatHistoryResponse:
    try:
        rows = chat_service.get_history(session, session_id)
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return ChatHistoryResponse(
        session_id=session_id,
        messages=[
            ChatHistoryMessage(
                role="user" if row.role == ChatRole.USER else "assistant",
                content=row.content or "",
                created_at=row.created_at,
                actions=json.loads(row.actions_json) if row.actions_json else [],
                free_slots=json.loads(row.free_slots_json) if row.free_slots_json else [],
            )
            for row in rows
        ],
    )
