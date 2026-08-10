from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable, List, Optional, Sequence
from uuid import UUID

from sqlmodel import Session, select

from app.core.time_utils import local_time_to_utc
from app.db.models import Engagement
from app.services.settings_service import get_or_create_shift_settings


@dataclass(frozen=True)
class Interval:
    start: datetime
    end: datetime


def merge_intervals(intervals: Sequence[Interval]) -> List[Interval]:
    """Merge overlapping or touching intervals into a minimal sorted set."""
    if not intervals:
        return []

    ordered = sorted(intervals, key=lambda interval: interval.start)
    merged: List[Interval] = [ordered[0]]

    for current in ordered[1:]:
        last = merged[-1]
        if current.start <= last.end:
            if current.end > last.end:
                merged[-1] = Interval(last.start, current.end)
        else:
            merged.append(current)

    return merged


def find_conflicting_engagement(
    new_start: datetime,
    new_end: datetime,
    existing_engagements: Iterable[Engagement],
    exclude_id: Optional[UUID] = None,
) -> Optional[Engagement]:
    """Return the first blocking engagement that overlaps [new_start, new_end), if any.

    Adjacent intervals (one ending exactly when the other starts) do not
    count as conflicts. Returning the engagement itself (not just a bool)
    lets callers report specifically *which* existing commitment is in the
    way, instead of a bare "conflict" message.
    """
    if new_start >= new_end:
        raise ValueError("new_start must be before new_end")

    for engagement in existing_engagements:
        if not engagement.is_blocking:
            continue
        if exclude_id is not None and engagement.id == exclude_id:
            continue
        if engagement.start_time < new_end and engagement.end_time > new_start:
            return engagement

    return None


def check_conflict(
    new_start: datetime,
    new_end: datetime,
    existing_engagements: Iterable[Engagement],
    exclude_id: Optional[UUID] = None,
) -> bool:
    """Return True if [new_start, new_end) overlaps any blocking engagement."""
    return find_conflicting_engagement(new_start, new_end, existing_engagements, exclude_id) is not None


def get_free_slots(
    start_range: datetime,
    end_range: datetime,
    existing_engagements: Iterable[Engagement],
    working_hours_start: time,
    working_hours_end: time,
    buffer_minutes: int = 10,
    min_duration_minutes: int = 0,
) -> List[Interval]:
    """Compute free time slots within daily working-hour windows.

    Blocking engagements are expanded by `buffer_minutes` on each side, merged
    per day, then inverted against that day's working-hour window (clipped to
    the overall [start_range, end_range]) to yield the resulting free slots.
    Slots shorter than `min_duration_minutes` are dropped from the result.

    If `working_hours_start > working_hours_end` (e.g. 18:00 to 02:00), the
    window is treated as an overnight shift: each day's window runs from
    `working_hours_start` on that day to `working_hours_end` on the *next*
    day.
    """
    if start_range >= end_range:
        raise ValueError("start_range must be before end_range")
    if working_hours_start == working_hours_end:
        raise ValueError("working_hours_start and working_hours_end must not be equal")

    overnight = working_hours_start > working_hours_end
    buffer_delta = timedelta(minutes=buffer_minutes)
    blocking = [engagement for engagement in existing_engagements if engagement.is_blocking]

    free_slots: List[Interval] = []
    current_day: date = start_range.date()
    tzinfo = start_range.tzinfo

    while current_day <= end_range.date():
        end_day = current_day + timedelta(days=1) if overnight else current_day
        day_start = max(
            datetime.combine(current_day, working_hours_start, tzinfo=tzinfo),
            start_range,
        )
        day_end = min(
            datetime.combine(end_day, working_hours_end, tzinfo=tzinfo),
            end_range,
        )

        if day_start < day_end:
            day_busy = [
                Interval(
                    max(day_start, engagement.start_time - buffer_delta),
                    min(day_end, engagement.end_time + buffer_delta),
                )
                for engagement in blocking
                if engagement.start_time - buffer_delta < day_end
                and engagement.end_time + buffer_delta > day_start
            ]
            merged_busy = merge_intervals(day_busy)

            cursor = day_start
            for busy in merged_busy:
                if busy.start > cursor:
                    free_slots.append(Interval(cursor, busy.start))
                cursor = max(cursor, busy.end)
            if cursor < day_end:
                free_slots.append(Interval(cursor, day_end))

        current_day += timedelta(days=1)

    if min_duration_minutes > 0:
        min_duration = timedelta(minutes=min_duration_minutes)
        free_slots = [slot for slot in free_slots if slot.end - slot.start >= min_duration]

    return free_slots


@dataclass(frozen=True)
class FreeSlotsResult:
    slots: List[Interval]
    blocking_engagements: List[Engagement]


def resolve_free_slots_for_range(
    session: Session,
    date_from: date,
    date_to: date,
    day_start_hour: Optional[time] = None,
    day_end_hour: Optional[time] = None,
    min_duration_minutes: int = 30,
    buffer_minutes: Optional[int] = None,
) -> FreeSlotsResult:
    """Compute free slots for a date range, falling back to the saved shift
    for any window bound left unspecified. Shared by the /free-slots REST
    endpoint and the chat `check_free_slots` tool so the overnight-window
    boundary math (see `test_availability_endpoint.py`) only lives once.

    Also returns the blocking engagements considered, so callers that want to
    describe *why* a stretch is busy (e.g. the chat widget's hover tooltip)
    don't have to re-derive the same date-range query.
    """
    if date_from > date_to:
        raise ValueError("date_from must not be after date_to")

    if day_start_hour is None or day_end_hour is None or buffer_minutes is None:
        shift = get_or_create_shift_settings(session)
        if day_start_hour is None:
            day_start_hour = local_time_to_utc(date_from, shift.day_start_hour, shift.timezone)
        if day_end_hour is None:
            day_end_hour = local_time_to_utc(date_from, shift.day_end_hour, shift.timezone)
        if buffer_minutes is None:
            buffer_minutes = shift.buffer_minutes

    if day_start_hour == day_end_hour:
        raise ValueError("day_start_hour and day_end_hour must not be equal")

    overnight = day_start_hour > day_end_hour
    start_range = datetime.combine(date_from, time.min)
    # For an overnight window, `date_to` means "the last day a shift may
    # *start*" — its tail extends into the next calendar day. Bounding
    # end_range at exactly that natural tail (rather than end-of-day-to)
    # avoids two failure modes: clipping the last night short, or (if we
    # instead just used end-of-day on date_to + 1) spuriously picking up the
    # first sliver of an unwanted extra night starting on date_to + 1.
    end_range = (
        datetime.combine(date_to + timedelta(days=1), day_end_hour)
        if overnight
        else datetime.combine(date_to, time.max)
    )

    blocking_engagements = session.exec(
        select(Engagement).where(
            Engagement.is_blocking == True,  # noqa: E712
            Engagement.start_time < end_range,
            Engagement.end_time > start_range,
        )
    ).all()

    slots = get_free_slots(
        start_range=start_range,
        end_range=end_range,
        existing_engagements=blocking_engagements,
        working_hours_start=day_start_hour,
        working_hours_end=day_end_hour,
        buffer_minutes=buffer_minutes,
        min_duration_minutes=min_duration_minutes,
    )
    return FreeSlotsResult(slots=slots, blocking_engagements=list(blocking_engagements))
