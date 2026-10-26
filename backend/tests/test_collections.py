"""Collections endpoints: owner CRUD with title and HTML description (blank and 500-char
refusals measured on the plain-text projection), ``event_ids`` on create (all-or-nothing),
idempotent membership verbs, chronological paging, admin withholding and takedown, reports,
user and event collection lists, the card mosaic, the derived tag union, and GDPR hard delete."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.main import app
from app.models.audit_log import AuditLog
from app.models.collection import Collection, CollectionEvent
from app.models.content_report import ContentReport
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.media import Media
from app.models.source import Source, SourceLink
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.schemas.collection import DESCRIPTION_MAX_LENGTH, MAX_CREATE_EVENTS
from app.services import collections as collections_service
from app.services import collections_bulk
from app.services.auth import hash_password
from app.services.sanitize import html_from_text
from tests._fixtures import collection_description, fake_sha256
from tests.conftest import login_as

client = TestClient(app)


def _description(text: str) -> str:
    """A description write body: the HTML for ``text``, one paragraph per line (``sanitize.html_from_text``)."""
    return html_from_text(text)


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
    """Drop every row a test created, children first, so a failing assertion leaves no rows behind."""
    user_ids: list[uuid.UUID] = []
    collection_ids: list[uuid.UUID] = []
    event_ids: list[uuid.UUID] = []

    yield user_ids, collection_ids, event_ids

    db.expire_all()
    if collection_ids:
        # Reports first: ``content_reports.collection_id`` is SET NULL, so a leftover report would orphan in the next test's admin queue.
        db.query(ContentReport).filter(ContentReport.collection_id.in_(collection_ids)).delete(
            synchronize_session=False
        )
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
    occurred_date: date | None = None,
    occurred_time: time | None = None,
    is_graphic: bool = False,
    hidden: bool = False,
    deleted: bool = False,
    before_closed_status: str | None = None,
) -> Event:
    """One event owned by ``owner``, a published geolocation by default.

    The per-state stamps match ``status`` because the table CHECKs reject a state without its stamp."""
    _, _, event_ids = cleanup
    now = datetime.now(UTC)
    event = Event(
        owner_id=owner.id,
        title=f"Event {uuid.uuid4().hex[:8]}",
        coords=from_shape(Point(34.5, 48.5), srid=4326),
        sources=[
            Source(
                level="direct",
                kind="unknown",
                is_graphic=is_graphic,
                links=[SourceLink(url="https://example.com/source")],
            )
        ],
        occurred_date=occurred_date,
        occurred_time=occurred_time,
        status=status,
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
    collection = Collection(owner_id=owner.id, title=title, **collection_description(description))
    db.add(collection)
    db.commit()
    db.refresh(collection)
    collection_ids.append(collection.id)
    return collection


def _reload_collection(db, collection_id: uuid.UUID) -> Collection | None:
    """Re-read one collection, or ``None`` when gone.

    A query, not ``Session.get``: ``get`` would refresh the instance the endpoint deleted and raise ``ObjectDeletedError``."""
    return db.query(Collection).filter(Collection.id == collection_id).first()


def _reload_event(db, event_id: uuid.UUID) -> Event | None:
    """Re-read one event, or ``None`` when gone."""
    return db.query(Event).filter(Event.id == event_id).first()


def _add(db, collection: Collection, event: Event) -> None:
    """Put an event on a collection directly, skipping the endpoint."""
    db.add(CollectionEvent(collection_id=collection.id, event_id=event.id))
    db.commit()


def test_create_collection_returns_an_empty_shelf(db, cleanup, owner):
    _, collection_ids, _ = cleanup
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Zaporizhzhia plant",
            "description": _description("Strikes and their aftermath at the plant, 2025 to 2026."),
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    body = response.json()
    collection_ids.append(uuid.UUID(body["id"]))
    assert body["title"] == "Zaporizhzhia plant"
    assert body["description_text"] == "Strikes and their aftermath at the plant, 2025 to 2026."
    assert body["owner"]["username"] == owner.username
    assert body["event_count"] == 0
    assert body["first_date"] is None
    assert body["last_date"] is None
    assert body["cover"] == []


def test_create_collection_requires_auth():
    body = {"title": "Anon", "description": _description("Nobody's shelf.")}
    assert client.post("/api/v1/collections", json=body).status_code == 401


@pytest.mark.parametrize("title", ["", "   "])
def test_create_collection_rejects_a_blank_title(owner, title):
    """A title of nothing, spaces included, is a missing title."""
    response = client.post(
        "/api/v1/collections",
        json={"title": title, "description": _description("A described shelf with no name.")},
        headers=login_as(client, owner),
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "description",
    [
        "",
        "<p></p>",
        "<p>   </p><p>&nbsp;</p>",
        # A body whose only element carries no text: empty projection, so a missing description.
        "<hr>",
        # Text the sanitiser drops with its tag.
        "<script>alert(1)</script>",
    ],
)
def test_create_collection_rejects_a_blank_description(owner, description):
    """A description whose text reads empty, spaces included, is missing."""
    response = client.post(
        "/api/v1/collections",
        json={"title": "Nameless shelf", "description": description},
        headers=login_as(client, owner),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_description"


def test_create_collection_rejects_a_description_past_the_cap(owner):
    """The cap is measured on the projection, so this is one character over."""
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Long-winded",
            "description": _description("x" * (DESCRIPTION_MAX_LENGTH + 1)),
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_description"
    assert str(DESCRIPTION_MAX_LENGTH) in detail["message"]


def test_create_collection_rejects_a_body_over_a_sanitiser_cap(owner):
    """A body past the sanitiser's tag-count cap is refused by the service, which becomes the typed 400."""
    response = client.post(
        "/api/v1/collections",
        json={"title": "Deep", "description": "<br>" * 10_001},
        headers=login_as(client, owner),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_description"


def test_create_collection_strips_the_description(db, cleanup, owner):
    """The projection carries no padding, whatever whitespace the runs hold."""
    _, collection_ids, _ = cleanup
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Trimmed",
            "description": _description("  Strikes on the rail corridor.  "),
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    collection_ids.append(uuid.UUID(response.json()["id"]))
    assert response.json()["description_text"] == "Strikes on the rail corridor."


def test_create_collection_keeps_bold_italic_and_a_bullet_list(db, cleanup, owner):
    """A description follows the proof allowlist: marks and lists survive the write."""
    _, collection_ids, _ = cleanup
    description = (
        "<p><em>Strikes on </em><strong>Kupiansk</strong></p>"
        "<ul><li><p>Rail corridor</p></li><li><p>Depot</p></li></ul>"
    )
    response = client.post(
        "/api/v1/collections",
        json={"title": "Formatted", "description": description},
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    body = response.json()
    collection_ids.append(uuid.UUID(body["id"]))
    assert body["description"] == description
    assert body["description_text"] == "Strikes on Kupiansk\nRail corridor\nDepot"


def test_create_collection_drops_an_image_from_the_description(db, cleanup, owner):
    """Images are not allowed in a description (no upload path): the image is dropped, the rest stands."""
    _, collection_ids, _ = cleanup
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "No pictures",
            "description": '<img src="/media/proof.jpg"><p>Words only.</p>',
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    body = response.json()
    collection_ids.append(uuid.UUID(body["id"]))
    assert body["description"] == "<p>Words only.</p>"
    assert body["description_text"] == "Words only."


def _collections_of(db, owner: User) -> int:
    """How many collections this analyst holds, read fresh."""
    db.expire_all()
    return db.query(Collection).filter(Collection.owner_id == owner.id).count()


def test_create_collection_opens_it_on_the_picked_events(db, cleanup, owner):
    """The create page's picker sends ids, and the collection opens holding them."""
    _, collection_ids, _ = cleanup
    first = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    second = _make_event(
        db, cleanup, owner=owner, status=STATUS_DETECTED, occurred_date=date(2026, 5, 4)
    )

    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Kupiansk rail corridor",
            "description": _description("Three days of strikes on the corridor."),
            "event_ids": [str(first.id), str(second.id)],
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    body = response.json()
    collection_ids.append(uuid.UUID(body["id"]))
    # The read is computed over the memberships the same transaction wrote.
    assert body["event_count"] == 2
    assert body["first_date"] == "2026-05-01"
    assert body["last_date"] == "2026-05-04"

    db.expire_all()
    held = {
        row.event_id
        for row in db.query(CollectionEvent).filter(
            CollectionEvent.collection_id == uuid.UUID(body["id"])
        )
    }
    assert held == {first.id, second.id}


def test_create_collection_refuses_a_foreign_event_and_lands_nothing(db, cleanup, owner, stranger):
    """A foreign id is the membership route's 403, and it takes the create with it."""
    theirs = _make_event(db, cleanup, owner=stranger, occurred_date=date(2026, 5, 1))

    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Somebody else's work",
            "description": _description("A shelf built out of another analyst's rows."),
            "event_ids": [str(theirs.id)],
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 403
    assert _collections_of(db, owner) == 0


def test_create_collection_refuses_an_ineligible_event_and_lands_nothing(db, cleanup, owner):
    """A request is an ask rather than an answer: 409, and no half-filled shelf."""
    asked = _make_event(db, cleanup, owner=owner, status=STATUS_REQUESTED)
    good = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))

    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Mixed pick",
            "description": _description("One row that stands and one that is only an ask."),
            "event_ids": [str(good.id), str(asked.id)],
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "event_not_collectable"
    # The eligible id in the same body is not shelved either: the create is all-or-nothing.
    assert _collections_of(db, owner) == 0
    db.expire_all()
    assert db.query(CollectionEvent).filter(CollectionEvent.event_id == good.id).count() == 0


