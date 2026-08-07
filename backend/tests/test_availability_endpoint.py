import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db.database import get_session
from app.main import app


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)

    def override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


class TestOvernightFreeSlotsBoundary:
    """Regression coverage for the date_to/end_range boundary math in the
    /free-slots endpoint when day_start_hour > day_end_hour (overnight)."""

    def test_single_night_is_not_clipped(self, client: TestClient):
        response = client.get(
            "/api/v1/availability/free-slots",
            params={
                "date_from": "2026-08-08",
                "date_to": "2026-08-08",
                "day_start_hour": "23:00",
                "day_end_hour": "07:00",
                "min_duration_minutes": 1,
            },
        )
        assert response.status_code == 200
        slots = response.json()["slots"]
        assert slots == [
            {
                "start_time": "2026-08-08T23:00:00",
                "end_time": "2026-08-09T07:00:00",
                "duration_minutes": 480,
            }
        ]

    def test_multi_night_range_has_no_phantom_extra_night(self, client: TestClient):
        response = client.get(
            "/api/v1/availability/free-slots",
            params={
                "date_from": "2026-08-08",
                "date_to": "2026-08-10",
                "day_start_hour": "23:00",
                "day_end_hour": "07:00",
                "min_duration_minutes": 1,
            },
        )
        assert response.status_code == 200
        slots = response.json()["slots"]
        assert len(slots) == 3
        assert [s["start_time"] for s in slots] == [
            "2026-08-08T23:00:00",
            "2026-08-09T23:00:00",
            "2026-08-10T23:00:00",
        ]
        assert all(s["duration_minutes"] == 480 for s in slots)

    def test_equal_hours_still_rejected(self, client: TestClient):
        response = client.get(
            "/api/v1/availability/free-slots",
            params={
                "date_from": "2026-08-08",
                "date_to": "2026-08-08",
                "day_start_hour": "09:00",
                "day_end_hour": "09:00",
            },
        )
        assert response.status_code == 422

    def test_overnight_shift_fallback_from_saved_settings(self, client: TestClient):
        put_response = client.put(
            "/api/v1/settings/shift",
            json={"day_start_hour": "18:00", "day_end_hour": "02:00", "timezone": "Asia/Karachi"},
        )
        assert put_response.status_code == 200

        response = client.get(
            "/api/v1/availability/free-slots",
            params={"date_from": "2026-08-08", "date_to": "2026-08-08", "min_duration_minutes": 1},
        )
        assert response.status_code == 200
        slots = response.json()["slots"]
        # 18:00-02:00 PKT (UTC+5) == 13:00-21:00 UTC same day, 8 hours.
        assert slots == [
            {
                "start_time": "2026-08-08T13:00:00",
                "end_time": "2026-08-08T21:00:00",
                "duration_minutes": 480,
            }
        ]
