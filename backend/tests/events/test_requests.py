"""End-to-end tests for the requested view.

A request is an ``Event`` with ``status='requested'``; a withdrawn one stays visible
as ``closed`` with ``before_closed_status='requested'``. ``POST
/events/{id}/geolocate`` fulfils it in place: ownership moves to the fulfiller and
``requested_by`` keeps the poster. Local storage backend so uploads exercise the real
path.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.models.event import (
    STATUS_CLOSED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
    EventVersion,
)
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.services.events import (
    EventStateError,
    ImportProvenance,
    stamp_provenance,
    update_request,
)
from app.services.evidence_intake import collect_media_keys
from tests._fixtures import TINY_JPEG
from tests._fixtures import tiny_jpeg as _tiny_jpeg
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)

_LIST = "/api/v1/events?view=requested"


# Fulfilment needs the conflict + capture_source floor, same as a direct create.
def _required_tag_ids(*tags: Tag) -> str:
    return json.dumps([str(t.id) for t in tags])


def _make_request(
    db,
    *,
    author: User,
    title: str | None = None,
    source_url: str = "https://example.com/post",
    status: str = STATUS_REQUESTED,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    with_media: bool = True,
) -> Event:
    """Mirrors the create path, stamps included (the CHECKs demand them)."""
    now = datetime.now(UTC)
    request = Event(
        owner_id=author.id,
        requested_by_id=author.id,
        title=title or f"Request {uuid.uuid4().hex[:8]}",
        source_url=source_url,
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=status,
        requested_at=now,
        closed_at=now if status == STATUS_CLOSED else None,
        before_closed_status=STATUS_REQUESTED if status == STATUS_CLOSED else None,
        close_reason="Withdrawn" if status == STATUS_CLOSED else None,
    )
    if deleted:
        request.deleted_at = datetime.now(UTC)
    if tags:
        request.tags = tags
    db.add(request)
    db.flush()
    if with_media:
        db.add(
            Media(
                event_id=request.id,
                role="source",
                storage_url=(
                    f"http://localhost:8000/local-storage/request_uploads/{request.id}/x.jpg"
                ),
                media_type="image",
            )
        )
    db.commit()
    db.refresh(request)
    return request


def test_list_returns_seeded_request(db, author):
    request = _make_request(db, author=author)
    response = client.get(_LIST)
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(request.id) in ids


def test_list_excludes_soft_deleted(db, author):
    live = _make_request(db, author=author)
    dead = _make_request(db, author=author, deleted=True)
    response = client.get(_LIST)
    ids = {row["id"] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_list_filters_by_status(db, author):
    open_one = _make_request(db, author=author, status=STATUS_REQUESTED)
    closed = _make_request(db, author=author, status=STATUS_CLOSED)

    response = client.get(f"{_LIST}&status={STATUS_REQUESTED}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(open_one.id) in ids
    assert str(closed.id) not in ids


def test_list_includes_withdrawn_but_not_rejected_closed(db, author):
    """``before_closed_status`` splits a withdrawn request from a rejected detection."""
    withdrawn = _make_request(db, author=author, status=STATUS_CLOSED)
    rejected = _make_geo(db, author=author, status=STATUS_CLOSED)
    rejected.before_closed_status = "detected"
    db.commit()

    ids = {row["id"] for row in client.get(_LIST).json()}
    assert str(withdrawn.id) in ids
    assert str(rejected.id) not in ids


def test_list_excludes_located_events(db, author):
    """A fulfilled request never surfaces in the requested view."""
    requested = _make_request(db, author=author)
    located = _make_geo(db, author=author, status=STATUS_GEOLOCATED)

    ids = {row["id"] for row in client.get(_LIST).json()}
    assert str(requested.id) in ids
    assert str(located.id) not in ids


def test_list_rejects_unknown_view(author):
    assert client.get("/api/v1/events?view=bogus").status_code == 422


def test_list_filters_by_tag(db, author, free_tag):
    with_tag = _make_request(db, author=author, tags=[free_tag])
    without_tag = _make_request(db, author=author)

    response = client.get(f"{_LIST}&tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_tag.id) in ids
    assert str(without_tag.id) not in ids


def test_list_filters_by_author_exact(db, author):
    """Exact case-insensitive match; a fragment matches nothing."""
    request = _make_request(db, author=author)
    response = client.get(f"{_LIST}&author={author.username.upper()}")
    assert response.status_code == 200
    assert str(request.id) in {row["id"] for row in response.json()}
    response = client.get(f"{_LIST}&author={author.username[2:6]}")
    assert response.status_code == 200
    assert str(request.id) not in {row["id"] for row in response.json()}


def test_list_honours_limit(db, author):
    for _ in range(3):
        _make_request(db, author=author)
    response = client.get(f"{_LIST}&limit=2")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_rejects_unusable_limit(author):
    """Below 1 and non-numeric are 422; over the cap clamps."""
    for bad in ("0", "-1", "abc"):
        response = client.get(f"{_LIST}&limit={bad}")
        assert response.status_code == 422, f"expected 422 for limit={bad!r}"


def test_detail_returns_full_shape(db, author, free_tag):
    request = _make_request(db, author=author, tags=[free_tag])
    response = client.get(f"/api/v1/events/{request.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(request.id)
    assert body["title"] == request.title
    assert body["source_url"] == request.source_url
    assert body["status"] == STATUS_REQUESTED
    assert body["event_coords"] is None
    assert body["owner"]["username"] == author.username
    assert any(tag["name"] == free_tag.name for tag in body["tags"])
    assert len(body["media"]) == 1
    assert body["media"][0]["role"] == "source"
    assert body["geolocators"] == []


def test_detail_404_for_soft_deleted(db, author):
    request = _make_request(db, author=author, deleted=True)
    response = client.get(f"/api/v1/events/{request.id}")
    assert response.status_code == 404


def test_create_requires_authentication():
    response = client.post("/api/v1/events/requests")
    assert response.status_code == 401


def test_create_rejects_missing_file(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "x",
            "source_url": "https://example.com",
            "source_posted_at": "2026-05-01T12:00",
        },
    )
    assert response.status_code in (400, 422)


def test_create_rejects_blank_title(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "   ",
            "source_url": "https://example.com",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 400
    assert "title" in response.json()["detail"].lower()


def test_create_rejects_blank_source_url(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "  ",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 400
    assert "source_url" in response.json()["detail"].lower()


def test_create_rejects_invalid_proof_json(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com",
            "source_posted_at": "2026-05-01T12:00",
            "proof": "{not valid",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 400
    assert "proof" in response.json()["detail"].lower()


def test_create_rejects_over_length_title(author):
    """A title past 255 chars 422s at the Form boundary, before any upload."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "a" * 256,
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 422