def test_create_collection_refuses_an_unknown_event(db, owner):
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Phantom",
            "description": _description("A shelf pointing at an id no event carries."),
            "event_ids": [str(uuid.uuid4())],
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "event_not_found"
    assert _collections_of(db, owner) == 0


def test_create_collection_caps_the_event_ids(db, owner):
    """Past the cap the body is refused outright, before any row is read."""
    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Runaway",
            "description": _description("More ids than one create may carry."),
            "event_ids": [str(uuid.uuid4()) for _ in range(MAX_CREATE_EVENTS + 1)],
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 422
    assert _collections_of(db, owner) == 0


def test_create_collection_collapses_duplicate_event_ids(db, cleanup, owner):
    """Ticking one row is one membership, however many times the id arrives."""
    _, collection_ids, _ = cleanup
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))

    response = client.post(
        "/api/v1/collections",
        json={
            "title": "Doubled",
            "description": _description("The same row, sent twice."),
            "event_ids": [str(event.id), str(event.id)],
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201
    body = response.json()
    collection_ids.append(uuid.UUID(body["id"]))
    assert body["event_count"] == 1

    db.expire_all()
    assert (
        db.query(CollectionEvent)
        .filter(CollectionEvent.collection_id == uuid.UUID(body["id"]))
        .count()
        == 1
    )


def test_update_collection_writes_both_fields_and_is_owner_only(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)

    mine = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={
            "title": "Operation reconstruction",
            "description": _description("Every strike of the operation, in the order they landed."),
        },
        headers=login_as(client, owner),
    )
    assert mine.status_code == 200
    assert mine.json()["title"] == "Operation reconstruction"
    assert mine.json()["description_text"] == (
        "Every strike of the operation, in the order they landed."
    )

    theirs = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={"title": "Hijacked", "description": _description("Somebody else's words.")},
        headers=login_as(client, stranger),
    )
    assert theirs.status_code == 403

    db.expire_all()
    reloaded = _reload_collection(db, collection.id)
    assert reloaded.title == "Operation reconstruction"
    assert reloaded.description_text == ("Every strike of the operation, in the order they landed.")


def test_update_collection_rejects_a_blank_description(db, cleanup, owner):
    """Both fields ride every edit, so a description cannot be cleared."""
    collection = _make_collection(db, cleanup, owner=owner)

    response = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={"title": "Still named", "description": _description("  ")},
        headers=login_as(client, owner),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_description"

    db.expire_all()
    assert _reload_collection(db, collection.id).description_text == "What this shelf holds."


