from datetime import date, time
from zoneinfo import ZoneInfoNotFoundError

import pytest

from app.core.time_utils import local_time_to_utc


class TestLocalTimeToUtc:
    def test_utc_timezone_is_unchanged(self):
        assert local_time_to_utc(date(2026, 8, 8), time(9, 0), "UTC") == time(9, 0)

    def test_fixed_positive_offset_no_dst(self):
        """Asia/Karachi is UTC+5 year-round (no DST)."""
        assert local_time_to_utc(date(2026, 8, 8), time(9, 0), "Asia/Karachi") == time(4, 0)
        assert local_time_to_utc(date(2026, 8, 8), time(18, 0), "Asia/Karachi") == time(13, 0)

    def test_dst_observing_zone_winter(self):
        """America/New_York is UTC-5 (EST) in January."""
        assert local_time_to_utc(date(2026, 1, 15), time(9, 0), "America/New_York") == time(14, 0)

    def test_dst_observing_zone_summer(self):
        """America/New_York is UTC-4 (EDT) in July — same wall-clock time,
        different UTC offset, which is exactly why `reference_date` matters."""
        assert local_time_to_utc(date(2026, 7, 15), time(9, 0), "America/New_York") == time(13, 0)

    def test_unknown_timezone_raises(self):
        with pytest.raises(ZoneInfoNotFoundError):
            local_time_to_utc(date(2026, 8, 8), time(9, 0), "Not/AZone")
