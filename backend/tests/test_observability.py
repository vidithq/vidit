"""``observability.init_sentry``: what a captured event carries.

Each test boots the SDK through the helper with an in-memory transport in place
of the network one, then resets the global client so later tests in the worker
report nowhere.
"""

from __future__ import annotations

import json
import uuid

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

from app.config import settings
from app.observability import init_sentry


class _CapturingTransport(Transport):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict] = []

    def capture_envelope(self, envelope) -> None:
        event = envelope.get_event()
        if event is not None:
            self.events.append(event)


@pytest.fixture
def sentry_events(monkeypatch):
    transport = _CapturingTransport()
    real_init = sentry_sdk.init
    monkeypatch.setattr(settings, "sentry_dsn", "https://public@example.invalid/1")
    monkeypatch.setattr(
        sentry_sdk, "init", lambda **options: real_init(**options, transport=transport)
    )
    init_sentry()
    yield transport.events
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)


def _fail(new_password: str) -> None:
    raise RuntimeError("boom")


def test_captured_exception_carries_no_frame_variables(sentry_events):
    secret = uuid.uuid4().hex
    try:
        _fail(secret)
    except RuntimeError as exc:
        sentry_sdk.capture_exception(exc)
    sentry_sdk.flush()

    (event,) = sentry_events
    frames = [
        frame for value in event["exception"]["values"] for frame in value["stacktrace"]["frames"]
    ]
    assert frames
    assert all("vars" not in frame for frame in frames)
    assert secret not in json.dumps(event, default=str)


def test_server_error_event_carries_no_request_body(sentry_events):
    api = FastAPI()

    @api.post("/fail")
    def fail(body: dict[str, str]) -> None:
        raise RuntimeError("boom")

    secret = uuid.uuid4().hex
    client = TestClient(api, raise_server_exceptions=False)
    response = client.post("/fail", json={"new_password": secret})
    sentry_sdk.flush()

    assert response.status_code == 500
    assert sentry_events
    assert secret not in json.dumps(sentry_events, default=str)