def test_update_collection_rejects_a_blank_title(db, cleanup, owner):
    """The title takes the same refusal as the description it rides with."""
    collection = _make_collection(db, cleanup, owner=owner)
    before = _reload_collection(db, collection.id).title

    response = client.patch(
        f"/api/v1/collections/{collection.id}",
        json={"title": "   ", "description": _description("Still described.")},
        headers=login_as(client, owner),
    )
    assert response.status_code == 422

    db.expire_all()
    assert _reload_collection(db, collection.id).title == before


def test_delete_collection_leaves_its_events_alone(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, collection, event)
    # Read the ids before the row goes (the session's copy of a deleted instance cannot answer).
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


def test_add_event_is_idempotent(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
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


def test_add_event_surfaces_a_violation_that_is_not_the_duplicate(db, cleanup, owner):
    """Only the duplicate answers idempotently; a vanished parent row raises.

    The savepoint swallows SQLSTATE 23505 alone. With the collection deleted under the request the INSERT fails the FK (23503) and must surface."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    # Load what the verb reads off the collection before the row goes, so the refusal comes from the INSERT.
    db.refresh(collection)

    other = SessionLocal()
    try:
        other.query(Collection).filter(Collection.id == collection.id).delete(
            synchronize_session=False
        )
        other.commit()
    finally:
        other.close()

    with pytest.raises(IntegrityError):
        collections_service.add_event(db, collection=collection, event_id=event.id, user=owner)
    db.rollback()


def test_remove_event_is_idempotent(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
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
    theirs = _make_event(db, cleanup, owner=stranger, occurred_date=date(2026, 5, 1))

    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{theirs.id}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 403

    db.expire_all()
    assert db.query(CollectionEvent).filter(CollectionEvent.event_id == theirs.id).count() == 0


def test_add_to_someone_elses_collection_is_403(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)
    mine = _make_event(db, cleanup, owner=stranger, occurred_date=date(2026, 5, 1))

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
    """A collection shows visible, worked rows: everything else is a 409 (event state, not permission)."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(
        db,
        cleanup,
        owner=owner,
        status=status_value,
        before_closed_status=before_closed_status,
        hidden=hidden,
        deleted=deleted,
        occurred_date=date(2026, 5, 1),
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
        db, cleanup, owner=owner, status=STATUS_DETECTED, occurred_date=date(2026, 5, 1)
    )

    response = client.put(
        f"/api/v1/collections/{collection.id}/events/{detection.id}",
        headers=login_as(client, owner),
    )
    assert response.status_code == 204


