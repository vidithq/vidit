"""End-to-end tests for the requested view (ex ``/requests``).

Since the request + geolocation merge, the requested view is served by the
events surface: a request is an ``Event`` with ``status='requested'`` (an open
call to geolocate, with one source media and optionally an approximate
coordinate guess), and it stays visible as ``closed`` (with
``before_closed_status='requested'``) once the poster withdraws it. Fulfilment
is a lifecycle move in place via ``POST /events/{id}/geolocate`` (any authed
user; ownership transfers to the fulfiller while ``requested_by`` keeps the
poster). Local storage backend so file uploads exercise the real path.

What we lock in:

* Soft-delete invariant, every public read filters ``deleted_at IS NULL``.
* ``GET /events?view=requested`` scoping + status / tag / author filters.
* The requested list carries ``investigator_count`` + a small
  ``investigators_sample``.
* ``POST /events/requests`` rejects blank title / source_url / a missing
  file; auth required; the row is born ``requested`` + stamped.
* ``DELETE /events/{id}`` owner-only; 404 for unknown / soft-deleted.
* ``POST /events/{id}/investigate`` is idempotent, multi-analyst (no
  single-claimer reservation), rejected off ``requested``. ``DELETE`` is a
  no-op when the caller wasn't signalling.
* ``POST /events/{id}/close`` owner-only; requires a reason; rejects
  already-terminal states; stamps ``closed_at`` + ``before_closed_status``.
* ``POST /events/{id}/geolocate`` fulfils a requested event in place:
  it transitions to ``geolocated``, transfers ``owner_id`` to the
  fulfiller, credits them in ``event_geolocators``, and keeps
  ``requested_by`` as the original poster.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest

from app.models.event import (
    STATUS_CLOSED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
    EventInvestigator,
)
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests._fixtures import TINY_JPEG
from tests._fixtures import tiny_jpeg as _tiny_jpeg
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)

# ``db`` / ``author`` / ``second_user`` / ``free_tag`` / ``conflict_tag`` /
# ``capture_source_tag``, the autouse cookie-and-cache reset, and the shared
# ``client`` all come from the package ``conftest`` + ``_helpers``. The
# author / second_user teardown there is a superset that also clears
# contributor rows and ``requested_by_id`` rows, which the request flows need.
# ``third_user`` (a second investigator) is the one extra actor this suite adds.

_LIST = "/api/v1/events?view=requested"


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture
def third_user(db):
    user = User(
        username=f"bthr{uuid.uuid4().hex[:8]}",
        email=f"bthr-{uuid.uuid4().hex}@example.com",
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
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


# The geolocate transition (fulfilment) requires one conflict + one
# capture_source tag, same floor as a direct create. The 200-expecting
# fulfilment tests below thread both through this helper.
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
    """A request row: a ``requested`` (or withdrawn ``closed``) ``Event`` with
    no location and ``requested_by_id`` set to the poster, mirroring the
    create path (stamps included, the CHECKs demand them).
    """
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


# ── GET /events?view=requested, list ─────────────────────────────────────


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
    """The requested view keeps a withdrawn request visible but routes a
    rejected detection (``closed`` off ``detected``) to the located view,
    ``before_closed_status`` is the split."""
    withdrawn = _make_request(db, author=author, status=STATUS_CLOSED)
    rejected = _make_geo(db, author=author, status=STATUS_CLOSED)
    rejected.before_closed_status = "detected"
    db.commit()

    ids = {row["id"] for row in client.get(_LIST).json()}
    assert str(withdrawn.id) in ids
    assert str(rejected.id) not in ids


def test_list_excludes_located_events(db, author):
    """A ``geolocated`` event (a fulfilled request, or a direct submit) is
    served by the located view and must never surface in the requested one,
    even though it shares the table."""
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


def test_list_filters_by_author_substring(db, author):
    request = _make_request(db, author=author)
    needle = author.username[2:6]
    response = client.get(f"{_LIST}&author={needle}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(request.id) in ids


def test_list_honours_limit(db, author):
    for _ in range(3):
        _make_request(db, author=author)
    response = client.get(f"{_LIST}&limit=2")
    assert response.status_code == 200
    assert len(response.json()) <= 2


def test_list_rejects_out_of_range_limit(author):
    for bad in ("0", "9999", "-1"):
        response = client.get(f"{_LIST}&limit={bad}")
        assert response.status_code == 422, f"expected 422 for limit={bad!r}"


def test_list_carries_investigator_aggregates(db, author, second_user, third_user):
    """The requested list gives every card a count + a small avatar sample
    without N+1. The detail endpoint serves the full investigators list."""
    request = _make_request(db, author=author)
    db.add(EventInvestigator(event_id=request.id, user_id=second_user.id))
    db.add(EventInvestigator(event_id=request.id, user_id=third_user.id))
    db.commit()
    try:
        response = client.get(_LIST)
        assert response.status_code == 200
        row = next(r for r in response.json() if r["id"] == str(request.id))
        assert row["investigator_count"] == 2
        usernames = {u["username"] for u in row["investigators_sample"]}
        assert usernames == {second_user.username, third_user.username}
    finally:
        db.query(EventInvestigator).filter(EventInvestigator.event_id == request.id).delete(
            synchronize_session=False
        )
        db.commit()


def test_located_list_leaves_investigator_aggregates_null(db, author):
    """The located view skips the aggregate queries; its cards carry nulls."""
    geo = _make_geo(db, author=author)
    row = next(r for r in client.get("/api/v1/events").json() if r["id"] == str(geo.id))
    assert row["investigator_count"] is None
    assert row["investigators_sample"] is None


# ── GET /events/{id}, requested detail ───────────────────────────────────


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
    assert body["requested_at"] is not None
    assert body["owner"]["username"] == author.username
    assert any(tag["name"] == free_tag.name for tag in body["tags"])
    assert len(body["media"]) == 1
    assert body["media"][0]["role"] == "source"
    assert body["investigators"] == []
    assert body["investigator_count"] == 0
    assert body["geolocators"] == []


def test_detail_404_for_soft_deleted(db, author):
    request = _make_request(db, author=author, deleted=True)
    response = client.get(f"/api/v1/events/{request.id}")
    assert response.status_code == 404


def test_detail_lists_every_investigator(db, author, second_user, third_user):
    request = _make_request(db, author=author)
    db.add(EventInvestigator(event_id=request.id, user_id=second_user.id))
    db.add(EventInvestigator(event_id=request.id, user_id=third_user.id))
    db.commit()
    try:
        response = client.get(f"/api/v1/events/{request.id}")
        assert response.status_code == 200
        body = response.json()
        usernames = {c["username"] for c in body["investigators"]}
        assert usernames == {second_user.username, third_user.username}
        assert body["investigator_count"] == 2
    finally:
        db.query(EventInvestigator).filter(EventInvestigator.event_id == request.id).delete(
            synchronize_session=False
        )
        db.commit()


# ── POST /events/requests, auth + validation + happy path ────────────────


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
    """A title past the 255-char column width 422s at the Form boundary,
    not at ``db.flush()`` after the file has already hit S3."""
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
    """source_url past the 2000-char API bound 422s at the Form boundary."""
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
    """Valid JSON that isn't a Tiptap ``doc`` is rejected with the typed
    ``invalid_proof`` envelope, before any upload."""
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
    """A lone half of the optional (lat, lng) guess is a client bug, 400."""
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
    assert body["requested_at"] is not None
    assert body["event_coords"] is None
    assert body["owner"]["username"] == author.username
    assert body["requested_by"]["username"] == author.username
    assert any(t["name"] == free_tag.name for t in body["tags"])
    assert len(body["media"]) == 1
    assert body["media"][0]["role"] == "source"
    assert body["investigators"] == []

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
    """A request may carry an approximate (lat, lng) guess, stored and
    round-tripped, without promoting the row out of ``requested``."""
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
    """event_date is optional on a request (omitted → null); source_posted_at is
    required (a post always has a time) and round-trips on the read model."""
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
    """A request MAY carry proof images (work started but not finished): a
    ``placeholder://`` src resolves from ``proof_files`` to a real URL and a
    ``Media(role='proof')`` row lands alongside the source, exactly like a
    geolocation. There is no proof-image floor, so the imageless requests in the
    other tests still succeed."""
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
    """A request accepts an event time with no event date: an approximate
    hour-of-day (sun position / shadows) is knowable before the day is."""
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
    """A request with no proof body stores the canonical empty doc, never NULL.
    ``events.proof`` is NOT NULL and ``create_request`` omits an explicit
    ``proof=``, so the model default has to fire and the intake must leave it in
    place (it only overwrites ``proof`` when a doc came in). No proof media lands."""
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
    """Images are allowed on a request now, but the sanitiser still runs: an
    unsafe src (a protocol-relative URL, an exfiltration vector) is dropped, not
    stored. Replaces the old strip-everything coverage now that safe images
    persist, keeping the request path guarded like the geolocation one."""
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
    """Garbage ``event_date`` → 422 before any S3 round-trip."""
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
    """SHA-256 hash of the uploaded bytes lands on the row + read API.

    Independent recomputation should match, that's the whole pitch:
    given the API response, an auditor can prove the bytes on S3 still
    match what the analyst submitted.
    """
    # The EXIF strip re-encodes, so the post-strip sha256 isn't known ahead of
    # time; assert API-response hash == row hash (internal consistency).
    # End-to-end auditor-replay needs a real S3 fetch, out of scope here.
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
    # Load-bearing assertion: API response hash matches the row hash.
    row = db.query(Media).filter(Media.id == uuid.UUID(media["id"])).one()
    assert row.sha256 == media["sha256"]
    assert row.role == "source"
    assert row.original_filename == "tiny.jpg"

    request_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.event_id == request_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
    db.commit()


# ── DELETE /events/{id} on a request ──────────────────────────────────────


def test_delete_requires_authentication(db, author):
    request = _make_request(db, author=author)
    response = client.delete(f"/api/v1/events/{request.id}")
    assert response.status_code == 401


def test_delete_returns_404_for_soft_deleted(db, author):
    request = _make_request(db, author=author, deleted=True)
    response = client.delete(f"/api/v1/events/{request.id}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_403_when_not_owner(db, author, second_user):
    request = _make_request(db, author=author)
    response = client.delete(f"/api/v1/events/{request.id}", headers=login_as(client, second_user))
    assert response.status_code == 403


def test_delete_succeeds_for_owner_and_cascades_media(db, author):
    request = _make_request(db, author=author)
    request_id = request.id
    response = client.delete(f"/api/v1/events/{request_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).first() is None
    assert db.query(Media).filter(Media.event_id == request_id).count() == 0


# ── POST /events/{id}/investigate ─────────────────────────────────────────


def test_investigate_requires_authentication(db, author):
    request = _make_request(db, author=author)
    response = client.post(f"/api/v1/events/{request.id}/investigate")
    assert response.status_code == 401


def test_investigate_inserts_row(db, author, second_user):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 204
    db.expire_all()
    rows = db.query(EventInvestigator).filter(EventInvestigator.event_id == request.id).all()
    assert len(rows) == 1
    assert rows[0].user_id == second_user.id


def test_investigate_is_idempotent(db, author, second_user):
    request = _make_request(db, author=author)
    for _ in range(3):
        response = client.post(
            f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
        )
        assert response.status_code == 204
    db.expire_all()
    assert (
        db.query(EventInvestigator)
        .filter(
            EventInvestigator.event_id == request.id,
            EventInvestigator.user_id == second_user.id,
        )
        .count()
        == 1
    )


def test_multiple_analysts_can_investigate_same_request(db, author, second_user, third_user):
    """The core multi-analyst contract, two investigators both signalling."""
    request = _make_request(db, author=author)
    r1 = client.post(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    r2 = client.post(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, third_user)
    )
    assert r1.status_code == 204
    assert r2.status_code == 204
    db.expire_all()
    user_ids = {
        c.user_id
        for c in db.query(EventInvestigator).filter(EventInvestigator.event_id == request.id).all()
    }
    assert user_ids == {second_user.id, third_user.id}


def test_investigate_rejected_off_requested(db, author, second_user):
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = client.post(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 409


def test_investigate_404_for_soft_deleted(db, author, second_user):
    request = _make_request(db, author=author, deleted=True)
    response = client.post(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 404


# ── DELETE /events/{id}/investigate ───────────────────────────────────────


def test_uninvestigate_removes_row(db, author, second_user):
    request = _make_request(db, author=author)
    db.add(EventInvestigator(event_id=request.id, user_id=second_user.id))
    db.commit()

    response = client.delete(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 204
    db.expire_all()
    assert (
        db.query(EventInvestigator)
        .filter(
            EventInvestigator.event_id == request.id,
            EventInvestigator.user_id == second_user.id,
        )
        .count()
        == 0
    )


def test_uninvestigate_is_noop_when_not_signalling(db, author, second_user):
    """Withdrawing a signal you never gave is still a 204, the user-
    observable post-condition (caller not in the working set) is what
    we promise, not "exactly one row was deleted." """
    request = _make_request(db, author=author)
    response = client.delete(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 204


def test_uninvestigate_rejected_off_requested(db, author, second_user):
    """A terminated event's signals are frozen history, 409, mirroring POST."""
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = client.delete(
        f"/api/v1/events/{request.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 409


# ── POST /events/{id}/close (withdraw) ────────────────────────────────────


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
    """An already-closed request can't be re-closed (terminal state), 409."""
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={"close_reason": "again"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


# ── POST /events/{id}/geolocate, fulfilment in place ─────────────────────
# Since the merge, fulfilling a request is not a row copy: the requested event
# is transitioned in place by the geolocate endpoint. Any authed user may
# answer an open request; ``owner_id`` transfers to the fulfiller (who is also
# credited in ``event_geolocators``) while ``requested_by`` keeps the poster.


def _geolocate_fulfilment(client, request_id, fulfiller, *tags, **overrides):
    """POST the geolocate form that fulfils a requested event. The request
    already carries a source media, so only the proof image is new."""
    data = {
        "title": "Fulfilled from a request",
        "lat": "48.5",
        "lng": "34.5",
        "source_url": "https://example.com/post",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "tag_ids": _required_tag_ids(*tags),
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
    db, author, second_user, conflict_tag, capture_source_tag
):
    """The end-to-end promise: another analyst answers an open request, the row
    transitions to ``geolocated`` in place, ``owner_id`` moves to the fulfiller
    (credited as a geolocator), and ``requested_by`` keeps the original poster."""
    request = _make_request(db, author=author)
    request_id = request.id

    response = _geolocate_fulfilment(
        client, request_id, second_user, conflict_tag, capture_source_tag
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(request_id)
    assert body["status"] == "geolocated"
    assert body["event_coords"] == {"lat": 48.5, "lng": 34.5}
    assert body["geolocated_at"] is not None
    # Ownership transferred to the fulfiller; the poster stays on requested_by.
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
    db, author, second_user, conflict_tag, capture_source_tag
):
    """A fulfiller cannot rewrite the requester's evidence anchor: geolocate()
    ignores the form ``source_url`` on a requested fulfilment and keeps the
    request's."""
    request = _make_request(db, author=author, source_url="https://requester.example/evidence")
    request_id = request.id

    response = _geolocate_fulfilment(
        client,
        request_id,
        second_user,
        conflict_tag,
        capture_source_tag,
        source_url="https://tamper.example/other",
    )
    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == "https://requester.example/evidence"

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.source_url == "https://requester.example/evidence"


def test_geolocate_fulfilled_event_leaves_requested_view(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """Once fulfilled the row is ``geolocated``, so it drops off the requested
    surface and appears on the located view instead."""
    request = _make_request(db, author=author)
    request_id = request.id

    assert (
        _geolocate_fulfilment(client, request_id, second_user, conflict_tag, capture_source_tag)
    ).status_code == 200

    # Gone from the requested-view list; present on the located one.
    assert all(row["id"] != str(request_id) for row in client.get(_LIST).json())
    located = client.get(f"/api/v1/events/{request_id}")
    assert located.status_code == 200
    assert located.json()["status"] == "geolocated"
    listed = {row["id"] for row in client.get("/api/v1/events").json()}
    assert str(request_id) in listed


def test_geolocate_fulfilment_reuses_existing_media(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """Fulfilment keeps the request's source media on the same row (no
    transfer / churn): the one source survives the transition; the proof image
    lands alongside it as a ``proof`` row."""
    request = _make_request(db, author=author)
    request_id = request.id
    media_id = db.query(Media.id).filter(Media.event_id == request_id).scalar()

    assert (
        _geolocate_fulfilment(client, request_id, second_user, conflict_tag, capture_source_tag)
    ).status_code == 200

    db.expire_all()
    sources = db.query(Media).filter(Media.event_id == request_id, Media.role == "source").all()
    assert [m.id for m in sources] == [media_id]
    assert db.query(Media).filter(Media.event_id == request_id, Media.role == "proof").count() == 1


def test_geolocate_rejects_second_source_on_top_of_kept_one(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """An event carries a single source media: adding a file while keeping the
    request's existing one is rejected before any upload."""
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
            "tag_ids": _required_tag_ids(conflict_tag, capture_source_tag),
            "proof": proof_form_field(),
        },
        files=[("files", _tiny_jpeg()), proof_file_part()],
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_many_files"


def test_geolocate_fulfilment_honors_analyst_title_and_tags(
    db, author, second_user, free_tag, conflict_tag, capture_source_tag
):
    """The fulfilling analyst CAN refine the title and tags, they know more than
    the poster did (place name resolved, conflict tag added). The refined values
    land on the row; the required conflict + capture_source floor is enforced."""
    request = _make_request(db, author=author, title="Original request title", tags=[free_tag])
    request_id = request.id

    response = _geolocate_fulfilment(
        client,
        request_id,
        second_user,
        free_tag,
        conflict_tag,
        capture_source_tag,
        title="Refined title with place name",
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Refined title with place name"
    tag_names = {t["name"] for t in body["tags"]}
    assert {free_tag.name, conflict_tag.name, capture_source_tag.name}.issubset(tag_names)


def test_geolocate_fulfilment_blocked_without_required_tags(db, author, second_user):
    """The floor still applies to fulfilment: a requested row without the
    conflict + capture_source tags 400s (the request itself may be tagless)."""
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
    db, author, second_user, conflict_tag, capture_source_tag
):
    """A withdrawn (``closed``) request is terminal, not answerable, geolocate
    409s with the invalid_state code (only ``requested`` / ``detected``
    transition)."""
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = _geolocate_fulfilment(
        client, request.id, second_user, conflict_tag, capture_source_tag
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_geolocate_fulfilment_404_for_unknown(author, conflict_tag, capture_source_tag):
    response = _geolocate_fulfilment(client, uuid.uuid4(), author, conflict_tag, capture_source_tag)
    assert response.status_code == 404
