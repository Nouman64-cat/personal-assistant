from datetime import datetime, time

import pytest

from app.db.models import Engagement, EngagementCategory
from app.services.schedule_service import (
    Interval,
    check_conflict,
    get_free_slots,
    merge_intervals,
)


def make_engagement(
    start: datetime,
    end: datetime,
    is_blocking: bool = True,
    category: EngagementCategory = EngagementCategory.MEETING,
) -> Engagement:
    return Engagement(
        title="Test engagement",
        start_time=start,
        end_time=end,
        category=category,
        is_blocking=is_blocking,
    )


def dt(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, day, hour, minute)


# ---------------------------------------------------------------------------
# merge_intervals
# ---------------------------------------------------------------------------


class TestMergeIntervals:
    def test_empty_input_returns_empty(self):
        assert merge_intervals([]) == []

    def test_single_interval_unchanged(self):
        interval = Interval(dt(1, 9), dt(1, 10))
        assert merge_intervals([interval]) == [interval]

    def test_overlapping_intervals_merge(self):
        intervals = [Interval(dt(1, 9), dt(1, 11)), Interval(dt(1, 10), dt(1, 12))]
        assert merge_intervals(intervals) == [Interval(dt(1, 9), dt(1, 12))]

    def test_touching_intervals_merge(self):
        """Back-to-back intervals (one ends exactly when the next starts) merge
        into a single continuous block."""
        intervals = [Interval(dt(1, 9), dt(1, 10)), Interval(dt(1, 10), dt(1, 11))]
        assert merge_intervals(intervals) == [Interval(dt(1, 9), dt(1, 11))]

    def test_disjoint_intervals_stay_separate(self):
        intervals = [Interval(dt(1, 9), dt(1, 10)), Interval(dt(1, 11), dt(1, 12))]
        assert merge_intervals(intervals) == intervals

    def test_unsorted_input_is_sorted_before_merging(self):
        intervals = [
            Interval(dt(1, 14), dt(1, 15)),
            Interval(dt(1, 9), dt(1, 10)),
            Interval(dt(1, 9, 30), dt(1, 11)),
        ]
        assert merge_intervals(intervals) == [
            Interval(dt(1, 9), dt(1, 11)),
            Interval(dt(1, 14), dt(1, 15)),
        ]

    def test_fully_contained_interval_is_absorbed(self):
        intervals = [Interval(dt(1, 9), dt(1, 17)), Interval(dt(1, 10), dt(1, 11))]
        assert merge_intervals(intervals) == [Interval(dt(1, 9), dt(1, 17))]


# ---------------------------------------------------------------------------
# check_conflict
# ---------------------------------------------------------------------------


class TestCheckConflict:
    def test_overlapping_blocking_engagement_conflicts(self):
        existing = [make_engagement(dt(1, 9), dt(1, 10))]
        assert check_conflict(dt(1, 9, 30), dt(1, 10, 30), existing) is True

    def test_non_overlapping_engagement_does_not_conflict(self):
        existing = [make_engagement(dt(1, 9), dt(1, 10))]
        assert check_conflict(dt(1, 11), dt(1, 12), existing) is False

    def test_exact_boundary_adjacency_is_not_a_conflict(self):
        """A meeting ending exactly when another starts should not register as
        an overlap."""
        existing = [make_engagement(dt(1, 9), dt(1, 10))]
        assert check_conflict(dt(1, 10), dt(1, 11), existing) is False
        assert check_conflict(dt(1, 8), dt(1, 9), existing) is False

    def test_non_blocking_engagement_is_ignored(self):
        existing = [make_engagement(dt(1, 9), dt(1, 10), is_blocking=False)]
        assert check_conflict(dt(1, 9, 30), dt(1, 10, 30), existing) is False

    def test_excluded_id_is_ignored(self):
        engagement = make_engagement(dt(1, 9), dt(1, 10))
        assert (
            check_conflict(dt(1, 9, 30), dt(1, 10, 30), [engagement], exclude_id=engagement.id)
            is False
        )

    def test_new_interval_fully_containing_existing_conflicts(self):
        existing = [make_engagement(dt(1, 9, 30), dt(1, 10))]
        assert check_conflict(dt(1, 9), dt(1, 11), existing) is True

    def test_invalid_range_raises(self):
        with pytest.raises(ValueError):
            check_conflict(dt(1, 10), dt(1, 9), [])


# ---------------------------------------------------------------------------
# get_free_slots
# ---------------------------------------------------------------------------