def test_remove_works_on_an_event_that_became_ineligible(db, cleanup, owner):
    """An owner can always clear a membership, whatever the event did since."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
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


def test_read_counts_and_date_range_only_showable_items(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1)))
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 7, 9)))
    # Undated: counted, but outside the range the dates describe.
    _add(db, collection, _make_event(db, cleanup, owner=owner))
    # Withheld after it was added: out of the count and range, with no write to the membership table.
    _add(
        db,
        collection,
        _make_event(db, cleanup, owner=owner, occurred_date=date(2020, 1, 1), hidden=True),
    )

    body = client.get(f"/api/v1/collections/{collection.id}").json()
    # The header: what the collection says it holds, then what it holds.
    assert body["description_text"] == "What this shelf holds."
    assert body["event_count"] == 3
    assert body["first_date"] == "2026-03-01"
    assert body["last_date"] == "2026-07-09"


def test_read_unknown_collection_is_404():
    response = client.get(f"/api/v1/collections/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "collection_not_found"


def test_items_read_in_chronological_order_with_undated_last(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    undated = _make_event(db, cleanup, owner=owner)
    late = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 7, 9))
    early_evening = _make_event(
        db, cleanup, owner=owner, occurred_date=date(2026, 3, 1), occurred_time=time(19, 30)
    )
    early_morning = _make_event(
        db, cleanup, owner=owner, occurred_date=date(2026, 3, 1), occurred_time=time(6, 15)
    )
    early_no_hour = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
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
        _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, day))
        for day in range(1, 6)
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


def test_admin_takedown_hides_a_collection_from_everyone_but_admins(
    db, cleanup, owner, stranger, admin
):
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1)))

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


def _moderate(collection_id, *, hidden: bool, as_user):
    return client.patch(
        f"/api/v1/admin/collections/{collection_id}/moderation",
        json={"hidden": hidden},
        headers=login_as(client, as_user),
    )


def test_admin_moderation_hides_then_restores_a_collection(db, cleanup, owner, admin):
    """The takedown is reversible: what the PATCH withholds, the PATCH puts back."""
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1)))

    hidden = _moderate(collection.id, hidden=True, as_user=admin)
    assert hidden.status_code == 200
    assert hidden.json()["hidden_at"] is not None
    client.cookies.clear()
    assert client.get(f"/api/v1/collections/{collection.id}").status_code == 404

    restored = _moderate(collection.id, hidden=False, as_user=admin)
    assert restored.status_code == 200
    assert restored.json()["hidden_at"] is None
    assert restored.json()["collection_id"] == str(collection.id)
    client.cookies.clear()
    assert client.get(f"/api/v1/collections/{collection.id}").status_code == 200
    # The owner's profile shelf carries it again.
    body = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert [item["id"] for item in body["items"]] == [str(collection.id)]


def test_admin_moderation_takedown_alias_is_undone_by_the_patch(db, cleanup, owner, admin):
    """``DELETE`` sets the stamp the ``PATCH`` clears: one axis, two doors."""
    collection = _make_collection(db, cleanup, owner=owner)
    client.delete(f"/api/v1/admin/collections/{collection.id}", headers=login_as(client, admin))
    client.cookies.clear()

    assert _moderate(collection.id, hidden=False, as_user=admin).json()["hidden_at"] is None
    client.cookies.clear()
    assert client.get(f"/api/v1/collections/{collection.id}").status_code == 200


def test_admin_moderation_is_idempotent_both_ways(db, cleanup, owner, admin):
    collection = _make_collection(db, cleanup, owner=owner)

    first = _moderate(collection.id, hidden=True, as_user=admin).json()
    client.cookies.clear()
    second = _moderate(collection.id, hidden=True, as_user=admin).json()
    # An already withheld collection keeps its original stamp.
    assert first["hidden_at"] == second["hidden_at"]

    client.cookies.clear()
    assert _moderate(collection.id, hidden=False, as_user=admin).json()["hidden_at"] is None
    client.cookies.clear()
    third = _moderate(collection.id, hidden=False, as_user=admin)
    assert third.status_code == 200
    assert third.json()["hidden_at"] is None


def test_admin_moderation_requires_admin(db, cleanup, owner):
    """Not even the owner may restore their own shelf."""
    collection = _make_collection(db, cleanup, owner=owner)
    assert _moderate(collection.id, hidden=False, as_user=owner).status_code == 403


def test_admin_moderation_404s_on_an_unknown_collection(db, cleanup, admin):
    response = _moderate(uuid.uuid4(), hidden=False, as_user=admin)
    assert response.status_code == 404


def test_withheld_collection_is_out_of_the_profile_list(db, cleanup, owner, admin):
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1)))
    client.delete(f"/api/v1/admin/collections/{collection.id}", headers=login_as(client, admin))
    client.cookies.clear()

    body = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert body["total"] == 0
    assert body["items"] == []


def test_anonymous_report_of_a_collection_is_accepted(db, cleanup, owner):
    """No account needed, as for reporting an event."""
    collection = _make_collection(db, cleanup, owner=owner)
    client.cookies.clear()

    response = client.post(
        f"/api/v1/collections/{collection.id}/report",
        json={"reason": "privacy", "details": "This shelf names a private address."},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["collection"]["id"] == str(collection.id)
    assert body["collection"]["title"] == collection.title
    assert body["collection"]["owner"]["username"] == owner.username
    # One target per row, and no verdict yet.
    assert body["event_id"] is None
    assert body["reporter_id"] is None
    assert body["resolved_at"] is None

    db.expire_all()
    stored = db.query(ContentReport).filter(ContentReport.id == body["id"]).one()
    assert stored.collection_id == collection.id
    assert stored.event_id is None
    assert stored.details == "This shelf names a private address."


def test_authenticated_report_of_a_collection_records_the_reporter(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.post(
        f"/api/v1/collections/{collection.id}/report",
        json={"reason": "copyright"},
        headers=login_as(client, stranger),
    )
    assert response.status_code == 201, response.text
    assert response.json()["reporter_id"] == str(stranger.id)
    assert response.json()["details"] is None


def test_report_a_withheld_collection_is_404(db, cleanup, owner, admin):
    """A withheld collection cannot be reported: the same 404 as an unknown id."""
    collection = _make_collection(db, cleanup, owner=owner)
    client.delete(f"/api/v1/admin/collections/{collection.id}", headers=login_as(client, admin))
    client.cookies.clear()

    response = client.post(f"/api/v1/collections/{collection.id}/report", json={"reason": "other"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "collection_not_found"


def test_report_an_unknown_collection_is_404():
    response = client.post(f"/api/v1/collections/{uuid.uuid4()}/report", json={"reason": "other"})
    assert response.status_code == 404


def test_report_a_collection_rejects_an_unknown_reason(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.post(
        f"/api/v1/collections/{collection.id}/report",
        json={"reason": "i-just-dont-like-it"},
    )
    assert response.status_code == 422


def test_report_a_collection_rejects_over_long_details(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    response = client.post(
        f"/api/v1/collections/{collection.id}/report",
        json={"reason": "other", "details": "x" * 2001},
    )
    assert response.status_code == 422


@pytest.fixture
def report_ids(db):
    """Reports a test files, dropped by id: an erased collection leaves its reports with no
    ``collection_id`` for ``cleanup`` to find."""
    ids: list[uuid.UUID] = []
    yield ids
    db.expire_all()
    if ids:
        db.query(ContentReport).filter(ContentReport.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def _report(collection: Collection, report_ids: list[uuid.UUID]) -> str:
    client.cookies.clear()
    response = client.post(f"/api/v1/collections/{collection.id}/report", json={"reason": "other"})
    assert response.status_code == 201, response.text
    report_ids.append(uuid.UUID(response.json()["id"]))
    return response.json()["id"]


def _owner_deletes(collection: Collection, owner: User) -> None:
    client.cookies.clear()
    response = client.delete(
        f"/api/v1/collections/{collection.id}", headers=login_as(client, owner)
    )
    assert response.status_code == 204
    client.cookies.clear()


def _resolve(report_id: str, resolution: str, admin: User):
    client.cookies.clear()
    response = client.post(
        f"/api/v1/admin/reports/{report_id}/resolve",
        json={"resolution": resolution},
        headers=login_as(client, admin),
    )
    client.cookies.clear()
    return response


def _queue_row(report_id: str, admin: User) -> dict:
    client.cookies.clear()
    rows = client.get(
        "/api/v1/admin/reports?page=1&per_page=100", headers=login_as(client, admin)
    ).json()["items"]
    client.cookies.clear()
    return next(row for row in rows if row["id"] == report_id)


def test_owner_delete_under_an_open_report_withholds_the_collection(
    db, cleanup, owner, stranger, admin, report_ids
):
    """The owner's delete succeeds, and the collection leaves every read but an admin's."""
    collection = _make_collection(db, cleanup, owner=owner, title="Reported shelf")
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, collection, event)
    _report(collection, report_ids)

    _owner_deletes(collection, owner)

    db.expire_all()
    stored = _reload_collection(db, collection.id)
    assert stored is not None and stored.deleted_at is not None
    assert stored.hidden_at is None

    path = f"/api/v1/collections/{collection.id}"
    assert client.get(path).status_code == 404
    assert client.get(f"{path}/events").status_code == 404
    assert client.post(f"{path}/report", json={"reason": "other"}).status_code == 404
    assert client.get(path, headers=login_as(client, stranger)).status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/v1/users/{owner.username}/collections").json()["total"] == 0
    assert (
        client.get(f"/api/v1/search?type=collection&author={owner.username}").json()["collections"]
        == []
    )

    # The owner sees it as deleted too, and can no longer write to it.
    headers = login_as(client, owner)
    assert client.get(path).status_code == 404
    assert client.get(f"/api/v1/users/{owner.username}/collections").json()["total"] == 0
    assert client.get(f"/api/v1/events/{event.id}/collections").json()["items"] == []
    patch = {"title": "Renamed", "description": _description("Still here.")}
    assert client.patch(path, json=patch, headers=headers).status_code == 404
    assert client.delete(path, headers=headers).status_code == 404
    assert client.put(f"{path}/events/{event.id}", headers=headers).status_code == 404
    client.cookies.clear()

    # A moderator still reads it in full.
    login_as(client, admin)
    assert client.get(path).json()["event_count"] == 1
    assert [row["id"] for row in client.get(f"{path}/events").json()] == [str(event.id)]
    client.cookies.clear()


def test_the_queue_names_an_owner_deleted_collection(db, cleanup, owner, admin, report_ids):
    collection = _make_collection(db, cleanup, owner=owner)
    live_report = _report(collection, report_ids)
    assert _queue_row(live_report, admin)["collection"]["deleted_at"] is None

    _owner_deletes(collection, owner)

    reported = _queue_row(live_report, admin)["collection"]
    assert reported["id"] == str(collection.id)
    assert reported["title"] == collection.title
    assert reported["owner"]["username"] == owner.username
    assert reported["deleted_at"] is not None


@pytest.mark.parametrize("resolution", ["dismissed", "hidden"])
def test_resolving_the_report_erases_the_owner_deleted_collection(
    db, cleanup, owner, admin, report_ids, resolution
):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, collection, event)
    report_id = _report(collection, report_ids)
    _owner_deletes(collection, owner)
    collection_id, title = collection.id, collection.title

    response = _resolve(report_id, resolution, admin)
    assert response.status_code == 200, response.text
    assert response.json()["resolution"] == resolution
    assert response.json()["collection"] is None

    db.expire_all()
    assert _reload_collection(db, collection_id) is None
    assert (
        db.query(CollectionEvent).filter(CollectionEvent.collection_id == collection_id).count()
        == 0
    )
    assert _reload_event(db, event.id) is not None
    # The report stays, as the record of what was decided.
    report = db.query(ContentReport).filter(ContentReport.id == report_id).one()
    assert report.resolution == resolution
    assert report.collection_id is None
    erased = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == admin.id, AuditLog.action == "collection_erased")
        .one()
    )
    assert erased.target == {"collection_id": str(collection_id), "title": title}


def test_owner_delete_without_an_open_report_erases_at_once(db, cleanup, owner, admin, report_ids):
    """A resolved report does not hold the collection back."""
    collection = _make_collection(db, cleanup, owner=owner)
    report_id = _report(collection, report_ids)
    assert _resolve(report_id, "dismissed", admin).status_code == 200
    collection_id = collection.id

    _owner_deletes(collection, owner)

    db.expire_all()
    assert _reload_collection(db, collection_id) is None


def test_an_owner_deleted_collection_waits_for_its_last_open_report(
    db, cleanup, owner, admin, report_ids
):
    collection = _make_collection(db, cleanup, owner=owner)
    first = _report(collection, report_ids)
    second = _report(collection, report_ids)
    _owner_deletes(collection, owner)
    collection_id = collection.id

    assert _resolve(first, "hidden", admin).status_code == 200
    db.expire_all()
    kept = _reload_collection(db, collection_id)
    assert kept is not None and kept.deleted_at is not None and kept.hidden_at is not None
    assert _queue_row(second, admin)["collection"]["id"] == str(collection_id)

    assert _resolve(second, "dismissed", admin).status_code == 200
    db.expire_all()
    assert _reload_collection(db, collection_id) is None


def test_a_live_collection_survives_its_reports_being_resolved(
    db, cleanup, owner, admin, report_ids
):
    collection = _make_collection(db, cleanup, owner=owner)
    report_id = _report(collection, report_ids)

    assert _resolve(report_id, "dismissed", admin).status_code == 200

    db.expire_all()
    assert _reload_collection(db, collection.id) is not None


def test_erasing_the_owner_erases_a_collection_under_an_open_report(
    db, cleanup, owner, admin, report_ids
):
    """Account erasure takes the collection whatever its reports; each report stays, orphaned,
    and takes only ``dismissed``."""
    collection = _make_collection(db, cleanup, owner=owner)
    report_id = _report(collection, report_ids)
    _owner_deletes(collection, owner)
    collection_id = collection.id

    client.cookies.clear()
    response = client.delete(
        f"/api/v1/admin/users/{owner.id}?hard=true", headers=login_as(client, admin)
    )
    assert response.status_code == 200
    client.cookies.clear()

    db.expire_all()
    assert _reload_collection(db, collection_id) is None
    assert _queue_row(report_id, admin)["collection"] is None
    assert _resolve(report_id, "hidden", admin).json()["detail"]["code"] == "report_target_gone"
    assert _resolve(report_id, "dismissed", admin).status_code == 200


def test_empty_collections_are_the_owners_view_only(db, cleanup, owner, stranger):
    filled = _make_collection(db, cleanup, owner=owner, title="Filled")
    _add(db, filled, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1)))
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
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, collection, event)

    event.deleted_at = datetime.now(UTC)
    db.commit()

    anonymous = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert anonymous["total"] == 0
    assert client.get(f"/api/v1/collections/{collection.id}").json()["event_count"] == 0


def test_profile_collections_404_on_unknown_user():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}/collections")
    assert response.status_code == 404


def test_event_collections_report_membership_to_the_owner(db, cleanup, owner):
    holding = _make_collection(db, cleanup, owner=owner, title="Holding")
    _make_collection(db, cleanup, owner=owner, title="Other")
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, holding, event)

    body = client.get(
        f"/api/v1/events/{event.id}/collections", headers=login_as(client, owner)
    ).json()
    by_title = {item["title"]: item["in_collection"] for item in body["items"]}
    assert by_title == {"Holding": True, "Other": False}


def test_event_collections_count_each_collection_on_the_showable_predicate(db, cleanup, owner):
    """The count under a title is the one the collection's own page prints (same predicate)."""
    collection = _make_collection(db, cleanup, owner=owner, title="Holding")
    empty = _make_collection(db, cleanup, owner=owner, title="Other")
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, collection, event)
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 6, 1)))
    _add(
        db,
        collection,
        _make_event(db, cleanup, owner=owner, occurred_date=date(2020, 1, 1), hidden=True),
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
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    assert client.get(f"/api/v1/events/{event.id}/collections").status_code == 401
    assert (
        client.get(
            f"/api/v1/events/{event.id}/collections", headers=login_as(client, stranger)
        ).status_code
        == 403
    )


def _add_media(
    db,
    event: Event,
    name: str,
    kind: str = "image",
    role: str = "source",
    level: str = "direct",
    is_graphic: bool = False,
):
    """Give one event a file the card rule may pick: a new source of ``level`` carrying it, or a
    proof image."""
    media = Media(sha256=fake_sha256(), storage_url=f"https://media.example.com/{name}", kind=kind)
    if role == "proof":
        event.media.append(media)
        return
    event.sources.append(
        Source(
            level=level,
            kind="unknown",
            is_graphic=is_graphic,
            links=[SourceLink(url=f"https://example.com/{name}")],
            media=media,
        )
    )


def _tile_urls(collection: Collection) -> list[str]:
    body = client.get(f"/api/v1/collections/{collection.id}").json()
    return [tile["url"] for tile in body["cover"]]


def test_mosaic_is_empty_without_media(db, cleanup, owner):
    """An item with nothing a card may show contributes no tile, so the collection wears the placeholder."""
    collection = _make_collection(db, cleanup, owner=owner)
    _add(db, collection, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1)))
    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == []


