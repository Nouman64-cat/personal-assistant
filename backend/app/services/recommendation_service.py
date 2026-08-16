from __future__ import annotations

import openai

from app.core.config import settings
from app.services.chat_service import ChatServiceError

# Kept separate from chat_service's TOOLS-driven CRUD system prompt — a
# proactive nudge needs no scheduling context or tool-calling, just a short,
# fresh, natural spoken line, so it gets its own minimal single-turn prompt.

WELLNESS_SYSTEM_PROMPT = (
    'You are Julie, a warm, attentive personal assistant. Speak ONE short line '
    'out loud to your user (address them as "sir") during a busy working '
    "stretch — you can see they're currently in the middle of something. Nudge "
    "them toward one specific piece of self-care right now: drinking water, "
    "stretching, resting their eyes, sitting up straight, taking a short "
    "breather, or similar. Phrase it as a caring, natural spoken sentence, at "
    "most two sentences. Vary the specific nudge and the wording every time — "
    "never reuse the same line twice in a row. Plain spoken text only: no "
    "markdown, no lists, no emoji."
)

GROWTH_SYSTEM_PROMPT = (
    'You are Julie, a warm, sharp personal assistant. Speak ONE short line out '
    'loud to your user (address them as "sir") during a stretch of free time. '
    "Suggest one specific technology, concept, book, habit, or skill worth "
    "learning about that could help their growth — be concrete and genuinely "
    "interesting, not a vague platitude. Phrase it as a natural spoken "
    "sentence, at most two sentences. Vary the topic every time — never reuse "
    "the same suggestion twice in a row. Plain spoken text only: no markdown, "
    "no lists, no emoji."
)


def generate_recommendation(kind: str) -> str:
    if not settings.OPENAI_API_KEY:
        raise ChatServiceError("OPENAI_API_KEY is not configured on the server", status_code=503)

    system_prompt = WELLNESS_SYSTEM_PROMPT if kind == "wellness" else GROWTH_SYSTEM_PROMPT
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

    try:
        completion = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Give me a fresh one."},
            ],
            temperature=1.0,
            max_tokens=80,
            timeout=settings.OPENAI_REQUEST_TIMEOUT_SECONDS,
        )
    except openai.AuthenticationError as exc:
        raise ChatServiceError(
            "OpenAI authentication failed; check OPENAI_API_KEY", status_code=503
        ) from exc
    except openai.RateLimitError as exc:
        raise ChatServiceError(
            "OpenAI rate limit exceeded, please retry shortly", status_code=429
        ) from exc
    except (openai.APIConnectionError, openai.APITimeoutError) as exc:
        raise ChatServiceError("Could not reach the OpenAI API", status_code=503) from exc
    except openai.APIStatusError as exc:
        raise ChatServiceError(f"OpenAI API error: {exc}", status_code=502) from exc

    text = (completion.choices[0].message.content or "").strip()
    if not text:
        raise ChatServiceError("OpenAI returned an empty recommendation", status_code=502)
    return text
