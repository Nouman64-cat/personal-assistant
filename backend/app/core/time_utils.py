from datetime import datetime, timezone


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
