from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable, List, Optional, Sequence
from uuid import UUID

from app.db.models import Engagement


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


def check_conflict(
    new_start: datetime,
    new_end: datetime,
    existing_engagements: Iterable[Engagement],
    exclude_id: Optional[UUID] = None,
) -> bool:
    """Return True if [new_start, new_end) overlaps any blocking engagement.

    Adjacent intervals (one ending exactly when the other starts) do not
    count as conflicts.
    """
    if new_start >= new_end:
        raise ValueError("new_start must be before new_end")

    for engagement in existing_engagements:
        if not engagement.is_blocking:
            continue
        if exclude_id is not None and engagement.id == exclude_id:
            continue
        if engagement.start_time < new_end and engagement.end_time > new_start:
            return True

    return False


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
    """
    if start_range >= end_range:
        raise ValueError("start_range must be before end_range")
    if working_hours_start >= working_hours_end:
        raise ValueError("working_hours_start must be before working_hours_end")

    buffer_delta = timedelta(minutes=buffer_minutes)
    blocking = [engagement for engagement in existing_engagements if engagement.is_blocking]

    free_slots: List[Interval] = []
    current_day: date = start_range.date()
    tzinfo = start_range.tzinfo

    while current_day <= end_range.date():
        day_start = max(
            datetime.combine(current_day, working_hours_start, tzinfo=tzinfo),
            start_range,
        )
        day_end = min(
            datetime.combine(current_day, working_hours_end, tzinfo=tzinfo),
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
