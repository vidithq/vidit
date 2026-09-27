"""HTTP-level concurrency on the geolocate transition.

``services/events.geolocate`` locks the row with ``with_for_update()`` FIRST,
then re-checks ``status`` under the lock (see the function's docstring). Two
concurrent ``POST /events/{id}/geolocate`` calls on the same ``requested`` row
are meant to race on that lock: the DB, not app-level luck, should decide the
winner. The first test exercises the race through the real endpoint with two
independent ``TestClient`` instances (each opens its own DB session via
``get_db``, mirroring
``test_registration_pending.py::test_confirm_is_atomic_under_parallel_use``),
so the two requests genuinely contend for the row lock rather than serializing
on a single shared session.

The lock alone is not enough: the router's ``_resolve_live_event`` already
loaded this row into the session identity map, so the locked re-fetch must call
``.populate_existing()`` to overwrite the stale in-memory attributes from the
freshly locked row. With that in place the loser reads the post-lock
``geolocated`` status and gets a clean 409, so exactly one geolocate wins.

Two clients also mean two event loops, and production has one: a single uvicorn
process serves every request. The shared-loop test sends both geolocates
through one ``with TestClient(app)``, so the request queued on the row lock
stalls the whole API unless its handler keeps every query off that loop. The
last test pins the bound on any lock wait, ``database.LOCK_TIMEOUT_MS``, and
the 409 that answers it.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from app.database import LOCK_TIMEOUT_MS, engine
from app.main import app
from app.models.event import (
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
)
from app.models.user import User
from app.services import evidence_intake
from app.services.auth import create_access_token, hash_password
from app.services.auth_cookies import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE
from tests.conftest import TEST_CSRF_TOKEN, login_as
from tests.events._helpers import client, proof_file_part, proof_form_field

# Every wait in the shared-loop test is bounded, so a regression fails it rather
# than hanging the suite: ``lock_timeout`` frees a loop stuck in a lock wait,
# and these bound the rest.
_WAIT_S = 30
# How long ``/health`` may take while a writer waits on the row lock: well
# under the lock timeout, which is how long a stuck loop stays stuck.
_PROBE_S = LOCK_TIMEOUT_MS / 1000 / 2


@pytest.fixture
def third_user(db):
    """A second potential fulfiller, alongside ``second_user``.

    Either racer here can win the fulfilment and become the event's
    ``owner_id``, so teardown needs the fuller ``owner_id`` /
    ``requested_by_id`` sweep ``conftest.py``'s ``_delete_user_and_events``
    uses for ``author`` / ``second_user``, not just the credit-table cleanup.
    """
    user = User(
        username=f"race{uuid.uuid4().hex[:8]}",
        email=f"race-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(EventGeolocator).filter(EventGeolocator.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.requested_by_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _make_requested_with_media(db, *, author):
    """A ``requested`` event with its one source media, mirroring
    ``test_requests.py::_make_request`` (kept local: this suite only needs the
    happy-path shape, not the withdrawn / tagged variants that module
    supports)."""
    from datetime import UTC, datetime

    from app.models.media import Media

    now = datetime.now(UTC)
    request = Event(
        owner_id=author.id,
        requested_by_id=author.id,
        title="Race target",
        source_url="https://example.com/post",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=now,
    )
    db.add(request)
    db.flush()
    db.add(
        Media(
            event_id=request.id,
            role="source",
            storage_url=f"http://localhost:8000/local-storage/request_uploads/{request.id}/x.jpg",
            media_type="image",
        )
    )
    db.commit()
    db.refresh(request)
    return request


def _fulfilment_form(conflict, capture_source_tag, *, title: str) -> dict[str, str]:
    return {
        "title": title,
        "lat": "48.5",
        "lng": "34.5",
        "source_url": "https://example.com/post",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
        "proof": proof_form_field(),
    }


def test_concurrent_geolocate_exactly_one_wins(
    db, author, second_user, third_user, conflict, capture_source_tag
):
    """Two different analysts both try to fulfil the same open request at once.

    Both requests reach the endpoint with the row still ``requested``; the
    ``with_for_update()`` lock in ``services.events.geolocate`` serializes them
    at the database, and ``populate_existing()`` makes the loser re-read the
    locked row, so exactly one sees ``200`` (and becomes owner + the sole
    geolocator) while the other sees a clean ``409 invalid_state``, never a 500,
    and never two winners.
    """
    request = _make_requested_with_media(db, author=author)
    request_id = request.id

    statuses: list[int] = []
    bodies: list[dict] = []
    barrier = threading.Barrier(2)

    def worker(fulfiller, title: str) -> None:
        c = TestClient(app)
        headers = login_as(c, fulfiller)
        data = _fulfilment_form(conflict, capture_source_tag, title=title)
        barrier.wait(timeout=2)
        response = c.post(
            f"/api/v1/events/{request_id}/geolocate",
            headers=headers,
            data=data,
            files=[proof_file_part()],
        )
        statuses.append(response.status_code)
        bodies.append(response.json())

    t1 = threading.Thread(target=worker, args=(second_user, "Fulfilled by second_user"))
    t2 = threading.Thread(target=worker, args=(third_user, "Fulfilled by third_user"))
    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    # Exactly one clean win, one clean documented conflict: never a 500 and
    # never two winners.
    winners = [s for s in statuses if s == 200]
    losers = [s for s in statuses if s == 409]
    assert len(winners) == 1, f"exactly one geolocate must succeed; got {statuses}"
    assert len(losers) == 1, f"the loser must see a clean 409; got {statuses}"
    loser_body = bodies[statuses.index(409)]
    assert loser_body["detail"]["code"] == "invalid_state"

    # The row moved exactly once: geolocated, owned by whichever fulfiller won
    # (not left ``requested``, not double-flipped).
    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.owner_id in (second_user.id, third_user.id)
    assert row.requested_by_id == author.id  # the original poster, untouched

    # Exactly one durable geolocator credit row: the loser's attempt left no
    # trace in the credit table.
    credit = db.query(EventGeolocator).filter(EventGeolocator.event_id == request_id).all()
    assert len(credit) == 1
    assert credit[0].user_id == row.owner_id


def _session_headers(user: User) -> dict[str, str]:
    """``login_as`` for a client two users share: the cookies ride on the request."""
    cookies = f"{SESSION_COOKIE}={create_access_token(user)}; {CSRF_COOKIE}={TEST_CSRF_TOKEN}"
    return {"Cookie": cookies, CSRF_HEADER: TEST_CSRF_TOKEN}


def _lock_waiter_appears(db) -> bool:
    """Whether a backend on this database starts waiting on a lock within ``_WAIT_S``."""
    deadline = time.monotonic() + _WAIT_S
    while time.monotonic() < deadline:
        waiting = db.execute(
            text(
                "SELECT count(*) FROM pg_stat_activity"
                " WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
        ).scalar_one()
        # pg_stat_activity is snapshotted per transaction: end it to read afresh.
        db.rollback()
        if waiting:
            return True
        time.sleep(0.02)
    return False


def test_a_writer_queued_on_the_row_lock_leaves_the_loop_serving(
    db, author, second_user, third_user, conflict, capture_source_tag, monkeypatch
):
    """Both geolocates share one event loop, as they do in production.

    The holder takes the row lock and pauses inside its upload; the waiter
    queues on that lock. The wait must block the waiter's own worker thread and
    nothing else: the loop keeps answering ``/health`` and runs no query, the
    holder resumes and commits, and the waiter re-reads a ``geolocated`` row and
    loses on ``invalid_state``. With a handler back on the loop, the waiter's
    lock wait blocks the loop, the holder cannot resume to release the lock, and
    only ``lock_timeout`` ends the stall, with a ``lock_timeout`` 409.
    """
    request_id = _make_requested_with_media(db, author=author).id

    holding = threading.Event()
    release = threading.Event()
    upload = evidence_intake.upload_proof_image

    async def paused_upload(file, user_id):
        if not holding.is_set():
            holding.set()
            await asyncio.to_thread(release.wait, _WAIT_S)
        return await upload(file, user_id)

    monkeypatch.setattr(evidence_intake, "upload_proof_image", paused_upload)

    responses: dict[str, object] = {}
    threads: list[threading.Thread] = []
    loop_statements: list[str] = []

    with TestClient(app) as shared:
        loop_thread = shared.portal.call(threading.current_thread)

        def record(_conn, _cursor, statement, *_args) -> None:
            if threading.current_thread() is loop_thread:
                loop_statements.append(statement)

        def send(name: str, method: str, path: str, **kwargs) -> threading.Thread:
            def run() -> None:
                try:
                    responses[name] = shared.request(method, path, **kwargs)
                except Exception as exc:  # noqa: BLE001 (surfaced by the asserts)
                    responses[name] = exc

            thread = threading.Thread(target=run)
            threads.append(thread)
            thread.start()
            return thread

        def geolocate(name: str, fulfiller: User) -> None:
            send(
                name,
                "POST",
                f"/api/v1/events/{request_id}/geolocate",
                headers=_session_headers(fulfiller),
                data=_fulfilment_form(conflict, capture_source_tag, title=f"By {name}"),
                files=[proof_file_part()],
            )

        event.listen(engine, "before_cursor_execute", record)
        try:
            geolocate("holder", second_user)
            assert holding.wait(_WAIT_S), "the holder never reached its upload"
            geolocate("waiter", third_user)
            assert _lock_waiter_appears(db), "the waiter never queued on the row lock"
            probe = send("health", "GET", "/health")
            probe.join(_PROBE_S)
            health_answered = not probe.is_alive()
        finally:
            release.set()
            for thread in threads:
                thread.join(_WAIT_S)
            event.remove(engine, "before_cursor_execute", record)

    assert health_answered, "/health stalled while a writer waited on the row lock"
    assert loop_statements == [], "queries ran on the event loop"
    holder, waiter = responses["holder"], responses["waiter"]
    assert getattr(holder, "status_code", None) == 200, holder
    assert getattr(waiter, "status_code", None) == 409, waiter
    assert waiter.json()["detail"]["code"] == "invalid_state"

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.owner_id == second_user.id
    assert row.requested_by_id == author.id
    credit = db.query(EventGeolocator).filter(EventGeolocator.event_id == request_id).all()
    assert [c.user_id for c in credit] == [second_user.id]


def test_a_lock_wait_past_the_timeout_answers_409(
    db, author, second_user, conflict, capture_source_tag
):
    """A geolocate queued behind a lock nobody releases gives up and answers 409.

    The test's own session holds the row lock for the whole request, so the
    wait ends only when Postgres cancels it at ``LOCK_TIMEOUT_MS``, and
    ``get_db`` answers that with the typed ``lock_timeout`` envelope rather than
    a 500. Nothing is written.
    """
    request_id = _make_requested_with_media(db, author=author).id
    db.query(Event).filter(Event.id == request_id).with_for_update().one()
    try:
        started = time.monotonic()
        response = client.post(
            f"/api/v1/events/{request_id}/geolocate",
            headers=login_as(client, second_user),
            data=_fulfilment_form(conflict, capture_source_tag, title="Never lands"),
            files=[proof_file_part()],
        )
        waited = time.monotonic() - started
    finally:
        db.rollback()

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "lock_timeout"
    assert waited >= LOCK_TIMEOUT_MS / 1000
    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().status == STATUS_REQUESTED
