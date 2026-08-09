import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import openai
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.core.config import settings
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
    settings.OPENAI_API_KEY = "test-key"
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def make_completion(content=None, tool_calls=None):
    message = SimpleNamespace(content=content, tool_calls=tool_calls)
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


def make_tool_call(call_id: str, name: str, arguments: dict):
    return SimpleNamespace(
        id=call_id, function=SimpleNamespace(name=name, arguments=json.dumps(arguments))
    )


def make_api_error(exc_cls, status_code=429):
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(status_code, request=request)
    return exc_cls("boom", response=response, body=None)


@pytest.fixture()
def mock_openai():
    with patch("app.services.chat_service.openai.OpenAI") as mock_ctor:
        mock_client = MagicMock()
        mock_ctor.return_value = mock_client
        yield mock_client


class TestSendMessage:
    def test_first_message_creates_a_session(self, client: TestClient, mock_openai):
        mock_openai.chat.completions.create.side_effect = [
            make_completion(content="Hi there, how can I help?")
        ]

        response = client.post("/api/v1/chat/messages", json={"message": "hello"})

        assert response.status_code == 200
        body = response.json()
        assert body["session_id"]
        assert body["reply"] == "Hi there, how can I help?"
        assert body["actions"] == []

    def test_create_engagement_tool_round_trip(self, client: TestClient, mock_openai):
        tool_call = make_tool_call(
            "call_1",
            "create_engagement",
            {
                "title": "Call with Sam",
                "start_time": "2026-08-09T15:00:00+00:00",
                "end_time": "2026-08-09T15:30:00+00:00",
                "category": "meeting",
            },
        )
        mock_openai.chat.completions.create.side_effect = [
            make_completion(tool_calls=[tool_call]),
            make_completion(content="Scheduled your call with Sam."),
        ]

        response = client.post(
            "/api/v1/chat/messages",
            json={"message": "Schedule a call with Sam tomorrow 3-3:30pm"},
        )

        assert response.status_code == 200
        body = response.json()
        assert len(body["actions"]) == 1
        assert body["actions"][0]["type"] == "created"
        assert body["actions"][0]["engagement"]["title"] == "Call with Sam"

        engagements = client.get("/api/v1/engagements/").json()
        assert len(engagements) == 1
        assert engagements[0]["title"] == "Call with Sam"

    def test_followup_turn_replays_history(self, client: TestClient, mock_openai):
        mock_openai.chat.completions.create.side_effect = [
            make_completion(content="First reply"),
            make_completion(content="Second reply"),
        ]

        first = client.post("/api/v1/chat/messages", json={"message": "first message"})
        session_id = first.json()["session_id"]

        client.post(
            "/api/v1/chat/messages",
            json={"session_id": session_id, "message": "second message"},
        )

        second_call_kwargs = mock_openai.chat.completions.create.call_args_list[1].kwargs
        roles_and_content = [
            (m["role"], m.get("content")) for m in second_call_kwargs["messages"]
        ]
        assert ("user", "first message") in roles_and_content
        assert ("assistant", "First reply") in roles_and_content
        assert ("user", "second message") in roles_and_content

    def test_list_then_update_engagement_resolves_id(self, client: TestClient, mock_openai):
        create_call = make_tool_call(
            "call_1",
            "create_engagement",
            {
                "title": "Standup",
                "start_time": "2026-08-09T09:00:00+00:00",
                "end_time": "2026-08-09T09:15:00+00:00",
                "category": "meeting",
            },
        )
        mock_openai.chat.completions.create.side_effect = [
            make_completion(tool_calls=[create_call]),
            make_completion(content="Created the standup."),
        ]
        first = client.post("/api/v1/chat/messages", json={"message": "add a standup tomorrow 9-9:15am"})
        session_id = first.json()["session_id"]

        # Second turn: the model must resolve "the standup" via list_engagements
        # before it can call update_engagement with a real id.
        list_call = make_tool_call("call_2", "list_engagements", {"title_contains": "Standup"})

        def second_turn_side_effect(*args, **kwargs):
            tool_messages = [
                m
                for m in kwargs["messages"]
                if m.get("role") == "tool" and m.get("tool_call_id") in ("call_2", "call_3")
            ]
            if not tool_messages:
                return make_completion(tool_calls=[list_call])
            if len(tool_messages) == 1:
                found_id = json.loads(tool_messages[-1]["content"])["engagements"][0]["id"]
                update_call = make_tool_call(
                    "call_3",
                    "update_engagement",
                    {
                        "engagement_id": found_id,
                        "start_time": "2026-08-09T10:00:00+00:00",
                        "end_time": "2026-08-09T10:15:00+00:00",
                    },
                )
                return make_completion(tool_calls=[update_call])
            return make_completion(content="Moved the standup to 10am.")

        mock_openai.chat.completions.create.side_effect = second_turn_side_effect

        response = client.post(
            "/api/v1/chat/messages",
            json={"session_id": session_id, "message": "move the standup to 10am"},
        )

        assert response.status_code == 200
        actions = response.json()["actions"]
        assert actions[-1]["type"] == "updated"
        assert actions[-1]["engagement"]["start_time"] == "2026-08-09T10:00:00"

        engagements = client.get("/api/v1/engagements/").json()
        assert engagements[0]["start_time"] == "2026-08-09T10:00:00"

    def test_unknown_session_id_returns_404(self, client: TestClient, mock_openai):
        response = client.get(
            "/api/v1/chat/00000000-0000-0000-0000-000000000000/messages"
        )
        assert response.status_code == 404

    def test_exceeding_max_roundtrips_returns_502(self, client: TestClient, mock_openai):
        looping_call = make_tool_call("call_x", "list_engagements", {})
        mock_openai.chat.completions.create.side_effect = [
            make_completion(tool_calls=[looping_call]) for _ in range(settings.CHAT_MAX_TOOL_ROUNDTRIPS)
        ]

        response = client.post("/api/v1/chat/messages", json={"message": "loop forever"})
        assert response.status_code == 502

    def test_rate_limit_error_maps_to_429(self, client: TestClient, mock_openai):
        mock_openai.chat.completions.create.side_effect = make_api_error(openai.RateLimitError, 429)

        response = client.post("/api/v1/chat/messages", json={"message": "hello"})
        assert response.status_code == 429

    def test_blank_message_is_rejected(self, client: TestClient, mock_openai):
        # A single space passes the schema's min_length=1 but fails the
        # service's own `.strip()` check, exercising that 400 path.
        response = client.post("/api/v1/chat/messages", json={"message": " "})
        assert response.status_code == 400
