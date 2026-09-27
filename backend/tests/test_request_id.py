"""``RequestIdMiddleware``: every response names its request, and so does
every log record the request emits, on the event loop or off it."""

from __future__ import annotations

import asyncio
import logging

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import get_db
from app.main import app
from app.middleware.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from app.observability import RequestIdFilter

client = TestClient(app)
log = logging.getLogger(__name__)


@pytest.fixture
def records():
    """This module's records, stamped by the filter the stdout handler carries."""
    collected: list[logging.LogRecord] = []

    class Collect(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            collected.append(record)

    handler = Collect()
    handler.addFilter(RequestIdFilter())
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    yield collected
    log.removeHandler(handler)
    log.setLevel(logging.NOTSET)


def _unreachable_db():
    log.error("database unreachable")
    raise RuntimeError("database unreachable")


@pytest.fixture
def broken_db():
    """Every route that opens a session raises an unhandled exception."""
    app.dependency_overrides[get_db] = _unreachable_db
    yield
    del app.dependency_overrides[get_db]


def test_a_minted_request_id_is_new_per_request_and_accepted_back():
    minted = client.get("/health").headers[REQUEST_ID_HEADER]
    assert client.get("/health").headers[REQUEST_ID_HEADER] != minted

    echoed = client.get("/health", headers={REQUEST_ID_HEADER: minted})
    assert echoed.headers[REQUEST_ID_HEADER] == minted


@pytest.mark.parametrize("safe", ["web-42.retry_1", "a" * 64])
def test_a_safe_incoming_request_id_is_echoed(safe):
    response = client.get("/health", headers={REQUEST_ID_HEADER: safe})
    assert response.headers[REQUEST_ID_HEADER] == safe


@pytest.mark.parametrize("unsafe", ["a" * 65, "two words", "one\nline\nper\nrecord", ""])
def test_an_unsafe_incoming_request_id_is_replaced(unsafe):
    response = client.get("/health", headers={REQUEST_ID_HEADER: unsafe})
    assert response.headers[REQUEST_ID_HEADER] not in (unsafe, "")


def test_a_server_error_names_its_request_in_the_response_and_the_log(broken_db, records):
    # The 500 comes from Starlette's outermost error layer; the record comes
    # from a sync dependency, which FastAPI runs in its threadpool.
    response = TestClient(app, raise_server_exceptions=False).get(
        "/api/v1/tags", headers={REQUEST_ID_HEADER: "req-500"}
    )

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER] == "req-500"
    assert [record.request_id for record in records] == ["req-500"]


async def test_the_server_traceback_record_carries_the_request_id(broken_db, records):
    # Uvicorn logs an unhandled exception after the app raised, in the task
    # that awaited it; ASGITransport awaits the app in this test's task.
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        with pytest.raises(RuntimeError):
            await http.get("/api/v1/tags", headers={REQUEST_ID_HEADER: "req-traceback"})
    log.error("Exception in ASGI application")

    assert [record.request_id for record in records] == ["req-traceback", "req-traceback"]


probe_api = FastAPI()


@probe_api.get("/sync")
def sync_route() -> None:
    log.info("sync route, in FastAPI's threadpool")


async def _log_from_a_coroutine() -> None:
    log.info("coroutine on the worker thread's own event loop")


@probe_api.get("/sync-driving-a-coroutine")
def sync_route_driving_a_coroutine() -> None:
    asyncio.run(_log_from_a_coroutine())


@probe_api.get("/to-thread")
async def async_route_offloading_to_a_thread() -> None:
    await asyncio.to_thread(log.info, "asyncio.to_thread")


probe = TestClient(RequestIdMiddleware(probe_api))


@pytest.mark.parametrize("path", ["/sync", "/sync-driving-a-coroutine", "/to-thread"])
def test_a_record_emitted_off_the_event_loop_carries_the_request_id(path, records):
    response = probe.get(path)

    assert response.status_code == 200
    assert [record.request_id for record in records] == [response.headers[REQUEST_ID_HEADER]]
