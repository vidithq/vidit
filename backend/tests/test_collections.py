"""End-to-end tests for the collections endpoints.

A collection is a named set of one analyst's own events. What these lock in:

* ``POST`` / ``PATCH`` / ``DELETE /collections``: an owner opens a collection
  under a title and a required description, writes both together, and drops
  one, which leaves every event it held alone. A blank or over-long
  description is a 422 on either write.
* ``PUT`` / ``DELETE /collections/{id}/events/{event_id}``: both idempotent,
  403 when the collection or the event belongs to someone else, 409 when the
  event's status is not one a collection shows, 404 on an unknown event.
* ``GET /collections/{id}/events``: chronological order with items missing a
  date sorting last, and a ``Link: rel="next"`` cursor walk that neither
  repeats nor skips a row.
* Withheld collections (``hidden_at``) read as 404 for everyone but an admin,
  and ``DELETE /admin/collections/{id}`` is what sets the stamp.
* ``GET /users/{username}/collections``: a reader sees the collections that
  hold something, the owner sees their empty ones too, and ``total`` agrees
  with the rows either way.
* The card mosaic: up to four tiles read off the items in chronological
  order, a graphic item skipped, an image preferred over a clip on an item
  carrying both, and ``media_type`` naming the element that can render each
  tile.
* A GDPR hard delete of the owner drops the collections and their
  memberships.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.collection import Collection, CollectionEvent
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.media import Media
from app.models.user import User
from app.schemas.collection import DESCRIPTION_MAX_LENGTH
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_user(db, *, prefix: str = "coll", is_admin: bool = False) -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        username=f"{prefix}{tag}",
        email=f"{prefix}-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def cleanup(db):
    """Drop every row a test created, children first.

    ``collections`` and ``collection_events`` both cascade, so deleting the
    users would be enough; the explicit sweep keeps a failing assertion from
    leaving rows behind under a user another test still needs.
    """
    user_ids: list[uuid.UUID] = []
    collection_ids: list[uuid.UUID] = []
    event_ids: list[uuid.UUID] = []

    yield user_ids, collection_ids, event_ids

    db.expire_all()
    if collection_ids:
        db.query(Collection).filter(Collection.id.in_(collection_ids)).delete(
            synchronize_session=False
        )
    if event_ids:
        db.query(Media).filter(Media.event_id.in_(event_ids)).delete(synchronize_session=False)
        db.query(Event).filter(Event.id.in_(event_ids)).delete(synchronize_session=False)
    if user_ids:
        db.query(Collection).filter(Collection.owner_id.in_(user_ids)).delete(
            synchronize_session=False
        )
        db.query(Event).filter(Event.owner_id.in_(user_ids)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def owner(db, cleanup):
    user_ids, _, _ = cleanup
    user = _make_user(db, prefix="owner")
    user_ids.append(user.id)
    return user


@pytest.fixture
def stranger(db, cleanup):
    user_ids, _, _ = cleanup
    user = _make_user(db, prefix="other")
    user_ids.append(user.id)
    return user


@pytest.fixture
def admin(db, cleanup):
    user_ids, _, _ = cleanup
    user = _make_user(db, prefix="admin", is_admin=True)
    user_ids.append(user.id)
    return user


def _make_event(
    db,
    cleanup,
    *,
    owner: User,
    status: str = STATUS_GEOLOCATED,
    event_date: date | None = None,
    event_time: time | None = None,
    is_graphic: bool = False,
    hidden: bool = False,
    deleted: bool = False,
    before_closed_status: str | None = None,
) -> Event:
    """One event owned by ``owner``, defaulting to a published geolocation.

    The per-state stamps match ``status`` because the table CHECKs
    (``ck_events_geolocated_stamp``, ``ck_events_closed_stamp``,
    ``ck_events_before_closed_status``) reject a row carrying a state without
    its stamp.
    """
    _, _, event_ids = cleanup
    now = datetime.now(UTC)
    event = Event(
        owner_id=owner.id,
        title=f"Event {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        event_date=event_date,
        event_time=event_time,
        status=status,
        is_graphic=is_graphic,
        geolocated_at=now if status == STATUS_GEOLOCATED else None,
        detected_at=now if status == STATUS_DETECTED else None,
        requested_at=now if status == STATUS_REQUESTED else None,
        closed_at=now if status == STATUS_CLOSED else None,
        before_closed_status=before_closed_status,
        hidden_at=now if hidden else None,
        deleted_at=now if deleted else None,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    event_ids.append(event.id)
    return event


def _make_collection(
    db,
    cleanup,
    *,
    owner: User,
    title: str = "Dossier",
    description: str = "What this shelf holds.",
) -> Collection:
    _, collection_ids, _ = cleanup
    collection = Collection(owner_id=owner.id, title=title, description=description)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    collection_ids.append(collection.id)
    return collection


def _reload_collection(db, collection_id: uuid.UUID) -> Collection | None:
    """Re-read one collection, or ``None`` when the row is gone.

    A query rather than ``Session.get``: the fixture session holds the
    instance the endpoint's own session deleted, and ``get`` would try to
    refresh it and raise ``ObjectDeletedError`` instead of answering "gone".
    """
    return db.query(Collection).filter(Collection.id == collection_id).first()


def _reload_event(db, event_id: uuid.UUID) -> Event | None:
    """Re-read one event, or ``None`` when the row is gone. See above."""
    return db.query(Event).filter(Event.id == event_id).first()


def _add(db, collection: Collection, event: Event) -> None:
    """Put an event on a collection directly, skipping the endpoint."""
    db.add(CollectionEvent(collection_id=collection.id, event_id=event.id))
    db.commit()


# ── POST / PATCH / DELETE /collections ────────────────────────────────────


def test_create_collection_returns_an_empty_shelf(db, cleanup, owner):
    _, collection_ids, _ = cleanup
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Zaporizhzhia plant",
            "description": "Strikes and their aftermath at the plant, 2025 to 2026.",
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    body = response.json()
    collection_ids.append(uuid.UUID(body["id"]))
    assert body["title"] == "Zaporizhzhia plant"
    assert body["description"] == "Strikes and their aftermath at the plant, 2025 to 2026."
    assert body["owner"]["username"] == owner.username
    assert body["event_count"] == 0
    assert body["first_date"] is None
    assert body["last_date"] is None
    assert body["cover"] == []


def test_create_collection_requires_auth():
    body = {"title": "Anon", "description": "Nobody's shelf."}
    assert client.post("/api/v1/collections", json=body).status_code == 401


def test_create_collection_rejects_an_empty_title(owner):
    response = client.post(
        "/api/v1/collections",
        json={"title": "", "description": "A described shelf with no name."},
        headers=login_as(client, owner),
    )
    assert response.status_code == 422


@pytest.mark.parametrize("description", ["", "   "])
def test_create_collection_rejects_a_blank_description(owner, description):
    """A description of nothing, spaces included, is a missing description."""
    response = client.post(
        "/api/v1/collections",
        json={"title": "Nameless shelf", "description": description},
        headers=login_as(client, owner),
    )
    assert response.status_code == 422


def test_create_collection_rejects_a_description_past_the_cap(owner):
    response = client.post(
        "/api/v1/collections",
        json={"title": "Long-winded", "description": "x" * (DESCRIPTION_MAX_LENGTH + 1)},
        headers=login_as(client, owner),
    )
    assert response.status_code == 422


def test_create_collection_strips_the_description(db, cleanup, owner):
    _, collection_ids, _ = cleanup
    response = client.post(
        "/api/v1/collections",
        json={"title": "Trimmed", "description": "  Strikes on the rail corridor.  "},
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    collection_ids.append(uuid.UUID(response.json()["id"]))
    assert response.json()["description"] == "Strikes on the rail corridor."


def test_update_collection_writes_both_fields_and_is_owner_only(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)

    mine = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={
            "title": "Operation reconstruction",
            "description": "Every strike of the operation, in the order they landed.",
        },
        headers=login_as(client, owner),
    )
    assert mine.status_code == 200
    assert mine.json()["title"] == "Operation reconstruction"
    assert mine.json()["description"] == "Every strike of the operation, in the order they landed."

    theirs = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={"title": "Hijacked", "description": "Somebody else's words."},
        headers=login_as(client, stranger),
    )
    assert theirs.status_code == 403

    db.expire_all()
    reloaded = _reload_collection(db, collection.id)
    assert reloaded.title == "Operation reconstruction"
    assert reloaded.description == "Every strike of the operation, in the order they landed."


def test_update_collection_rejects_a_blank_description(db, cleanup, owner):
    """Both fields ride every edit, so a description cannot be cleared."""
    collection = _make_collection(db, cleanup, owner=owner)

    response = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={"title": "Still named", "description": "  "},
        headers=login_as(client, owner),
    )
    assert response.status_code == 422

    db.expire_all()
    assert _reload_collection(db, collection.id).description == "What this shelf holds."


def test_delete_collection_leaves_its_events_alone(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, collection, event)
    # Read the ids before the row goes: the fixture session's copy of a deleted
    # instance cannot answer for its own columns any more.
    collection_id, event_id = collection.id, event.id

    response = client.delete(
        f"/api/v1/collections/{collection_id}", headers=login_as(client, owner)
    )
    assert response.status_code == 204

    db.expire_all()
    assert _reload_collection(db, collection_id) is None
    # The membership went with the collection; the event did not.
    assert (
        db.query(CollectionEvent).filter(CollectionEvent.collection_id == collection_id).count()
        == 0
    )
    assert _reload_event(db, event_id) is not None


def test_delete_collection_is_owner_only(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.delete(
        f"/api/v1/collections/{collection.id}", headers=login_as(client, stranger)
    )
    assert response.status_code == 403

    db.expire_all()
    assert _reload_collection(db, collection.id) is not None


# ── PUT / DELETE /collections/{id}/events/{event_id} ──────────────────────


def test_add_event_is_idempotent(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    headers = login_as(client, owner)
    path = f"/api/v1/collections/{collection.id}/events/{event.id}"

    assert client.put(path, headers=headers).status_code == 204
    assert client.put(path, headers=headers).status_code == 204

    db.expire_all()
    assert (
        db.query(CollectionEvent)
        .filter(
            CollectionEvent.collection_id == collection.id,
            CollectionEvent.event_id == event.id,
        )
        .count()
        == 1
    )


def test_remove_event_is_idempotent(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, collection, event)
    headers = login_as(client, owner)
    path = f"/api/v1/collections/{collection.id}/events/{event.id}"

    assert client.delete(path, headers=headers).status_code == 204
    assert client.delete(path, headers=headers).status_code == 204

    db.expire_all()
    assert db.query(CollectionEvent).filter(CollectionEvent.event_id == event.id).count() == 0
    assert _reload_event(db, event.id) is not None


def test_add_someone_elses_event_is_403(db, cleanup, owner, stranger):
    """The ownership invariant: a collection only ever holds its owner's work."""
    collection = _make_collection(db, cleanup, owner=owner)
    theirs = _make_event(db, cleanup, owner=stranger, event_date=date(2026, 5, 1))

    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{theirs.id}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 403

    db.expire_all()
    assert db.query(CollectionEvent).filter(CollectionEvent.event_id == theirs.id).count() == 0


