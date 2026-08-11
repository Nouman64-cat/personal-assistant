import json
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.db.database import get_session
from app.db.models import ChatRole
from app.schemas.chat import (
    ChatHistoryMessage,
    ChatHistoryResponse,
    ChatMessageRequest,
    ChatMessageResponse,
    VoiceSpeakRequest,
    VoiceTranscribeResponse,
)
from app.services import chat_service, voice_service
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
        busy_engagements=result.busy_engagements,
        conflict=result.conflict,
        looked_up_engagements=result.looked_up_engagements,
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
                busy_engagements=json.loads(row.busy_engagements_json) if row.busy_engagements_json else [],
                looked_up_engagements=(
                    json.loads(row.looked_up_engagements_json) if row.looked_up_engagements_json else []
                ),
            )
            for row in rows
        ],
    )


@router.post("/voice/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe_voice(audio: UploadFile = File(...)) -> VoiceTranscribeResponse:
    audio_bytes = await audio.read()
    try:
        text = voice_service.transcribe_audio(
            audio_bytes, audio.filename or "audio.webm", audio.content_type or "audio/webm"
        )
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return VoiceTranscribeResponse(text=text)


@router.post("/voice/speak")
def speak_text(payload: VoiceSpeakRequest) -> StreamingResponse:
    try:
        chunks = voice_service.open_speech_stream(payload.text)
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return StreamingResponse(chunks, media_type="audio/mpeg")
