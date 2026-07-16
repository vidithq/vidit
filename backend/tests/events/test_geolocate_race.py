"""HTTP-level concurrency on the geolocate transition.

``services/events.geolocate`` locks the row with ``with_for_update()`` FIRST,
then re-checks ``status`` under the lock (see the function's docstring). Two
concurrent ``POST /events/{id}/geolocate`` calls on the same ``requested`` row
are meant to race on that lock: the DB, not app-level luck, should decide the
winner. This exercises the race through the real endpoint with two independent
``TestClient`` instances (each opens its own DB session via ``get_db``,
mirroring ``test_registration_pending.py::test_confirm_is_atomic_under_parallel_use``),
so the two requests genuinely contend for the row lock rather than serializing
on a single shared session.

The lock alone is not enough: the router's ``_resolve_live_event`` already
loaded this row into the session identity map, so the locked re-fetch must call
``.populate_existing()`` to overwrite the stale in-memory attributes from the
freshly locked row. With that in place the loser reads the post-lock
``geolocated`` status and gets a clean 409, so exactly one geolocate wins.
"""

from __future__ import annotations

import json
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.event import (
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
    EventInvestigator,
)
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as
from tests.events._helpers import proof_file_part, proof_form_field


@pytest.fixture
def third_user(db):
    """A second potential fulfiller, alongside ``second_user``.

    Unlike ``test_requests.py``'s same-named fixture (where ``third_user`` is
    only ever an investigator, never an owner), either racer here can win the
    fulfilment and become the event's ``owner_id``, so teardown needs the
    fuller ``owner_id`` / ``requested_by_id`` sweep ``conftest.py``'s
    ``_delete_user_and_events`` uses for ``author`` / ``second_user``, not
    just the contributor-table cleanup.
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
    db.query(EventInvestigator).filter(EventInvestigator.user_id == user_id).delete(
        synchronize_session=False
    )
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