def test_add_to_someone_elses_collection_is_403(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)
    mine = _make_event(db, cleanup, owner=stranger, event_date=date(2026, 5, 1))

    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{mine.id}",
        headers=login_as(client, stranger),
    )
    assert response.status_code == 403


def test_add_unknown_event_is_404(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{uuid.uuid4()}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "event_not_found"


@pytest.mark.parametrize(
    ("status_value", "before_closed_status", "hidden", "deleted"),
    [
        (STATUS_REQUESTED, None, False, False),
        (STATUS_CLOSED, STATUS_GEOLOCATED, False, False),
        (STATUS_GEOLOCATED, None, True, False),
        (STATUS_GEOLOCATED, None, False, True),
    ],
    ids=["requested", "retracted", "withheld", "soft-deleted"],
)
def test_add_ineligible_event_is_409(
    db, cleanup, owner, status_value, before_closed_status, hidden, deleted
):
    """A collection shows visible, worked rows: everything else is a 409.

    The caller owns the event and the collection, so the refusal is about the
    event's state, not about permission.
    """
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(
        db,
        cleanup,
        owner=owner,
        status=status_value,
        before_closed_status=before_closed_status,
        hidden=hidden,
        deleted=deleted,
        event_date=date(2026, 5, 1),
    )

    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{event.id}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "event_not_collectable"


def test_detections_are_collectable(db, cleanup, owner):
    """``detected`` is in the set: a collection curates work in progress too."""
    collection = _make_collection(db, cleanup, owner=owner)
    detection = _make_event(
        db, cleanup, owner=owner, status=STATUS_DETECTED, event_date=date(2026, 5, 1)
    )

    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{detection.id}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 204


def test_remove_works_on_an_event_that_became_ineligible(db, cleanup, owner):
    """An owner can always clear a membership, whatever the event did since."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, collection, event)

    event.status = STATUS_CLOSED
    event.closed_at = datetime.now(UTC)
    event.before_closed_status = STATUS_GEOLOCATED
    db.commit()

    response = client.delete(
        f"/api/v1/collections/{collection.id}/events/{event.id}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 204
    db.expire_all()
    assert db.query(CollectionEvent).filter(CollectionEvent.event_id == event.id).count() == 0


# ── GET /collections/{id} and its counts ──────────────────────────────────


def test_read_counts_and_date_range_only_showable_items(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1)))
    _add(db, collection, _make_event(db, cleanup, owner=owner, event_date=date(2026, 7, 9)))
    # Undated: counted, but outside the range the dates describe.
    _add(db, collection, _make_event(db, cleanup, owner=owner))
    # Withheld after it was added: out of the count and the range, with no
    # write to the membership table.
    _add(
        db,
        collection,
        _make_event(db, cleanup, owner=owner, event_date=date(2020, 1, 1), hidden=True),
    )

    body = client.get(f"/api/v1/collections/{collection.id}").json()
    # The header a reader lands on: what the collection says it holds, then
    # what it actually holds.
    assert body["description"] == "What this shelf holds."
    assert body["event_count"] == 3
    assert body["first_date"] == "2026-03-01"
    assert body["last_date"] == "2026-07-09"


def test_read_unknown_collection_is_404():
    response = client.get(f"/api/v1/collections/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "collection_not_found"


# ── GET /collections/{id}/events ──────────────────────────────────────────


def test_items_read_in_chronological_order_with_undated_last(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    undated = _make_event(db, cleanup, owner=owner)
    late = _make_event(db, cleanup, owner=owner, event_date=date(2026, 7, 9))
    early_evening = _make_event(
        db, cleanup, owner=owner, event_date=date(2026, 3, 1), event_time=time(19, 30)
    )
    early_morning = _make_event(
        db, cleanup, owner=owner, event_date=date(2026, 3, 1), event_time=time(6, 15)
    )
    early_no_hour = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1))
    for event in (undated, late, early_evening, early_morning, early_no_hour):
        _add(db, collection, event)

    rows = client.get(f"/api/v1/collections/{collection.id}/events").json()
    assert [row["id"] for row in rows] == [
        str(early_morning.id),
        str(early_evening.id),
        # Same day, no hour: after the timed ones.
        str(early_no_hour.id),
        str(late.id),
        # No date at all: last.
        str(undated.id),
    ]


def test_items_page_through_the_link_header(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    events = [
        _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, day)) for day in range(1, 6)
    ]
    # One undated row, so the walk crosses the stand-in boundary too.
    events.append(_make_event(db, cleanup, owner=owner))
    for event in events:
        _add(db, collection, event)

    seen: list[str] = []
    url = f"/api/v1/collections/{collection.id}/events?limit=2"
    pages = 0
    while url is not None:
        response = client.get(url)
        assert response.status_code == 200
        seen.extend(row["id"] for row in response.json())
        pages += 1
        link = response.headers.get("Link")
        url = link.split(";")[0].strip("<>") if link else None
        assert pages < 10, "cursor walk did not terminate"

    assert pages == 3
    assert seen == [str(event.id) for event in events]
    # No page repeated a row and none was skipped.
    assert len(set(seen)) == len(seen)


def test_items_reject_a_malformed_cursor(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.get(f"/api/v1/collections/{collection.id}/events?cursor=not-a-cursor")
    assert response.status_code == 422


# ── Withheld collections and the admin takedown ───────────────────────────


def test_admin_takedown_hides_a_collection_from_everyone_but_admins(
    db, cleanup, owner, stranger, admin
):
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1)))

    takedown = client.delete(
        f"/api/v1/admin/collections/{collection.id}", headers=login_as(client, admin)
    )
    assert takedown.status_code == 200
    assert takedown.json()["hidden_at"] is not None

    client.cookies.clear()
    assert client.get(f"/api/v1/collections/{collection.id}").status_code == 404
    assert (
        client.get(
            f"/api/v1/collections/{collection.id}", headers=login_as(client, stranger)
        ).status_code
        == 404
    )
    client.cookies.clear()
    # The owner is not exempt: a takedown freezes the shelf for them too.
    assert (
        client.get(
            f"/api/v1/collections/{collection.id}", headers=login_as(client, owner)
        ).status_code
        == 404
    )
    client.cookies.clear()
    assert (
        client.get(
            f"/api/v1/collections/{collection.id}", headers=login_as(client, admin)
        ).status_code
        == 200
    )


def test_admin_takedown_is_idempotent_and_keeps_the_first_stamp(db, cleanup, owner, admin):
    collection = _make_collection(db, cleanup, owner=owner)
    headers = login_as(client, admin)
    first = client.delete(f"/api/v1/admin/collections/{collection.id}", headers=headers).json()
    second = client.delete(f"/api/v1/admin/collections/{collection.id}", headers=headers).json()
    assert first["hidden_at"] == second["hidden_at"]


def test_admin_takedown_requires_admin(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.delete(
        f"/api/v1/admin/collections/{collection.id}", headers=login_as(client, owner)
    )
    assert response.status_code == 403


def test_withheld_collection_is_out_of_the_profile_list(db, cleanup, owner, admin):
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1)))
    client.delete(f"/api/v1/admin/collections/{collection.id}", headers=login_as(client, admin))
    client.cookies.clear()

    body = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert body["total"] == 0
    assert body["items"] == []


# ── GET /users/{username}/collections ─────────────────────────────────────


def test_empty_collections_are_the_owners_view_only(db, cleanup, owner, stranger):
    filled = _make_collection(db, cleanup, owner=owner, title="Filled")
    _add(db, filled, _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1)))
    _make_collection(db, cleanup, owner=owner, title="Empty")

    anonymous = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert anonymous["total"] == 1
    assert [item["title"] for item in anonymous["items"]] == ["Filled"]

    reader = client.get(
        f"/api/v1/users/{owner.username}/collections", headers=login_as(client, stranger)
    ).json()
    assert reader["total"] == 1
    client.cookies.clear()

    mine = client.get(
        f"/api/v1/users/{owner.username}/collections", headers=login_as(client, owner)
    ).json()
    assert mine["total"] == 2
    assert {item["title"] for item in mine["items"]} == {"Filled", "Empty"}


def test_a_collection_whose_items_all_left_reads_as_empty(db, cleanup, owner):
    """The count is computed, so a row going away empties the shelf on its own."""
    collection = _make_collection(db, cleanup, owner=owner, title="Drained")
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, collection, event)

    event.deleted_at = datetime.now(UTC)
    db.commit()

    anonymous = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert anonymous["total"] == 0
    assert client.get(f"/api/v1/collections/{collection.id}").json()["event_count"] == 0


def test_profile_collections_404_on_unknown_user():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}/collections")
    assert response.status_code == 404


# ── GET /events/{id}/collections ──────────────────────────────────────────


def test_event_collections_report_membership_to_the_owner(db, cleanup, owner):
    holding = _make_collection(db, cleanup, owner=owner, title="Holding")
    _make_collection(db, cleanup, owner=owner, title="Other")
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, holding, event)

    body = client.get(
        f"/api/v1/events/{event.id}/collections", headers=login_as(client, owner)
    ).json()
    by_title = {item["title"]: item["in_collection"] for item in body["items"]}
    assert by_title == {"Holding": True, "Other": False}


def test_event_collections_count_each_collection_on_the_showable_predicate(db, cleanup, owner):
    """The count under a title is the one that collection's own page prints: the
    same predicate, so a withheld item is out of both."""
    collection = _make_collection(db, cleanup, owner=owner, title="Holding")
    empty = _make_collection(db, cleanup, owner=owner, title="Other")
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, collection, event)
    _add(db, collection, _make_event(db, cleanup, owner=owner, event_date=date(2026, 6, 1)))
    _add(
        db,
        collection,
        _make_event(db, cleanup, owner=owner, event_date=date(2020, 1, 1), hidden=True),
    )

    body = client.get(
        f"/api/v1/events/{event.id}/collections", headers=login_as(client, owner)
    ).json()
    assert {item["title"]: item["event_count"] for item in body["items"]} == {
        "Holding": 2,
        "Other": 0,
    }
    assert client.get(f"/api/v1/collections/{collection.id}").json()["event_count"] == 2
    assert client.get(f"/api/v1/collections/{empty.id}").json()["event_count"] == 0


def test_event_collections_are_owner_only(db, cleanup, owner, stranger):
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    assert client.get(f"/api/v1/events/{event.id}/collections").status_code == 401
    assert (
        client.get(
            f"/api/v1/events/{event.id}/collections", headers=login_as(client, stranger)
        ).status_code
        == 403
    )


# ── The card mosaic ───────────────────────────────────────────────────────


def _add_media(db, event: Event, name: str, media_type: str = "image", role: str = "source"):
    """Give one event a media row the card rule may pick."""
    db.add(
        Media(
            event_id=event.id,
            role=role,
            storage_url=f"https://media.example.com/{name}",
            media_type=media_type,
        )
    )


def _tile_urls(collection: Collection) -> list[str]:
    body = client.get(f"/api/v1/collections/{collection.id}").json()
    return [tile["url"] for tile in body["cover"]]


def test_mosaic_is_empty_without_media(db, cleanup, owner):
    """An item carrying nothing a card may show contributes no tile, so a
    collection of such items wears the placeholder rather than a broken box."""
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1)))
    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == []


def test_mosaic_of_one_item_is_one_tile(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1))
    _add_media(db, event, "only.jpg")
    _add(db, collection, event)
    db.commit()

    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == [
        {"url": "https://media.example.com/only.jpg", "media_type": "image"}
    ]


def test_mosaic_takes_the_first_four_items_in_chronological_order(db, cleanup, owner):
    """Six items, four tiles: the walk is the order the collection's own page
    lists its items in, and it stops at four rather than at the newest."""
    collection = _make_collection(db, cleanup, owner=owner)
    for day in range(1, 7):
        event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, day))
        _add_media(db, event, f"day{day}.jpg")
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == [
        f"https://media.example.com/day{day}.jpg" for day in (1, 2, 3, 4)
    ]


def test_mosaic_skips_a_graphic_item_and_keeps_walking(db, cleanup, owner):
    """A flagged item is stepped over rather than ending the walk, so no reader
    meets death or injury on a card they did not open and the mosaic still
    fills from the items that follow."""
    collection = _make_collection(db, cleanup, owner=owner)
    graphic = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1), is_graphic=True)
    _add_media(db, graphic, "graphic.jpg")
    _add(db, collection, graphic)
    for day in (2, 3):
        event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, day))
        _add_media(db, event, f"day{day}.jpg")
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == [
        "https://media.example.com/day2.jpg",
        "https://media.example.com/day3.jpg",
    ]


def test_a_tile_prefers_an_image_over_a_clip_on_the_same_item(db, cleanup, owner):
    """A tile is a quarter of a card and never plays, so an item holding a
    source clip beside a proof image offers the picture. An item with only a
    clip still tiles as one, with the kind that says so."""
    collection = _make_collection(db, cleanup, owner=owner)
    both = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1))
    _add_media(db, both, "footage.mp4", media_type="video")
    _add_media(db, both, "proof.jpg", role="proof")
    clip_only = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 2))
    _add_media(db, clip_only, "clip.mp4", media_type="video")
    for event in (both, clip_only):
        _add(db, collection, event)
    db.commit()

    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == [
        {"url": "https://media.example.com/proof.jpg", "media_type": "image"},
        {"url": "https://media.example.com/clip.mp4", "media_type": "video"},
    ]


def test_mosaic_drops_a_withheld_or_closed_item(db, cleanup, owner):
    """The tiles read the one predicate every other collection reading reads,
    so a row that is taken down or closed leaves the card with no write to the
    membership table."""
    collection = _make_collection(db, cleanup, owner=owner)
    hidden = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 1), hidden=True)
    _add_media(db, hidden, "hidden.jpg")
    closed = _make_event(
        db,
        cleanup,
        owner=owner,
        status=STATUS_CLOSED,
        event_date=date(2026, 3, 2),
        before_closed_status=STATUS_REQUESTED,
    )
    _add_media(db, closed, "closed.jpg")
    shown = _make_event(db, cleanup, owner=owner, event_date=date(2026, 3, 3))
    _add_media(db, shown, "shown.jpg")
    for event in (hidden, closed, shown):
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == ["https://media.example.com/shown.jpg"]


# ── GDPR hard delete ──────────────────────────────────────────────────────


def test_hard_deleting_the_owner_drops_the_collections_and_their_memberships(
    db, cleanup, owner, admin
):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, event_date=date(2026, 5, 1))
    _add(db, collection, event)
    client.cookies.clear()
    # Read the ids before the erasure: the fixture session's copies of the
    # deleted rows cannot answer for their own columns afterwards.
    collection_id, owner_id = collection.id, owner.id

    response = client.delete(
        f"/api/v1/admin/users/{owner_id}?hard=true", headers=login_as(client, admin)
    )
    assert response.status_code == 200

    db.expire_all()
    assert _reload_collection(db, collection_id) is None
    assert (
        db.query(CollectionEvent).filter(CollectionEvent.collection_id == collection_id).count()
        == 0
    )