def test_mosaic_of_one_item_is_one_tile(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    _add_media(db, event, "only.jpg")
    _add(db, collection, event)
    db.commit()

    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == [
        {"url": "https://media.example.com/only.jpg", "kind": "image", "role": "source"}
    ]


def test_mosaic_takes_the_first_four_items_in_chronological_order(db, cleanup, owner):
    """Six items, four tiles: the walk follows the collection page's order and stops at four."""
    collection = _make_collection(db, cleanup, owner=owner)
    for day in range(1, 7):
        event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, day))
        _add_media(db, event, f"day{day}.jpg")
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == [
        f"https://media.example.com/day{day}.jpg" for day in (1, 2, 3, 4)
    ]


def test_mosaic_skips_a_graphic_item_and_keeps_walking(db, cleanup, owner):
    """A flagged item is stepped over, so no reader meets death or injury on a card and the mosaic fills from later items."""
    collection = _make_collection(db, cleanup, owner=owner)
    graphic = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1), is_graphic=True)
    _add_media(db, graphic, "graphic.jpg")
    _add(db, collection, graphic)
    for day in (2, 3):
        event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, day))
        _add_media(db, event, f"day{day}.jpg")
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == [
        "https://media.example.com/day2.jpg",
        "https://media.example.com/day3.jpg",
    ]


