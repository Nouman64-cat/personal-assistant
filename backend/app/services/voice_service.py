from __future__ import annotations

from typing import Iterator

import openai

from app.core.config import settings
from app.services.chat_service import ChatServiceError

TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
SPEECH_MODEL = "gpt-4o-mini-tts"
SPEECH_VOICE = "shimmer"  # soft, soothing — a female-presenting voice for "Bella"
SPEECH_INSTRUCTIONS = (
    "Speak in a warm, composed, deeply respectful tone, like a devoted attendant "
    "addressing their lord. Natural human conversational pacing — real breath "
    "pauses between phrases, gentle rise and fall in pitch, unhurried but never "
    "sluggish. Never flat or robotic."
)


def transcribe_audio(file_bytes: bytes, filename: str, content_type: str) -> str:
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


def open_speech_stream(text: str) -> Iterator[bytes]:
    """Opens the OpenAI TTS connection and returns an mp3 byte-chunk iterator.

    The connection is opened (and any auth/rate-limit/bad-request error
    surfaced) *before* returning, so the caller can translate failures into a
    proper HTTP status — only genuinely mid-stream failures (rare) show up as
    a truncated stream instead. This is what lets the endpoint start
    streaming audio to the browser as soon as OpenAI produces the first
    chunk, instead of waiting for the full clip to render and download
    before playback can start — that wait was the main source of the
    "speaking is slow" lag.
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
