from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo


def to_naive_utc(value: datetime) -> datetime:
    """Normalize a datetime to naive UTC.

    Timezone-aware values are converted to UTC and stripped of tzinfo; naive
    values are assumed to already be UTC. SQLite does not preserve tzinfo on
    stored datetimes, so keeping everything as naive UTC end-to-end avoids
    aware/naive comparison errors between freshly-parsed request data and
    values read back from the database.
    """
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def local_time_to_utc(reference_date: date, local_time: time, tz_name: str) -> time:
    """Convert a wall-clock time-of-day in `tz_name` to its UTC equivalent.

    Used to translate a saved shift (e.g. "9:00 AM Asia/Karachi") into the
    literal UTC time-of-day the rest of the app operates in. `reference_date`
    anchors the conversion (needed for DST-observing zones); callers that
    apply the result uniformly across a date range should pick one
    representative date rather than re-deriving it per day.
    """
    localized = datetime.combine(reference_date, local_time, tzinfo=ZoneInfo(tz_name))
    return localized.astimezone(timezone.utc).time()