def test_create_rejects_over_length_source_url(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com/" + "a" * 2000,
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 422


def test_create_rejects_unsanitisable_proof(author):
    """Valid JSON that is not a Tiptap ``doc`` gets ``invalid_proof`` before any upload."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "proof": '{"type": "not-doc"}',
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_proof"


def test_create_rejects_half_typed_coordinate_guess(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "lat": "48.5",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_create_happy_path(db, author, free_tag):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Footage from a strike",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": f'["{free_tag.id}"]',
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_REQUESTED
    assert body["event_coords"] is None
    assert body["owner"]["username"] == author.username
    assert body["requested_by"]["username"] == author.username
    assert any(t["name"] == free_tag.name for t in body["tags"])
    assert len(body["media"]) == 1
    assert body["media"][0]["role"] == "source"

    request_id = uuid.UUID(body["id"])
    # The created row is a requested event with no location and the poster on
    # ``requested_by_id``, the invariant fulfilment relies on.
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_REQUESTED
    assert row.event_coords is None
    assert row.requested_by_id == author.id

    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_create_accepts_coordinate_guess(db, author):
    """The guess round-trips without promoting the row out of ``requested``."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Roughly here",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "lat": "48.5",
            "lng": "34.5",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_REQUESTED
    assert body["event_coords"] == {"lat": 48.5, "lng": 34.5}

    request_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_create_event_date_optional_source_required(db, author):
    """``event_date`` is optional; ``source_posted_at`` is required."""
    with_dates = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Dated request",
            "source_url": "https://example.com/post/1",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-02T09:30",
        },
        files={"file": _tiny_jpeg()},
    )
    assert with_dates.status_code == 201, with_dates.text
    assert with_dates.json()["event_date"] == "2026-05-01"
    assert with_dates.json()["source_posted_at"].startswith("2026-05-02T09:30")

    without = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Undated request",
            "source_url": "https://example.com/post/2",
            "source_posted_at": "2026-05-02T09:30",
        },
        files={"file": _tiny_jpeg()},
    )
    assert without.status_code == 201, without.text
    assert without.json()["event_date"] is None
    assert without.json()["source_posted_at"].startswith("2026-05-02T09:30")

    for created in (with_dates.json(), without.json()):
        bid = uuid.UUID(created["id"])
        db.query(Media).filter(Media.event_id == bid).delete(synchronize_session=False)
        db.query(Event).filter(Event.id == bid).delete(synchronize_session=False)
    db.commit()


