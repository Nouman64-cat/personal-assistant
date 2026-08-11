from __future__ import annotations

import openai

from app.core.config import settings
from app.services.chat_service import ChatServiceError

TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
SPEECH_MODEL = "gpt-4o-mini-tts"
SPEECH_VOICE = "verse"
SPEECH_INSTRUCTIONS = (
    "Speak in a calm, formal, deeply respectful tone, like a devoted attendant "
    "addressing their lord — composed and unhurried, never casual."
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


def synthesize_speech(text: str) -> bytes:
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        response = client.audio.speech.create(
            model=SPEECH_MODEL,
            voice=SPEECH_VOICE,
            input=text,
            instructions=SPEECH_INSTRUCTIONS,
            response_format="mp3",
        )
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

    return response.content