def test_mosaic_skips_an_item_with_any_graphic_source(db, cleanup, owner):
    """An item is graphic when any of its sources is: a flagged context source keeps the
    item off the mosaic even though the source with the file is not flagged."""
    collection = _make_collection(db, cleanup, owner=owner)
    flagged = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    _add_media(db, flagged, "unflagged.jpg")
    _add_media(db, flagged, "context.mp4", kind="video", level="context", is_graphic=True)
    shown = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 2))
    _add_media(db, shown, "shown.jpg")
    for event in (flagged, shown):
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == ["https://media.example.com/shown.jpg"]


def test_a_tile_takes_the_first_source_image_in_source_order(db, cleanup, owner):
    """Source files come first in source order (level before insertion), proof images after
    them, and the first image of that walk is the tile."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    _add_media(db, event, "context.jpg", level="context")
    _add_media(db, event, "proof.jpg", role="proof")
    _add_media(db, event, "indirect.jpg", level="indirect")
    _add(db, collection, event)
    db.commit()

    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == [
        {"url": "https://media.example.com/indirect.jpg", "kind": "image", "role": "source"}
    ]


def test_a_tile_prefers_an_image_over_a_clip_on_the_same_item(db, cleanup, owner):
    """A tile never plays: an item with a source clip and a proof image offers the picture; a clip-only item tiles as a clip."""
    collection = _make_collection(db, cleanup, owner=owner)
    both = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    _add_media(db, both, "footage.mp4", kind="video")
    _add_media(db, both, "proof.jpg", role="proof")
    clip_only = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 2))
    _add_media(db, clip_only, "clip.mp4", kind="video")
    for event in (both, clip_only):
        _add(db, collection, event)
    db.commit()

    assert client.get(f"/api/v1/collections/{collection.id}").json()["cover"] == [
        {"url": "https://media.example.com/proof.jpg", "kind": "image", "role": "proof"},
        {"url": "https://media.example.com/clip.mp4", "kind": "video", "role": "source"},
    ]


def test_a_tile_off_a_proof_image_says_so(db, cleanup, owner):
    """A clip item tiles on its proof image and the tile names the role.

    Proof images have no display derivatives (``services/storage.upload_proof_image``), so the role tells a client to read the original, not a ``_thumb`` that was never written (403)."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    _add_media(db, event, "footage.mp4", kind="video")
    _add_media(db, event, "inline.jpg", role="proof")
    _add(db, collection, event)
    db.commit()

    (tile,) = client.get(f"/api/v1/collections/{collection.id}").json()["cover"]
    assert tile["role"] == "proof"
    assert tile["url"] == "https://media.example.com/inline.jpg"


def test_a_tile_off_source_footage_says_source(db, cleanup, owner):
    """An item tiling on its own picture carries ``source``, whose upload path writes the ``_hero`` / ``_thumb`` siblings."""
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    _add_media(db, event, "shot.jpg")
    _add(db, collection, event)
    db.commit()

    (tile,) = client.get(f"/api/v1/collections/{collection.id}").json()["cover"]
    assert tile["role"] == "source"


def test_mosaic_drops_a_withheld_or_closed_item(db, cleanup, owner):
    """The tiles read the shared predicate, so a taken-down or closed row leaves the card with no membership write."""
    collection = _make_collection(db, cleanup, owner=owner)
    hidden = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1), hidden=True)
    _add_media(db, hidden, "hidden.jpg")
    closed = _make_event(
        db,
        cleanup,
        owner=owner,
        status=STATUS_CLOSED,
        occurred_date=date(2026, 3, 2),
        before_closed_status=STATUS_REQUESTED,
    )
    _add_media(db, closed, "closed.jpg")
    shown = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 3))
    _add_media(db, shown, "shown.jpg")
    for event in (hidden, closed, shown):
        _add(db, collection, event)
    db.commit()

    assert _tile_urls(collection) == ["https://media.example.com/shown.jpg"]


