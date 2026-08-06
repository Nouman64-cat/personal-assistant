from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import openai
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.core.time_utils import to_naive_utc
from app.db.models import EngagementCategory

logger = logging.getLogger(__name__)


class ParserServiceError(Exception):
    """Raised when the natural-language parsing pipeline cannot complete.

    Carries an HTTP status code so the endpoint layer can translate it
    directly into an `HTTPException` without re-deriving intent.
    """

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class _LLMEngagementItem(BaseModel):
    """Shape requested from OpenAI Structured Outputs.

    Datetimes are plain ISO-8601 strings (with UTC offset) rather than
    `datetime` fields: the JSON Schema dialect used by Structured Outputs has
    no native date-time type, so the model is instructed to emit strings
    which are parsed and validated afterwards.
    """

    title: str
    description: Optional[str] = None
    start_time: str
    end_time: str
    category: EngagementCategory
    is_blocking: bool


class _LLMEngagementBatch(BaseModel):
    engagements: List[_LLMEngagementItem]


class ParsedEngagementCandidate(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    category: EngagementCategory
    is_blocking: bool


@dataclass
class ParseResult:
    candidates: List[ParsedEngagementCandidate] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


SYSTEM_PROMPT = (
    "You extract calendar engagements from raw, unstructured text such as "
    "emails, meeting invites, or notes. Identify every distinct event, "
    "meeting, interview, office-hours block, or personal appointment "
    "mentioned. Resolve relative or vague date/time expressions (e.g. "
    "'tomorrow at 3pm', 'next Tuesday', 'in two weeks') using the supplied "
    "reference datetime as 'now'. Always return start_time and end_time as "
    "ISO-8601 timestamps including a UTC offset (e.g. "
    "'2026-08-11T15:00:00+00:00'). If no explicit duration or end time is "
    "stated, assume a 1-hour duration. If the text does not describe any "
    "engagements, return an empty list. Never invent details that aren't "
    "implied by the text."
)


def _build_user_prompt(text: str, reference_datetime: datetime, timezone_name: str) -> str:
    return (
        "Reference datetime (the user's current local time), treat this as "
        f"'now': {reference_datetime.isoformat()} ({timezone_name}).\n\n"
        f'Text to parse:\n"""\n{text}\n"""'
    )


def _resolve_timezone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ParserServiceError(
            f"Unknown timezone: {timezone_name!r}", status_code=400
        ) from exc


def parse_engagements_from_text(
    text: str,
    reference_datetime: Optional[datetime] = None,
    timezone_name: str = "UTC",
) -> ParseResult:
    """Parse raw text into structured engagement candidates via OpenAI
    Structured Outputs, resolving relative dates against `reference_datetime`
    (defaulting to "now" in `timezone_name`).

    Individual items that fail post-parse validation (bad timestamps,
    start >= end, etc.) are dropped with a warning rather than failing the
    whole request.
    """
    if not text or not text.strip():
        raise ParserServiceError("Input text must not be empty", status_code=400)

    if not settings.OPENAI_API_KEY:
        raise ParserServiceError(
            "OPENAI_API_KEY is not configured on the server", status_code=503
        )

    tzinfo = _resolve_timezone(timezone_name)

    if reference_datetime is None:
        reference_datetime = datetime.now(tzinfo)
    elif reference_datetime.tzinfo is None:
        reference_datetime = reference_datetime.replace(tzinfo=tzinfo)

    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

    try:
        completion = client.chat.completions.parse(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _build_user_prompt(text, reference_datetime, timezone_name),
                },
            ],
            response_format=_LLMEngagementBatch,
            timeout=settings.OPENAI_REQUEST_TIMEOUT_SECONDS,
        )
    except openai.AuthenticationError as exc:
        raise ParserServiceError(
            "OpenAI authentication failed; check OPENAI_API_KEY", status_code=503
        ) from exc
    except openai.RateLimitError as exc:
        raise ParserServiceError(
            "OpenAI rate limit exceeded, please retry shortly", status_code=429
        ) from exc
    except (openai.APIConnectionError, openai.APITimeoutError) as exc:
        raise ParserServiceError("Could not reach the OpenAI API", status_code=503) from exc
    except openai.LengthFinishReasonError as exc:
        raise ParserServiceError(
            "OpenAI response was truncated before completion", status_code=502
        ) from exc
    except openai.ContentFilterFinishReasonError as exc:
        raise ParserServiceError(
            "OpenAI declined to process this content", status_code=422
        ) from exc
    except openai.BadRequestError as exc:
        raise ParserServiceError(f"OpenAI rejected the request: {exc}", status_code=400) from exc
    except openai.APIStatusError as exc:
        raise ParserServiceError(f"OpenAI API error: {exc}", status_code=502) from exc

    message = completion.choices[0].message

    if message.refusal:
        raise ParserServiceError(
            f"OpenAI refused to parse this content: {message.refusal}", status_code=422
        )

    parsed_batch = message.parsed
    if parsed_batch is None:
        raise ParserServiceError("OpenAI returned no parseable content", status_code=502)

    result = ParseResult()

    for index, item in enumerate(parsed_batch.engagements, start=1):
        try:
            start_time = to_naive_utc(datetime.fromisoformat(item.start_time))
            end_time = to_naive_utc(datetime.fromisoformat(item.end_time))
            if start_time >= end_time:
                raise ValueError("start_time must be before end_time")
            candidate = ParsedEngagementCandidate(
                title=item.title,
                description=item.description,
                start_time=start_time,
                end_time=end_time,
                category=item.category,
                is_blocking=item.is_blocking,
            )
        except (ValueError, ValidationError) as exc:
            logger.warning("Dropping unparseable engagement candidate #%d: %s", index, exc)
            result.warnings.append(f"Skipped engagement #{index} ({item.title!r}): {exc}")
            continue
        result.candidates.append(candidate)

    return result