class TestGetFreeSlots:
    def test_no_engagements_returns_full_working_window(self):
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=[],
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [Interval(dt(1, 9), dt(1, 17))]

    def test_back_to_back_meetings_leave_no_gap_between_them(self):
        existing = [
            make_engagement(dt(1, 9), dt(1, 10)),
            make_engagement(dt(1, 10), dt(1, 11)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [Interval(dt(1, 11), dt(1, 17))]

    def test_back_to_back_meetings_touching_working_hours_boundary(self):
        """A meeting starting exactly at day_start and one ending exactly at
        day_end should produce no zero-length slots at the edges."""
        existing = [
            make_engagement(dt(1, 9), dt(1, 12)),
            make_engagement(dt(1, 15), dt(1, 17)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [Interval(dt(1, 12), dt(1, 15))]

    def test_fully_booked_day_returns_no_slots(self):
        existing = [make_engagement(dt(1, 9), dt(1, 17))]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == []

    def test_overlapping_meetings_merge_before_inversion(self):
        existing = [
            make_engagement(dt(1, 9), dt(1, 11)),
            make_engagement(dt(1, 10), dt(1, 12)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [Interval(dt(1, 12), dt(1, 17))]

    def test_non_blocking_engagements_do_not_occupy_slots(self):
        existing = [make_engagement(dt(1, 9), dt(1, 10), is_blocking=False)]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [Interval(dt(1, 9), dt(1, 17))]

    def test_multi_day_span_computes_each_day_independently(self):
        existing = [
            make_engagement(dt(1, 9), dt(1, 10)),
            make_engagement(dt(2, 15), dt(2, 16)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(2, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [
            Interval(dt(1, 10), dt(1, 17)),
            Interval(dt(2, 9), dt(2, 15)),
            Interval(dt(2, 16), dt(2, 17)),
        ]

    def test_engagement_spanning_across_midnight_within_working_hours(self):
        """An engagement that starts on day 1 and ends on day 2, both portions
        inside working hours, should carve out time correctly on both days."""
        existing = [make_engagement(dt(1, 14), dt(2, 11))]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(2, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [
            Interval(dt(1, 9), dt(1, 14)),
            Interval(dt(2, 11), dt(2, 17)),
        ]

    def test_engagement_entirely_outside_working_hours_is_ignored(self):
        existing = [make_engagement(dt(1, 22), dt(2, 1))]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(2, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [
            Interval(dt(1, 9), dt(1, 17)),
            Interval(dt(2, 9), dt(2, 17)),
        ]

    def test_buffer_minutes_expands_busy_intervals(self):
        existing = [make_engagement(dt(1, 12), dt(1, 13))]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=15,
        )
        assert slots == [
            Interval(dt(1, 9), dt(1, 11, 45)),
            Interval(dt(1, 13, 15), dt(1, 17)),
        ]

    def test_buffer_can_bridge_two_close_meetings_into_one_busy_block(self):
        existing = [
            make_engagement(dt(1, 9), dt(1, 10)),
            make_engagement(dt(1, 10, 15), dt(1, 11)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=10,
        )
        assert slots == [Interval(dt(1, 11, 10), dt(1, 17))]

    def test_min_duration_filters_out_short_slots(self):
        existing = [
            make_engagement(dt(1, 9), dt(1, 10)),
            make_engagement(dt(1, 10, 20), dt(1, 17)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
            min_duration_minutes=30,
        )
        assert slots == []

    def test_min_duration_keeps_slots_at_or_above_threshold(self):
        existing = [
            make_engagement(dt(1, 9), dt(1, 10)),
            make_engagement(dt(1, 10, 30), dt(1, 17)),
        ]
        slots = get_free_slots(
            start_range=dt(1, 0),
            end_range=dt(1, 23, 59),
            existing_engagements=existing,
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
            min_duration_minutes=30,
        )
        assert slots == [Interval(dt(1, 10), dt(1, 10, 30))]

    def test_range_narrower_than_working_hours_clips_first_and_last_day(self):
        slots = get_free_slots(
            start_range=dt(1, 11),
            end_range=dt(1, 14),
            existing_engagements=[],
            working_hours_start=time(9, 0),
            working_hours_end=time(17, 0),
            buffer_minutes=0,
        )
        assert slots == [Interval(dt(1, 11), dt(1, 14))]

    def test_invalid_range_raises(self):
        with pytest.raises(ValueError):
            get_free_slots(
                start_range=dt(1, 17),
                end_range=dt(1, 9),
                existing_engagements=[],
                working_hours_start=time(9, 0),
                working_hours_end=time(17, 0),
            )

    def test_invalid_working_hours_raises(self):
        with pytest.raises(ValueError):
            get_free_slots(
                start_range=dt(1, 0),
                end_range=dt(1, 23, 59),
                existing_engagements=[],
                working_hours_start=time(17, 0),
                working_hours_end=time(9, 0),
            )