@pytest.fixture
def make_tag(db):
    """A factory for tags, swept with their event associations.

    Separate from ``cleanup``: ``tags`` is keyed on a unique name, and the sweep clears ``event_tags`` before ``cleanup`` deletes the events."""
    created: list[uuid.UUID] = []

    def _make(name: str) -> Tag:
        tag = Tag(name=f"{name}-{uuid.uuid4().hex[:8]}")
        db.add(tag)
        db.commit()
        db.refresh(tag)
        created.append(tag.id)
        return tag

    yield _make

    if created:
        db.execute(event_tags.delete().where(event_tags.c.tag_id.in_(created)))
        db.execute(Tag.__table__.delete().where(Tag.id.in_(created)))
        db.commit()


def _tag_names(payload: dict) -> list[str]:
    return [tag["name"] for tag in payload["tags"]]


def test_tags_are_the_union_of_the_items_tags(db, cleanup, owner, make_tag):
    """Two items sharing a tag and carrying one more each yield three tags: the shared one once, ordered by name."""
    shared = make_tag("shared")
    only_first = make_tag("alpha")
    only_second = make_tag("beta")

    collection = _make_collection(db, cleanup, owner=owner)
    first = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    second = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 4, 1))
    first.tags = [shared, only_first]
    second.tags = [shared, only_second]
    _add(db, collection, first)
    _add(db, collection, second)
    db.commit()

    body = client.get(f"/api/v1/collections/{collection.id}").json()
    assert _tag_names(body) == sorted([shared.name, only_first.name, only_second.name])
    assert set(body["tags"][0]) == {"id", "name"}


def test_tags_include_the_tags_of_the_items_sources(db, cleanup, owner, make_tag):
    """An item's tags are its own and its sources': a tag on both counts once, and the
    union stays ordered by name."""
    on_event = make_tag("m-event")
    on_source = make_tag("a-source")
    on_both = make_tag("z-both")

    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    event.tags = [on_event, on_both]
    event.sources[0].tags = [on_source, on_both]
    _add(db, collection, event)
    db.commit()

    body = client.get(f"/api/v1/collections/{collection.id}").json()
    assert _tag_names(body) == [on_source.name, on_event.name, on_both.name]


def test_an_item_leaving_the_collectable_set_takes_its_tags_with_it(db, cleanup, owner, make_tag):
    """The union uses the same predicate as the count, so closing or withholding an item drops its tags with no membership write."""
    kept = make_tag("kept")
    closed_only = make_tag("closedonly")
    hidden_only = make_tag("hiddenonly")

    collection = _make_collection(db, cleanup, owner=owner)
    standing = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    leaving = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 4, 1))
    withheld = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    standing.tags = [kept]
    leaving.tags = [closed_only]
    withheld.tags = [hidden_only]
    for event in (standing, leaving, withheld):
        _add(db, collection, event)
    db.commit()

    assert set(_tag_names(client.get(f"/api/v1/collections/{collection.id}").json())) == {
        kept.name,
        closed_only.name,
        hidden_only.name,
    }

    leaving.status = STATUS_CLOSED
    leaving.closed_at = datetime.now(UTC)
    leaving.before_closed_status = STATUS_GEOLOCATED
    leaving.geolocated_at = None
    withheld.hidden_at = datetime.now(UTC)
    db.commit()

    body = client.get(f"/api/v1/collections/{collection.id}").json()
    assert _tag_names(body) == [kept.name]
    assert body["event_count"] == 1


def test_a_collection_holding_nothing_tagged_has_no_tags(db, cleanup, owner):
    """An empty collection and one whose items carry no tag both read ``[]``."""
    empty = _make_collection(db, cleanup, owner=owner, title="Empty")
    untagged = _make_collection(db, cleanup, owner=owner, title="Untagged")
    _add(db, untagged, _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1)))

    assert client.get(f"/api/v1/collections/{empty.id}").json()["tags"] == []
    assert client.get(f"/api/v1/collections/{untagged.id}").json()["tags"] == []


def test_every_read_surface_carries_the_same_tags(db, cleanup, owner, make_tag):
    """One read shape: the collection page, search hit and profile list share a builder, so the tags cannot differ."""
    on_source = make_tag("satellite")
    free = make_tag("corridor")

    collection = _make_collection(db, cleanup, owner=owner, title="Shelved")
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 3, 1))
    event.tags = [free]
    event.sources[0].tags = [on_source]
    _add(db, collection, event)
    db.commit()

    expected = [free.name, on_source.name]
    assert _tag_names(client.get(f"/api/v1/collections/{collection.id}").json()) == expected

    hits = client.get(f"/api/v1/search?type=collection&author={owner.username}").json()
    assert [_tag_names(hit) for hit in hits["collections"]] == [expected]

    listed = client.get(f"/api/v1/users/{owner.username}/collections").json()
    assert [_tag_names(item) for item in listed["items"]] == [expected]


def test_hard_deleting_the_owner_drops_the_collections_and_their_memberships(
    db, cleanup, owner, admin
):
    collection = _make_collection(db, cleanup, owner=owner)
    event = _make_event(db, cleanup, owner=owner, occurred_date=date(2026, 5, 1))
    _add(db, collection, event)
    client.cookies.clear()
    # Read the ids before the erasure (the session's copies of deleted rows cannot answer).
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


def _members(db, collection: Collection) -> set[uuid.UUID]:
    db.expire_all()
    return {
        event_id
        for (event_id,) in db.query(CollectionEvent.event_id).filter(
            CollectionEvent.collection_id == collection.id
        )
    }


def _titled(db, event: Event, title: str) -> Event:
    event.title = title
    db.commit()
    return event


def _bulk(collection: Collection, body: dict, user: User):
    return client.post(
        f"/api/v1/collections/{collection.id}/events", json=body, headers=login_as(client, user)
    )


