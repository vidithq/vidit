"""``observability``: what a captured Sentry event carries, and how a log record prints.

Sentry tests boot the SDK with an in-memory transport, then reset the global
client. Logging tests run in a fresh interpreter because ``configure_logging``
rewires the root logger.
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
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.database import engine
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

# Uvicorn applies its logging config before it imports the app; building its
# ``Config`` does the same here.
_UVICORN = "import logging, uvicorn.config\nuvicorn.config.Config('app.main:app'{options})\n"
_CONFIGURE = "from app.observability import configure_logging, request_id\nconfigure_logging()\n"


def _raw(script: str, *, log_level: str = "INFO") -> tuple[str, str]:
    """What a fresh interpreter prints for ``script``: (stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, "-W", "ignore", "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "LOG_LEVEL": log_level},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout, result.stderr


def _run(script: str, *, log_level: str = "INFO") -> tuple[list[tuple[str, ...]], ...]:
    """``_raw``, each stream parsed into one tuple per ``LOG_FORMAT`` line."""
    streams = []
    for output in _raw(script, log_level=log_level):
        lines = [_LOG_LINE.fullmatch(line) for line in output.splitlines()]
        assert all(lines), output
        streams.append([line.groups() for line in lines if line])
    return tuple(streams)


def test_each_record_prints_once_on_one_line_with_its_request_id():
    stdout, stderr = _run(
        _UVICORN.format(options="")
        + _CONFIGURE
        + "logging.getLogger('app.services.email').info('outside a request')\n"
        "logging.getLogger('httpx').info('library chatter below WARNING')\n"
        "logging.getLogger('uvicorn.error').info('Application startup complete.')\n"
        "request_id.set('req-7')\n"
        "logging.getLogger('app.routers.auth').warning('inside a request')\n"
        "logging.getLogger('uvicorn.access').info("
        "'%s - \"%s %s HTTP/%s\" %d', '127.0.0.1:5000', 'GET', '/health', '1.1', 200)\n"
        "logging.getLogger('uvicorn.error').error('Exception in ASGI application')\n"
    )

    assert stdout == [
        ("INFO", "app.services.email", "-", "outside a request"),
        ("INFO", "uvicorn.error", "-", "Application startup complete."),
        ("INFO", "uvicorn.access", "req-7", '127.0.0.1:5000 - "GET /health HTTP/1.1" 200'),
    ]
    assert stderr == [
        ("WARNING", "app.routers.auth", "req-7", "inside a request"),
        ("ERROR", "uvicorn.error", "req-7", "Exception in ASGI application"),
    ]


def test_log_level_sets_the_level_of_the_app_loggers_in_any_case():
    stdout, stderr = _run(
        _UVICORN.format(options="")
        + _CONFIGURE
        + "logging.getLogger('app.services.bot').info('below the level')\n"
        "logging.getLogger('app.services.bot').warning('at the level')\n",
        log_level="warning",
    )

    assert stdout == []
    assert [message for *_, message in stderr] == ["at the level"]


def test_the_api_prints_app_records_under_uvicorn():
    stdout, stderr = _run(
        _UVICORN.format(options="")
        + "import app.main\n"
        + "logging.getLogger('app.services.email').info('after the import')\n",
        log_level="info",
    )

    assert ("INFO", "app.services.email", "-", "after the import") in stdout


def test_no_access_log_keeps_the_access_log_off():
    stdout, stderr = _run(
        _UVICORN.format(options=", access_log=False")
        + _CONFIGURE
        + "logging.getLogger('uvicorn.access').info('GET /health 200')\n"
        "logging.getLogger('app.services.bot').info('still printed')\n"
    )

    assert [message for *_, message in stdout] == ["still printed"]
    assert stderr == []


def test_a_root_logger_set_up_by_log_config_is_kept():
    stdout, stderr = _raw(
        "import logging, sys\n"
        "logging.basicConfig(stream=sys.stdout, format='custom %(message)s')\n"
        + _CONFIGURE
        + "logging.getLogger('app.services.bot').warning('kept')\n"
    )

    assert (stdout, stderr) == ("custom kept\n", "")


def test_database_error_text_carries_no_bound_parameters():
    secret = uuid.uuid4().hex
    with engine.connect() as conn, pytest.raises(DBAPIError) as caught:
        # A runtime error: the server's own message quotes no query text.
        conn.execute(text("SELECT 1 / 0, CAST(:value AS text)"), {"value": secret})
    assert secret not in str(caught.value)
