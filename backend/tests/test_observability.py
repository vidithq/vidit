"""``observability``: what a captured Sentry event carries, and how a log record prints.

Each Sentry test boots the SDK through the helper with an in-memory transport in
place of the network one, then resets the global client so later tests in the
worker report nowhere. The logging tests run ``configure_logging`` in a fresh
interpreter, since it rewires the process's root logger.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

from app.config import settings
from app.dependencies import get_db
from app.main import app
from app.middleware.request_id import REQUEST_ID_HEADER
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


def test_server_error_event_carries_the_request_id(sentry_events):
    def unreachable_db():
        raise RuntimeError("database unreachable")

    app.dependency_overrides[get_db] = unreachable_db
    try:
        response = TestClient(app, raise_server_exceptions=False).get(
            "/api/v1/tags", headers={REQUEST_ID_HEADER: "req-sentry"}
        )
    finally:
        del app.dependency_overrides[get_db]
    sentry_sdk.flush()

    assert response.headers[REQUEST_ID_HEADER] == "req-sentry"
    (event,) = sentry_events
    assert event["tags"]["request_id"] == "req-sentry"


# <timestamp> <level> <logger> [<request id>] <message>
_LOG_LINE = re.compile(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3} (\S+) (\S+) \[([^]]+)\] (.*)")


def _printed(statements: str, *, log_level: str) -> list[tuple[str, ...]]:
    """What a fresh interpreter prints for ``statements``, one tuple per line.

    Uvicorn applies its logging config before it imports the app, so the
    interpreter does the same before ``configure_logging`` runs.
    """
    result = subprocess.run(
        [
            sys.executable,
            "-W",
            "ignore",
            "-c",
            "import logging, logging.config, uvicorn.config\n"
            "logging.config.dictConfig(uvicorn.config.LOGGING_CONFIG)\n"
            "from app.observability import configure_logging, request_id\n"
            "configure_logging()\n" + statements,
        ],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "LOG_LEVEL": log_level},
        capture_output=True,
        text=True,
    )
    assert (result.returncode, result.stderr) == (0, "")
    lines = [_LOG_LINE.fullmatch(line) for line in result.stdout.splitlines()]
    assert all(lines), result.stdout
    return [line.groups() for line in lines if line]


def test_each_record_prints_once_on_one_line_with_its_request_id():
    printed = _printed(
        "logging.getLogger('app.services.email').info('outside a request')\n"
        "logging.getLogger('httpx').info('library chatter below WARNING')\n"
        "logging.getLogger('uvicorn.error').info('Application startup complete.')\n"
        "request_id.set('req-7')\n"
        "logging.getLogger('app.routers.auth').warning('inside a request')\n"
        "logging.getLogger('uvicorn.access').info("
        "'%s - \"%s %s HTTP/%s\" %d', '127.0.0.1:5000', 'GET', '/health', '1.1', 200)\n",
        log_level="INFO",
    )

    assert printed == [
        ("INFO", "app.services.email", "-", "outside a request"),
        ("INFO", "uvicorn.error", "-", "Application startup complete."),
        ("WARNING", "app.routers.auth", "req-7", "inside a request"),
        ("INFO", "uvicorn.access", "req-7", '127.0.0.1:5000 - "GET /health HTTP/1.1" 200'),
    ]


def test_log_level_sets_the_level_of_the_app_loggers():
    printed = _printed(
        "logging.getLogger('app.services.bot').info('below the level')\n"
        "logging.getLogger('app.services.bot').warning('at the level')\n",
        log_level="WARNING",
    )

    assert [message for *_, message in printed] == ["at the level"]