def test_bulk_add_by_ids_adds_and_counts_what_it_skips(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    fresh = [_make_event(db, cleanup, owner=owner) for _ in range(2)]
    present = _make_event(db, cleanup, owner=owner)
    _add(db, collection, present)
    request = _make_event(db, cleanup, owner=owner, status=STATUS_REQUESTED)

    ids = [str(e.id) for e in (*fresh, present, request)]
    response = _bulk(collection, {"event_ids": [*ids, ids[0]]}, owner)

    assert response.status_code == 200
    assert response.json() == {
        "added": 2,
        "skipped": {"already_in_collection": 1, "not_collectable": 1},
    }
    assert _members(db, collection) == {fresh[0].id, fresh[1].id, present.id}


def test_bulk_add_is_idempotent(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    events = [_make_event(db, cleanup, owner=owner) for _ in range(3)]
    body = {"event_ids": [str(e.id) for e in events]}

    assert _bulk(collection, body, owner).json()["added"] == 3
    again = _bulk(collection, body, owner).json()

    assert again == {"added": 0, "skipped": {"already_in_collection": 3, "not_collectable": 0}}
    assert len(_members(db, collection)) == 3


def test_bulk_add_by_match_shelves_the_callers_matching_events(db, cleanup, owner, stranger):
    """A match resolves server-side: the caller's collectable Geolocations hits, nothing else."""
    token = f"bulk{uuid.uuid4().hex[:10]}"
    collection = _make_collection(db, cleanup, owner=owner)
    mine = [
        _titled(db, _make_event(db, cleanup, owner=owner), f"Strike near {token}"),
        _titled(db, _make_event(db, cleanup, owner=owner), f"Convoy at {token}"),
        _titled(
            db, _make_event(db, cleanup, owner=owner, status=STATUS_DETECTED), f"{token} depot"
        ),
    ]
    _titled(db, _make_event(db, cleanup, owner=owner), "Unrelated title")
    _titled(db, _make_event(db, cleanup, owner=owner, status=STATUS_REQUESTED), f"{token} ask")
    _titled(db, _make_event(db, cleanup, owner=stranger), f"Their {token}")
    match = {"q": token, "filters": {}}

    count = client.post(
        "/api/v1/collections/collectable-count", json=match, headers=login_as(client, owner)
    )
    assert count.status_code == 200
    assert count.json() == {"total": 3}

    response = _bulk(collection, {"match": match}, owner)

    assert response.status_code == 200
    assert response.json() == {
        "added": 3,
        "skipped": {"already_in_collection": 0, "not_collectable": 0},
    }
    assert _members(db, collection) == {e.id for e in mine}


def test_bulk_add_by_match_reads_the_search_filters(db, cleanup, owner):
    token = f"bulk{uuid.uuid4().hex[:10]}"
    collection = _make_collection(db, cleanup, owner=owner)
    _titled(db, _make_event(db, cleanup, owner=owner), f"Strike near {token}")
    detected = _titled(
        db, _make_event(db, cleanup, owner=owner, status=STATUS_DETECTED), f"{token} depot"
    )

    response = _bulk(
        collection, {"match": {"q": token, "filters": {"status": ["detected"]}}}, owner
    )

    assert response.json()["added"] == 1
    assert _members(db, collection) == {detected.id}


def test_bulk_add_by_an_empty_match_adds_nothing(db, cleanup, owner):
    """No query and no filter is no search, as on ``GET /search``."""
    collection = _make_collection(db, cleanup, owner=owner)
    _make_event(db, cleanup, owner=owner)

    response = _bulk(collection, {"match": {}}, owner)

    assert response.json()["added"] == 0
    assert _members(db, collection) == set()


def test_bulk_add_refuses_a_filter_value_outside_its_domain(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    for filters in ({"status": ["bogus"]}, {"author": "a%b"}, {"occurred_date_from": "nope"}):
        response = _bulk(collection, {"match": {"q": "x", "filters": filters}}, owner)
        assert response.status_code == 422, filters


@pytest.mark.parametrize("body", [{}, {"event_ids": [], "match": {"q": "x"}}])
def test_bulk_add_takes_exactly_one_mode(db, cleanup, owner, body):
    collection = _make_collection(db, cleanup, owner=owner)
    assert _bulk(collection, body, owner).status_code == 422


def test_bulk_add_caps_the_ids(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)
    ids = [str(uuid.uuid4()) for _ in range(MAX_CREATE_EVENTS + 1)]

    response = _bulk(collection, {"event_ids": ids}, owner)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_many_events"


def test_bulk_add_caps_a_match(db, cleanup, owner, monkeypatch):
    monkeypatch.setattr(collections_bulk, "MAX_CREATE_EVENTS", 1)
    token = f"bulk{uuid.uuid4().hex[:10]}"
    collection = _make_collection(db, cleanup, owner=owner)
    for _ in range(2):
        _titled(db, _make_event(db, cleanup, owner=owner), f"Strike near {token}")

    response = _bulk(collection, {"match": {"q": token}}, owner)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_many_events"
    assert _members(db, collection) == set()


def test_bulk_add_to_someone_elses_collection_is_403(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)
    theirs = _make_event(db, cleanup, owner=stranger)

    response = _bulk(collection, {"event_ids": [str(theirs.id)]}, stranger)

    assert response.status_code == 403
    assert _members(db, collection) == set()


def test_bulk_add_with_a_foreign_event_is_403_and_writes_nothing(db, cleanup, owner, stranger):
    collection = _make_collection(db, cleanup, owner=owner)
    mine = _make_event(db, cleanup, owner=owner)
    theirs = _make_event(db, cleanup, owner=stranger)

    response = _bulk(collection, {"event_ids": [str(mine.id), str(theirs.id)]}, owner)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_credited"
    assert _members(db, collection) == set()


def test_bulk_add_with_an_unknown_event_is_404(db, cleanup, owner):
    collection = _make_collection(db, cleanup, owner=owner)

    response = _bulk(collection, {"event_ids": [str(uuid.uuid4())]}, owner)

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "event_not_found"


def test_collectable_count_requires_auth():
    client.cookies.clear()
    assert client.post("/api/v1/collections/collectable-count", json={"q": "x"}).status_code == 401
