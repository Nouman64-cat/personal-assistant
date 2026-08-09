from datetime import datetime

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import EngagementCategory
from app.schemas.engagement import EngagementCreate, EngagementUpdate
from app.services import engagement_service
from app.services.engagement_service import EngagementConflictError, EngagementNotFoundError


@pytest.fixture()
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def make_payload(start: datetime, end: datetime, title: str = "Test") -> EngagementCreate:
    return EngagementCreate(
        title=title, start_time=start, end_time=end, category=EngagementCategory.MEETING
    )


class TestCreateEngagement:
    def test_creates_and_persists(self, session: Session):
        engagement = engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10))
        )
        assert engagement.id is not None
        assert engagement_service.get_engagement_or_404(session, engagement.id).title == "Test"

    def test_rejects_conflicting_blocking_engagement(self, session: Session):
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10))
        )
        with pytest.raises(EngagementConflictError):
            engagement_service.create_engagement(
                session, make_payload(datetime(2026, 8, 9, 9, 30), datetime(2026, 8, 9, 10, 30))
            )

    def test_allows_non_blocking_overlap(self, session: Session):
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10))
        )
        payload = make_payload(datetime(2026, 8, 9, 9, 30), datetime(2026, 8, 9, 10, 30))
        payload.is_blocking = False
        engagement = engagement_service.create_engagement(session, payload)
        assert engagement.id is not None


class TestUpdateEngagement:
    def test_updates_fields(self, session: Session):
        engagement = engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10))
        )
        updated = engagement_service.update_engagement(
            session, engagement.id, EngagementUpdate(title="Renamed")
        )
        assert updated.title == "Renamed"

    def test_raises_not_found_for_unknown_id(self, session: Session):
        import uuid

        with pytest.raises(EngagementNotFoundError):
            engagement_service.update_engagement(session, uuid.uuid4(), EngagementUpdate(title="X"))

    def test_raises_conflict_when_moved_into_another(self, session: Session):
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10), title="A")
        )
        b = engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 11), datetime(2026, 8, 9, 12), title="B")
        )
        with pytest.raises(EngagementConflictError):
            engagement_service.update_engagement(
                session,
                b.id,
                EngagementUpdate(start_time=datetime(2026, 8, 9, 9, 30), end_time=datetime(2026, 8, 9, 10, 30)),
            )

    def test_raises_value_error_for_invalid_range(self, session: Session):
        engagement = engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10))
        )
        with pytest.raises(ValueError):
            engagement_service.update_engagement(
                session,
                engagement.id,
                EngagementUpdate(start_time=datetime(2026, 8, 9, 12), end_time=datetime(2026, 8, 9, 11)),
            )


class TestDeleteEngagement:
    def test_deletes_and_returns_snapshot(self, session: Session):
        engagement = engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10))
        )
        snapshot = engagement_service.delete_engagement(session, engagement.id)
        assert snapshot.title == "Test"
        with pytest.raises(EngagementNotFoundError):
            engagement_service.get_engagement_or_404(session, engagement.id)


class TestListEngagements:
    def test_filters_by_title(self, session: Session):
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10), title="Standup")
        )
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 11), datetime(2026, 8, 9, 12), title="Interview")
        )
        results = engagement_service.list_engagements(session, title_contains="stand")
        assert len(results) == 1
        assert results[0].title == "Standup"

    def test_orders_by_start_time(self, session: Session):
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 11), datetime(2026, 8, 9, 12), title="Later")
        )
        engagement_service.create_engagement(
            session, make_payload(datetime(2026, 8, 9, 9), datetime(2026, 8, 9, 10), title="Earlier")
        )
        results = engagement_service.list_engagements(session)
        assert [e.title for e in results] == ["Earlier", "Later"]