def test_create_request_keeps_proof_image(db, author, tmp_path, monkeypatch):
    """A request may carry proof images; there is no proof-image floor."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Request with a proof image",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "proof": proof_form_field(),
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part()],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "requested"
    srcs = [n["attrs"]["src"] for n in body["proof"]["content"] if n["type"] == "image"]
    assert len(srcs) == 1
    assert srcs[0].startswith("http")  # placeholder rewritten to the landed URL
    assert "placeholder://" not in json.dumps(body["proof"])

    request_id = uuid.UUID(body["id"])
    rows = db.query(Media).filter(Media.event_id == request_id).all()
    assert {m.role for m in rows} == {"source", "proof"}

    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_create_request_event_time_without_event_date(db, author):
    """An hour-of-day is knowable before the day is."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Timed but undated",
            "source_url": "https://example.com/post/3",
            "source_posted_at": "2026-05-03T09:30",
            "event_time": "14:30",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["event_date"] is None
    assert body["event_time"].startswith("14:30")

    request_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_create_request_blank_proof_stores_empty_doc(db, author):
    """The model default must fire: ``events.proof`` is NOT NULL and ``create_request``
    omits ``proof=``."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "No proof yet",
            "source_url": "https://example.com/post/blank",
            "source_posted_at": "2026-05-04T10:00",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["proof"] == {"type": "doc", "content": []}

    request_id = uuid.UUID(body["id"])
    proof_media = db.query(Media).filter(Media.event_id == request_id, Media.role == "proof")
    assert proof_media.count() == 0

    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_create_request_drops_unsafe_proof_image_src(db, author):
    """The sanitiser still drops an unsafe src (protocol-relative URL) on a request."""
    unsafe_doc = {
        "type": "doc",
        "content": [
            {"type": "image", "attrs": {"src": "//evil.example/pixel.gif"}},
            {"type": "paragraph", "content": [{"type": "text", "text": "wip"}]},
        ],
    }
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Unsafe proof image",
            "source_url": "https://example.com/post/unsafe",
            "source_posted_at": "2026-05-05T11:00",
            "proof": json.dumps(unsafe_doc),
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert not [n for n in body["proof"]["content"] if n["type"] == "image"]
    assert "evil.example" not in json.dumps(body["proof"])

    request_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_create_rejects_invalid_event_date(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "x",
            "source_url": "https://example.com/post/1",
            "event_date": "not-a-date",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": _tiny_jpeg()},
    )
    assert response.status_code == 422
    assert "event_date" in response.json()["detail"].lower()


def test_create_populates_sha256_on_media(db, author):
    """The API hash equals the row hash, so an auditor can recompute it from the bytes."""
    # The EXIF strip re-encodes, so the post-strip hash is not known ahead; assert API
    # hash == row hash.
    payload = TINY_JPEG

    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "hash test",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": ("tiny.jpg", payload, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["media"]) == 1
    media = body["media"][0]
    assert isinstance(media["sha256"], str)
    assert len(media["sha256"]) == 64
    row = db.query(Media).filter(Media.id == uuid.UUID(media["id"])).one()
    assert row.sha256 == media["sha256"]
    assert row.role == "source"
    assert row.original_filename == "tiny.jpg"

    request_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


def test_close_owner_only(db, author, second_user):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, second_user),
        json={"close_reason": "not mine to close"},
    )
    assert response.status_code == 403


def test_close_requires_reason(db, author):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={},
    )
    assert response.status_code == 422


def test_close_transitions_to_closed(db, author):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={"close_reason": "Footage turned out to be from 2014"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == STATUS_CLOSED
    assert body["closed_at"] is not None
    assert body["before_closed_status"] == STATUS_REQUESTED
    assert body["close_reason"] == "Footage turned out to be from 2014"


def test_close_rejected_on_terminal_state(db, author):
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={"close_reason": "again"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def _geolocate_fulfilment(client, request_id, fulfiller, conflict, *tags, **overrides):
    """POST the geolocate form that fulfils a requested event; only the proof image is
    new."""
    data = {
        "title": "Fulfilled from a request",
        "lat": "48.5",
        "lng": "34.5",
        "source_url": "https://example.com/post",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "tag_ids": _required_tag_ids(*tags),
        "conflict_ids": json.dumps([str(conflict.id)]),
        "proof": proof_form_field(),
    }
    data.update(overrides)
    return client.post(
        f"/api/v1/events/{request_id}/geolocate",
        headers=login_as(client, fulfiller),
        data=data,
        files=[proof_file_part()],
    )


def test_geolocate_fulfils_requested_and_transfers_ownership(
    db, author, second_user, conflict, capture_source_tag
):
    """The poster stays on ``requested_by``; ``owner_id`` moves to the fulfiller."""
    request = _make_request(db, author=author)
    request_id = request.id

    response = _geolocate_fulfilment(client, request_id, second_user, conflict, capture_source_tag)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(request_id)
    assert body["status"] == "geolocated"
    assert body["event_coords"] == {"lat": 48.5, "lng": 34.5}
    assert body["owner"]["username"] == second_user.username
    assert body["requested_by"]["username"] == author.username
    assert [g["username"] for g in body["geolocators"]] == [second_user.username]

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.owner_id == second_user.id
    assert row.requested_by_id == author.id
    assert row.event_coords is not None
    credit = db.query(EventGeolocator).filter(EventGeolocator.event_id == request_id).all()
    assert [c.user_id for c in credit] == [second_user.id]


def test_geolocate_keeps_requesters_source_url(
    db, author, second_user, conflict, capture_source_tag
):
    """``geolocate()`` keeps the request's ``source_url`` and ignores the form's."""
    request = _make_request(db, author=author, source_url="https://requester.example/evidence")
    request_id = request.id

    response = _geolocate_fulfilment(
        client,
        request_id,
        second_user,
        conflict,
        capture_source_tag,
        source_url="https://tamper.example/other",
    )
    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == "https://requester.example/evidence"

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.source_url == "https://requester.example/evidence"


def test_geolocate_fulfilled_event_leaves_requested_view(
    db, author, second_user, conflict, capture_source_tag
):
    request = _make_request(db, author=author)
    request_id = request.id

    assert (
        _geolocate_fulfilment(client, request_id, second_user, conflict, capture_source_tag)
    ).status_code == 200

    assert all(row["id"] != str(request_id) for row in client.get(_LIST).json())
    located = client.get(f"/api/v1/events/{request_id}")
    assert located.status_code == 200
    assert located.json()["status"] == "geolocated"
    listed = {row["id"] for row in client.get("/api/v1/events").json()}
    assert str(request_id) in listed


def test_geolocate_fulfilment_reuses_existing_media(
    db, author, second_user, conflict, capture_source_tag
):
    """The source media stays on the same row; the proof lands beside it."""
    request = _make_request(db, author=author)
    request_id = request.id
    media_id = db.query(Media.id).filter(Media.event_id == request_id).scalar()

    assert (
        _geolocate_fulfilment(client, request_id, second_user, conflict, capture_source_tag)
    ).status_code == 200

    db.expire_all()
    sources = db.query(Media).filter(Media.event_id == request_id, Media.role == "source").all()
    assert [m.id for m in sources] == [media_id]
    assert db.query(Media).filter(Media.event_id == request_id, Media.role == "proof").count() == 1


def test_geolocate_rejects_second_source_on_top_of_kept_one(
    db, author, second_user, conflict, capture_source_tag
):
    """One source media per event: a second file is rejected before upload."""
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/geolocate",
        headers=login_as(client, second_user),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com/post",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": _required_tag_ids(capture_source_tag),
            "conflict_ids": json.dumps([str(conflict.id)]),
            "proof": proof_form_field(),
        },
        files=[("files", _tiny_jpeg()), proof_file_part()],
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_many_files"


def test_geolocate_fulfilment_honors_analyst_title_and_tags(
    db, author, second_user, free_tag, conflict, capture_source_tag
):
    """The fulfiller may refine title and tags; the conflict + capture_source floor still
    holds."""
    request = _make_request(db, author=author, title="Original request title", tags=[free_tag])
    request_id = request.id

    response = _geolocate_fulfilment(
        client,
        request_id,
        second_user,
        conflict,
        free_tag,
        capture_source_tag,
        title="Refined title with place name",
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Refined title with place name"
    tag_names = {t["name"] for t in body["tags"]}
    assert {free_tag.name, capture_source_tag.name}.issubset(tag_names)
    assert conflict.name in {c["name"] for c in body["conflicts"]}


def test_geolocate_fulfilment_blocked_without_required_tags(db, author, second_user):
    """The floor applies to fulfilment although the request itself may be tagless."""
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/geolocate",
        headers=login_as(client, second_user),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com/post",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "proof": proof_form_field(),
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_geolocate_fulfilment_rejected_when_closed(
    db, author, second_user, conflict, capture_source_tag
):
    """A withdrawn request is terminal: geolocate 409s with ``invalid_state``."""
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = _geolocate_fulfilment(client, request.id, second_user, conflict, capture_source_tag)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_geolocate_fulfilment_404_for_unknown(author, conflict, capture_source_tag):
    response = _geolocate_fulfilment(client, uuid.uuid4(), author, conflict, capture_source_tag)
    assert response.status_code == 404


def _edit_request(client, request_id, editor, **overrides):
    """Defaults move every field the create form writes; override one per test."""
    data = {
        "title": "Edited title",
        "source_url": "https://example.com/post",
        "source_posted_at": "2026-05-02T09:30",
        "event_date": "2026-05-02",
    }
    data.update(overrides)
    return client.post(
        f"/api/v1/events/{request_id}/request",
        headers=login_as(client, editor),
        data=data,
    )


def test_edit_request_overwrites_in_place_without_a_version(db, author, free_tag):
    """The edit files no ``event_versions`` row; the version stays 1."""
    request = _make_request(db, author=author, source_url="https://example.com/first")
    request_id = request.id

    response = _edit_request(
        client,
        request_id,
        author,
        source_url="https://example.com/second",
        secondary_source_urls=["https://mirror.example/a"],
        tag_ids=json.dumps([str(free_tag.id)]),
        proof=json.dumps({"type": "doc", "content": [{"type": "paragraph"}]}),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(request_id)
    assert body["status"] == STATUS_REQUESTED
    assert body["title"] == "Edited title"
    assert body["source_url"] == "https://example.com/second"
    assert body["event_date"] == "2026-05-02"
    assert body["secondary_source_urls"] == ["https://mirror.example/a"]
    assert [t["name"] for t in body["tags"]] == [free_tag.name]
    assert body["version_no"] == 1
    # The poster keeps both roles: an edit is not a change of hands.
    assert body["owner"]["username"] == author.username
    assert body["requested_by"]["username"] == author.username

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_REQUESTED
    assert row.title == "Edited title"
    assert row.source_url == "https://example.com/second"
    assert row.version_no == 1
    assert db.query(EventVersion).filter(EventVersion.event_id == request_id).count() == 0


def test_edit_request_moves_the_coordinate_guess(db, author):
    """An edit posting neither half clears the guess."""
    request = _make_request(db, author=author)
    request_id = request.id

    placed = _edit_request(client, request_id, author, lat="48.5", lng="34.5")
    assert placed.status_code == 200, placed.text
    assert placed.json()["event_coords"] == {"lat": 48.5, "lng": 34.5}

    cleared = _edit_request(client, request_id, author)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["event_coords"] is None

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().event_coords is None


def test_edit_request_keeps_the_source_instant_the_bot_could_not_read(db, author):
    """A bot-opened request with an unreadable source date stays editable."""
    request = _make_request(db, author=author)
    request_id = request.id
    db.query(Event).filter(Event.id == request_id).update({"source_posted_at": None})
    db.commit()

    response = _edit_request(client, request_id, author, source_posted_at="")
    assert response.status_code == 200, response.text
    assert response.json()["source_posted_at"] is None


def test_edit_request_accepts_the_stored_instant_verbatim(db, author):
    """The form posts the row's value back, so the write must accept a full UTC instant
    (seconds and zone), not minute precision."""
    request = _make_request(db, author=author)
    response = _edit_request(client, request.id, author, source_posted_at="2026-05-01T12:00:27Z")
    assert response.status_code == 200, response.text
    assert response.json()["source_posted_at"] == "2026-05-01T12:00:27Z"


def test_edit_request_swaps_the_source_media(db, author):
    """Same removal + upload pair as the published writes; one source media remains."""
    request = _make_request(db, author=author)
    request_id = request.id
    stored = db.query(Media).filter(Media.event_id == request_id).one()

    response = client.post(
        f"/api/v1/events/{request_id}/request",
        headers=login_as(client, author),
        data={
            "title": "Edited title",
            "source_url": "https://example.com/post",
            "source_posted_at": "2026-05-02T09:30",
            "remove_media_ids": json.dumps([str(stored.id)]),
        },
        files=[("files", ("swap.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 200, response.text
    media = response.json()["media"]
    assert len(media) == 1
    assert media[0]["id"] != str(stored.id)

    db.expire_all()
    rows = db.query(Media).filter(Media.event_id == request_id).all()
    assert [m.role for m in rows] == ["source"]


def test_edit_request_sweeps_the_replaced_media(db, author, monkeypatch):
    """The dropped file's keys, derivatives included, go to ``sweep_keys`` so S3 is not
    orphaned."""
    request = _make_request(db, author=author)
    request_id = request.id
    stored = db.query(Media).filter(Media.event_id == request_id).one()
    expected_keys = collect_media_keys([stored])

    swept: list[list[str]] = []
    monkeypatch.setattr(
        "app.services.events.request.sweep_keys",
        lambda keys, context: swept.append(list(keys)),
    )

    response = client.post(
        f"/api/v1/events/{request_id}/request",
        headers=login_as(client, author),
        data={
            "title": "Edited title",
            "source_url": "https://example.com/post",
            "remove_media_ids": json.dumps([str(stored.id)]),
        },
        files=[("files", ("swap.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 200, response.text
    assert swept == [expected_keys]


def test_edit_request_keeps_a_stored_source_instant_the_form_omits(db, author):
    """Omitted means keep: an empty datetime input is indistinguishable from an absent
    field (the ``save_version`` rule)."""
    request = _make_request(db, author=author)
    request_id = request.id
    stored = request.source_posted_at

    response = _edit_request(client, request_id, author, source_posted_at="")
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().source_posted_at == stored


def test_edit_request_clears_the_event_date(db, author):
    """``event_date`` is the one optional field an edit clears."""
    request = _make_request(db, author=author)
    request_id = request.id
    dated = _edit_request(client, request_id, author, event_date="2026-05-02")
    assert dated.status_code == 200, dated.text
    assert dated.json()["event_date"] == "2026-05-02"

    cleared = _edit_request(client, request_id, author, event_date="")
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["event_date"] is None

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().event_date is None


def test_edit_request_cannot_unset_the_graphic_flag(db, author):
    """``is_graphic`` only ratchets up, as on ``geolocate`` and ``save_version``; only
    ``PATCH /admin/events/{id}/moderation`` clears it."""
    request = _make_request(db, author=author)
    request_id = request.id
    db.query(Event).filter(Event.id == request_id).update({"is_graphic": True})
    db.commit()

    response = _edit_request(client, request_id, author, is_graphic="false")
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().is_graphic is True


def test_edit_request_keeps_the_requested_at_stamp(db, author):
    """The edit keeps ``requested_at``, the requests board ordering key."""
    request = _make_request(db, author=author)
    request_id = request.id
    opened_at = request.requested_at

    response = _edit_request(client, request_id, author)
    assert response.status_code == 200, response.text

    db.expire_all()
    edited = db.query(Event).filter(Event.id == request_id).one()
    assert edited.requested_at == opened_at
    assert edited.title == "Edited title"


async def test_edit_request_loses_the_race_to_a_fulfilment(db, author):
    """A geolocate committing between the router's row resolution and the service's
    locked re-read makes the edit refuse (409) on the post-lock status. Service-level:
    the stale row goes straight to ``update_request`` while a second session holds the
    committed fulfilment. The owner answers their own request so the refusal turns on
    status alone (anyone else is refused earlier by ``ensure_owner``)."""
    request = _make_request(db, author=author)
    request_id = request.id

    # The competing fulfilment commits from its own session; this session's row is now
    # stale.
    winner = SessionLocal()
    try:
        fulfilled = winner.query(Event).filter(Event.id == request_id).one()
        fulfilled.status = STATUS_GEOLOCATED
        fulfilled.event_coords = from_shape(Point(37.8, 48.5), srid=4326)
        fulfilled.geolocated_at = datetime.now(UTC)
        winner.commit()
    finally:
        winner.close()

    with pytest.raises(EventStateError):
        await update_request(
            db,
            geo=request,
            current_user=author,
            title="Raced edit",
            source_url="https://example.com/raced",
            secondary_source_urls=[],
            proof_data=None,
            source_posted_at=None,
            tag_ids=[],
            conflict_ids=[],
            remove_media_ids=[],
            files=[],
            proof_files=[],
        )

    db.rollback()
    db.expire_all()
    raced = db.query(Event).filter(Event.id == request_id).one()
    assert raced.status == STATUS_GEOLOCATED
    assert raced.title != "Raced edit"
    assert raced.source_url == "https://example.com/post"


def test_edit_request_refuses_to_leave_the_row_without_footage(db, author):
    """Dropping the footage without a replacement is refused (the source floor)."""
    request = _make_request(db, author=author)
    request_id = request.id
    stored = db.query(Media).filter(Media.event_id == request_id).one()

    response = _edit_request(
        client, request_id, author, remove_media_ids=json.dumps([str(stored.id)])
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "media_required"

    db.expire_all()
    assert db.query(Media).filter(Media.event_id == request_id).count() == 1


def test_edit_request_owner_only(db, author, second_user):
    """Anyone can fulfil an open request; only its owner can edit it."""
    request = _make_request(db, author=author)
    response = _edit_request(client, request.id, second_user)
    assert response.status_code == 403


def test_edit_request_requires_authentication(db, author):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/request",
        data={"title": "Edited title", "source_url": "https://example.com/post"},
    )
    assert response.status_code == 401


def test_edit_request_rejects_a_row_that_left_requested(db, author):
    """Only an open request takes this write."""
    for status in (STATUS_GEOLOCATED, "detected", STATUS_CLOSED):
        geo = _make_geo(db, author=author, status=status, with_media=True)
        response = _edit_request(client, geo.id, author)
        assert response.status_code == 409, f"{status}: {response.text}"
        assert response.json()["detail"]["code"] == "invalid_state"


def test_edit_request_404_for_unknown(author):
    assert _edit_request(client, uuid.uuid4(), author).status_code == 404


def test_edit_request_rejects_blank_title(db, author):
    request = _make_request(db, author=author)
    response = _edit_request(client, request.id, author, title="   ")
    assert response.status_code == 400
    assert response.json()["detail"] == "title is required"


def test_fulfilment_keeps_the_edited_source_url(
    db, author, second_user, conflict, capture_source_tag
):
    """A fulfiller cannot rewrite the evidence anchor and inherits the corrected value."""
    request = _make_request(db, author=author, source_url="https://example.com/wrong")
    request_id = request.id

    edited = _edit_request(client, request_id, author, source_url="https://requester.example/right")
    assert edited.status_code == 200, edited.text

    response = _geolocate_fulfilment(
        client,
        request_id,
        second_user,
        conflict,
        capture_source_tag,
        source_url="https://tamper.example/other",
    )
    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == "https://requester.example/right"


def test_edit_request_keeps_the_provenance_of_a_bot_opened_row(db, author):
    """The edit leaves the five import columns where the import stamped them."""
    request = _make_request(db, author=author)
    request_id = request.id
    provenance = ImportProvenance(
        tweet_id=1234567890,
        url="https://x.com/analyst/status/1234567890",
        thread_tweet_ids=[1234567890],
        via="bot",
        post_at=datetime(2026, 5, 1, 8, 0, tzinfo=UTC),
    )
    row = db.query(Event).filter(Event.id == request_id).one()
    stamp_provenance(row, provenance)
    db.commit()

    response = _edit_request(client, request_id, author)
    assert response.status_code == 200, response.text
    assert response.json()["detected_from_url"] == provenance.url
    assert response.json()["detected_via"] == "bot"

    db.expire_all()
    edited = db.query(Event).filter(Event.id == request_id).one()
    assert edited.title == "Edited title"
    assert edited.detected_from_tweet_id == provenance.tweet_id
    assert edited.detected_from_url == provenance.url
    assert edited.detected_thread_tweet_ids == provenance.thread_tweet_ids
    assert edited.detected_via == "bot"
    assert edited.detected_post_at == provenance.post_at
