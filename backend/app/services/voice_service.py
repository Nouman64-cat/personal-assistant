from __future__ import annotations

import logging
from typing import Iterator

import httpx
import openai

from app.core.config import settings
from app.services.chat_service import ChatServiceError

logger = logging.getLogger(__name__)

# --- OpenAI Voice (Primary) --------------------------------------------------
TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
SPEECH_MODEL = "gpt-4o-mini-tts"
SPEECH_VOICE = "coral"  # 🍊 Coral: A friendly, expressive, and slightly playful tone for casual/younger audiences
SPEECH_INSTRUCTIONS = (
    "Speak in a friendly, expressive, and slightly playful tone that works well for casual "
    "or younger audiences. Natural human conversational pacing — real breath pauses between phrases, "
    "gentle rise and fall in pitch, cheerful, warm, and engaging. Never flat or robotic."
)

# --- Deepgram (Optional Fallback) --------------------------------------------
DEEPGRAM_STT_MODEL = "nova-3"
DEEPGRAM_TTS_MODEL = "aura-2-harmonia-en"
DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak"


def _deepgram_headers(**extra: str) -> dict[str, str]:
    return {"Authorization": f"Token {settings.DEEPGRAM_API_KEY}", **extra}


def _deepgram_transcribe(file_bytes: bytes, content_type: str) -> str:
    response = httpx.post(
        DEEPGRAM_LISTEN_URL,
        params={"model": DEEPGRAM_STT_MODEL, "smart_format": "true"},
        headers=_deepgram_headers(**{"Content-Type": content_type}),
        content=file_bytes,
        timeout=settings.DEEPGRAM_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    return data["results"]["channels"][0]["alternatives"][0]["transcript"]


def _openai_transcribe(file_bytes: bytes, filename: str, content_type: str) -> str:
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        transcription = client.audio.transcriptions.create(
            model=TRANSCRIBE_MODEL,
            file=(filename, file_bytes, content_type),
        )
    except openai.AuthenticationError as exc:
        raise ChatServiceError("OpenAI authentication failed; check OPENAI_API_KEY", status_code=503) from exc
    except openai.RateLimitError as exc:
        raise ChatServiceError("OpenAI rate limit exceeded, please retry shortly", status_code=429) from exc
    except (openai.APIConnectionError, openai.APITimeoutError) as exc:
        raise ChatServiceError("Could not reach the OpenAI API", status_code=503) from exc
    except openai.BadRequestError as exc:
        raise ChatServiceError(f"OpenAI rejected the audio: {exc}", status_code=400) from exc
    except openai.APIStatusError as exc:
        raise ChatServiceError(f"OpenAI API error: {exc}", status_code=502) from exc

    return transcription.text


def transcribe_audio(file_bytes: bytes, filename: str, content_type: str) -> str:
    try:
        return _openai_transcribe(file_bytes, filename, content_type)
    except Exception:
        if settings.DEEPGRAM_API_KEY:
            logger.warning("OpenAI transcription failed; trying Deepgram fallback", exc_info=True)
            return _deepgram_transcribe(file_bytes, content_type)
        raise


def _open_deepgram_speech_stream(text: str) -> Iterator[bytes]:
    client = httpx.Client(timeout=settings.DEEPGRAM_REQUEST_TIMEOUT_SECONDS)
    request = client.build_request(
        "POST",
        DEEPGRAM_SPEAK_URL,
        params={"model": DEEPGRAM_TTS_MODEL, "encoding": "mp3"},
        headers=_deepgram_headers(**{"Content-Type": "application/json"}),
        json={"text": text},
    )
    try:
        response = client.send(request, stream=True)
        response.raise_for_status()
    except Exception:
        client.close()
        raise

    def chunks() -> Iterator[bytes]:
        try:
            yield from response.iter_bytes(chunk_size=4096)
        finally:
            response.close()
            client.close()

    return chunks()


def _open_openai_speech_stream(text: str) -> Iterator[bytes]:
    """Opens the OpenAI TTS connection and returns an mp3 byte-chunk iterator.

    The connection is opened (and any auth/rate-limit/bad-request error
    surfaced) *before* returning, so the caller can translate failures into a
    proper HTTP status — only genuinely mid-stream failures (rare) show up as
    a truncated stream instead. This is what lets the endpoint start
    streaming audio to the client as soon as the provider produces the first
    chunk, instead of waiting for the full clip to render and download
    before playback can start.
    """
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        context_manager = client.audio.speech.with_streaming_response.create(
            model=SPEECH_MODEL,
            voice=SPEECH_VOICE,
            input=text,
            instructions=SPEECH_INSTRUCTIONS,
            response_format="mp3",
        )
        response = context_manager.__enter__()
    except openai.AuthenticationError as exc:
        raise ChatServiceError("OpenAI authentication failed; check OPENAI_API_KEY", status_code=503) from exc
    except openai.RateLimitError as exc:
        raise ChatServiceError("OpenAI rate limit exceeded, please retry shortly", status_code=429) from exc
    except (openai.APIConnectionError, openai.APITimeoutError) as exc:
        raise ChatServiceError("Could not reach the OpenAI API", status_code=503) from exc
    except openai.BadRequestError as exc:
        raise ChatServiceError(f"OpenAI rejected the text: {exc}", status_code=400) from exc
    except openai.APIStatusError as exc:
        raise ChatServiceError(f"OpenAI API error: {exc}", status_code=502) from exc

    def chunks() -> Iterator[bytes]:
        try:
            yield from response.iter_bytes(chunk_size=4096)
        finally:
            context_manager.__exit__(None, None, None)

    return chunks()


def open_speech_stream(text: str) -> Iterator[bytes]:
    try:
        return _open_openai_speech_stream(text)
    except Exception:
        if settings.DEEPGRAM_API_KEY:
            logger.warning("OpenAI speech synthesis failed; trying Deepgram fallback", exc_info=True)
            return _open_deepgram_speech_stream(text)
        raise
