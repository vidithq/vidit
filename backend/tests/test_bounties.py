"""End-to-end tests for `/bounties`.

Since the bounty + geolocation merge, `/bounties` is a VIEW over the one
``geolocations`` table scoped to the requested lifecycle: a bounty is a
``Geolocation`` with ``status='requested'`` (an open call to geolocate, with
evidence media but no coordinates), and it stays visible as ``closed`` once the
author withdraws it. Fulfilment is no longer a row copy into a new geolocation:
the requested row is transitioned in place to ``geolocated`` by
``POST /geolocations/{id}/submit`` (any authed user, ownership transfers to the
fulfiller while ``requested_by`` keeps the poster). Local storage backend so file
uploads exercise the real path without S3.

What we lock in:

* Soft-delete invariant — every public read filters ``deleted_at IS NULL``.
* List filters honour status / tag / author contracts.
* List response carries ``claimer_count`` + a small ``claimer_sample``.
* ``POST /bounties`` rejects empty title / source_url / files; auth
  required; the bounty is created with status=requested.
* ``DELETE /bounties/{id}`` author-only; 404 for unknown / soft-deleted.
  The old 409-on-delete-when-fulfilled guard is gone (no promotion trace),
  so a delete now succeeds regardless of any later located event.
* ``POST /bounties/{id}/claim`` is idempotent, multi-analyst (no single-
  claimer reservation), rejected on non-requested status. ``DELETE`` is a
  no-op when the caller wasn't a claimer.
* ``POST /bounties/{id}/close`` author-only; rejects already-terminal
  states; transitions to ``closed`` + stamps ``closed_at``.
* ``POST /geolocations/{id}/submit`` fulfils a requested event in place:
  it transitions to ``geolocated``, transfers ``author_id`` to the
  fulfiller, and keeps ``requested_by`` as the original poster.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.geolocation import (
    STATUS_CLOSED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Geolocation,
    GeolocationClaim,
)
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests._fixtures import TINY_JPEG
from tests._fixtures import tiny_jpeg as _tiny_jpeg
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


@pytest.fixture
def author(db):
    user = User(
        username=f"bauth{uuid.uuid4().hex[:8]}",
        email=f"bauth-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    # Manual cascade: events (requested + fulfilled) authored OR requested by the
    # user → media + geolocation_claims (DB FK CASCADE); their claims; then user.
    db.query(GeolocationClaim).filter(GeolocationClaim.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(Geolocation).filter(Geolocation.author_id == user_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.requested_by_id == user_id).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def second_user(db):
    user = User(
        username=f"both{uuid.uuid4().hex[:8]}",
        email=f"both-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(GeolocationClaim).filter(GeolocationClaim.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(Geolocation).filter(Geolocation.author_id == user_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.requested_by_id == user_id).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


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
    db.query(GeolocationClaim).filter(GeolocationClaim.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def free_tag(db):
    tag = Tag(name=f"btag-{uuid.uuid4().hex[:8]}", category="free")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(Tag.__table__.delete().where(Tag.id == tag_id))
    db.commit()


@pytest.fixture
def conflict_tag(db):
    tag = Tag(name=f"bconflict-{uuid.uuid4().hex[:8]}", category="conflict")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(Tag.__table__.delete().where(Tag.id == tag_id))
    db.commit()


@pytest.fixture
def capture_source_tag(db):
    tag = Tag(name=f"bcapture-{uuid.uuid4().hex[:8]}", category="capture_source")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(Tag.__table__.delete().where(Tag.id == tag_id))
    db.commit()


# The submit transition (fulfilment) requires one conflict + one capture_source
# tag, same floor as a direct geolocation create. The 200-expecting fulfilment
# tests below thread both through this helper.
def _required_tag_ids(*tags: Tag) -> str:
    return json.dumps([str(t.id) for t in tags])


def _make_bounty(
    db,
    *,
    author: User,
    title: str | None = None,
    source_url: str = "https://example.com/post",
    status: str = STATUS_REQUESTED,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    with_media: bool = True,
) -> Geolocation:
    """A bounty row: a ``requested`` (or ``closed``) ``Geolocation`` with no
    location and ``requested_by_id`` set to the poster, mirroring the create path.
    """
    bounty = Geolocation(
        author_id=author.id,
        requested_by_id=author.id,
        title=title or f"Bounty {uuid.uuid4().hex[:8]}",
        source_url=source_url,
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=status,
    )
    if deleted:
        bounty.deleted_at = datetime.now(UTC)
    if tags:
        bounty.tags = tags
    db.add(bounty)
    db.flush()
    if with_media:
        db.add(
            Media(
                geolocation_id=bounty.id,
                storage_url=(
                    f"http://localhost:8000/local-storage/bounty_uploads/{bounty.id}/x.jpg"
                ),
                media_type="image",
            )
        )
    db.commit()
    db.refresh(bounty)
    return bounty


# ── GET /bounties — list ──────────────────────────────────────────────────


def test_list_returns_seeded_bounty(db, author):
    bounty = _make_bounty(db, author=author)
    response = client.get("/api/v1/bounties")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(bounty.id) in ids


def test_list_excludes_soft_deleted(db, author):
    live = _make_bounty(db, author=author)
    dead = _make_bounty(db, author=author, deleted=True)
    response = client.get("/api/v1/bounties")
    ids = {row["id"] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_list_filters_by_status(db, author):
    open_one = _make_bounty(db, author=author, status=STATUS_REQUESTED)
    closed = _make_bounty(db, author=author, status=STATUS_CLOSED)

    response = client.get(f"/api/v1/bounties?status={STATUS_REQUESTED}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(open_one.id) in ids
    assert str(closed.id) not in ids


def test_list_excludes_located_events(db, author):
    """A ``geolocated`` event (a fulfilled request, or a direct submit) is served
    by ``/geolocations`` and must never surface in the requested view — even
    though it shares the table."""
    requested = _make_bounty(db, author=author)
    located = _make_geolocated(db, author=author)

    ids = {row["id"] for row in client.get("/api/v1/bounties").json()}
    assert str(requested.id) in ids
    assert str(located.id) not in ids


def test_list_filters_by_tag(db, author, free_tag):
    with_tag = _make_bounty(db, author=author, tags=[free_tag])
    without_tag = _make_bounty(db, author=author)

    response = client.get(f"/api/v1/bounties?tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_tag.id) in ids
    assert str(without_tag.id) not in ids


def test_list_filters_by_author_substring(db, author):
    bounty = _make_bounty(db, author=author)
    needle = author.username[2:6]
    response = client.get(f"/api/v1/bounties?author={needle}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(bounty.id) in ids


def test_list_rejects_author_with_like_meta(author):
    """LIKE-injection vectors (`%`, `\\`, `;`, …) and over-length input
    are rejected at the input boundary so nothing outside
    `[A-Za-z0-9_-]{1,50}` reaches the `ilike(f"%{author}%")` builder."""
    for bad in ("a%", "a\\b", "a;b", "a b", "a'b", "", "a" * 51):
        response = client.get("/api/v1/bounties", params={"author": bad})
        assert response.status_code == 422, (
            f"expected 422 for author={bad!r}, got {response.status_code}"
        )


def test_list_honours_limit(db, author):
    for _ in range(3):
        _make_bounty(db, author=author)
    response = client.get("/api/v1/bounties?limit=2")
    assert response.status_code == 200
    assert len(response.json()) <= 2


def test_list_rejects_out_of_range_limit(author):
    for bad in ("0", "9999", "-1"):
        response = client.get(f"/api/v1/bounties?limit={bad}")
        assert response.status_code == 422, f"expected 422 for limit={bad!r}"


def test_list_carries_claimer_aggregates(db, author, second_user, third_user):
    """The list response gives every card a count + a small avatar sample
    without N+1. The detail endpoint serves the full claimers list."""
    bounty = _make_bounty(db, author=author)
    db.add(GeolocationClaim(geolocation_id=bounty.id, user_id=second_user.id))
    db.add(GeolocationClaim(geolocation_id=bounty.id, user_id=third_user.id))
    db.commit()
    try:
        response = client.get("/api/v1/bounties")
        assert response.status_code == 200
        row = next(r for r in response.json() if r["id"] == str(bounty.id))
        assert row["claimer_count"] == 2
        usernames = {u["username"] for u in row["claimer_sample"]}
        assert usernames == {second_user.username, third_user.username}
    finally:
        db.query(GeolocationClaim).filter(GeolocationClaim.geolocation_id == bounty.id).delete(
            synchronize_session=False
        )
        db.commit()


# ── GET /bounties/{id} — detail ───────────────────────────────────────────


def test_detail_returns_full_shape(db, author, free_tag):
    bounty = _make_bounty(db, author=author, tags=[free_tag])
    response = client.get(f"/api/v1/bounties/{bounty.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(bounty.id)
    assert body["title"] == bounty.title
    assert body["source_url"] == bounty.source_url
    assert body["status"] == STATUS_REQUESTED
    assert body["author"]["username"] == author.username
    assert any(tag["name"] == free_tag.name for tag in body["tags"])
    assert len(body["media"]) == 1
    assert body["claimers"] == []


def test_detail_404_for_unknown_id():
    response = client.get(f"/api/v1/bounties/{uuid.uuid4()}")
    assert response.status_code == 404


def test_detail_404_for_soft_deleted(db, author):
    bounty = _make_bounty(db, author=author, deleted=True)
    response = client.get(f"/api/v1/bounties/{bounty.id}")
    assert response.status_code == 404


def test_detail_404_for_located_event(db, author):
    """A ``geolocated`` row isn't in the requested view; reading it through the
    bounty router 404s (it lives at ``/geolocations`` now)."""
    located = _make_geolocated(db, author=author)
    response = client.get(f"/api/v1/bounties/{located.id}")
    assert response.status_code == 404


def test_detail_lists_every_claimer(db, author, second_user, third_user):
    bounty = _make_bounty(db, author=author)
    db.add(GeolocationClaim(geolocation_id=bounty.id, user_id=second_user.id))
    db.add(GeolocationClaim(geolocation_id=bounty.id, user_id=third_user.id))
    db.commit()
    try:
        response = client.get(f"/api/v1/bounties/{bounty.id}")
        assert response.status_code == 200
        body = response.json()
        usernames = {c["username"] for c in body["claimers"]}
        assert usernames == {second_user.username, third_user.username}
    finally:
        db.query(GeolocationClaim).filter(GeolocationClaim.geolocation_id == bounty.id).delete(
            synchronize_session=False
        )
        db.commit()


# ── POST /bounties — auth + validation + happy path ───────────────────────


def test_create_requires_authentication():
    response = client.post("/api/v1/bounties")
    assert response.status_code == 401


def test_create_rejects_missing_files(author):
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "x",
            "source_url": "https://example.com",
            "source_posted_at": "2026-05-01T12:00",
        },
    )
    assert response.status_code in (400, 422)


def test_create_rejects_blank_title(author):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "   ",
            "source_url": "https://example.com",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 400
    assert "title" in response.json()["detail"].lower()


def test_create_rejects_blank_source_url(author):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "  ",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 400
    assert "source_url" in response.json()["detail"].lower()


def test_create_rejects_invalid_proof_json(author):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com",
            "source_posted_at": "2026-05-01T12:00",
            "proof": "{not valid",
        },
        files=files,
    )
    assert response.status_code == 400
    assert "proof" in response.json()["detail"].lower()


def test_create_rejects_too_many_files(author):
    """More than ``MAX_FILES_PER_SUBMISSION`` files is rejected before any
    upload — the shared cap the geolocation service already enforced, now
    applied to bounties via ``services/evidence_intake``."""
    # 13 small jpegs > the cap of 12.
    files = [("files", (f"tiny-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(13)]
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "x",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_many_files"


def test_create_rejects_over_length_title(author):
    """A title past the 255-char column width 422s at the Form boundary,
    not at ``db.flush()`` after the files have already hit S3."""
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "a" * 256,
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 422


def test_create_rejects_over_length_source_url(author):
    """source_url past the 2000-char API bound 422s at the Form boundary."""
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com/" + "a" * 2000,
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 422


def test_create_rejects_unsanitisable_proof(author):
    """Valid JSON that isn't a Tiptap ``doc`` is rejected with the typed
    ``invalid_proof`` envelope, before any upload."""
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "proof": '{"type": "not-doc"}',
        },
        files=files,
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_proof"


def test_create_happy_path(db, author, free_tag):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "Footage from a strike",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": f'["{free_tag.id}"]',
        },
        files=files,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_REQUESTED
    assert body["author"]["username"] == author.username
    assert any(t["name"] == free_tag.name for t in body["tags"])
    assert len(body["media"]) == 1
    assert body["claimers"] == []

    bounty_id = uuid.UUID(body["id"])
    # The created row is a requested event with no location and the poster on
    # ``requested_by_id`` — the invariant fulfilment relies on.
    row = db.query(Geolocation).filter(Geolocation.id == bounty_id).one()
    assert row.status == STATUS_REQUESTED
    assert row.location is None
    assert row.requested_by_id == author.id

    db.query(Media).filter(Media.geolocation_id == bounty_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == bounty_id).delete(synchronize_session=False)
    db.commit()


def test_create_event_date_optional_source_required(db, author):
    """event_date is optional on a bounty (omitted → null); source_posted_at is
    required (a post always has a time) and round-trips on the read model."""
    with_dates = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "Dated bounty",
            "source_url": "https://example.com/post/1",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-02T09:30",
        },
        files={"files": _tiny_jpeg()},
    )
    assert with_dates.status_code == 201, with_dates.text
    assert with_dates.json()["event_date"] == "2026-05-01"
    assert with_dates.json()["source_posted_at"].startswith("2026-05-02T09:30")

    without = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "Undated bounty",
            "source_url": "https://example.com/post/2",
            "source_posted_at": "2026-05-02T09:30",
        },
        files={"files": _tiny_jpeg()},
    )
    assert without.status_code == 201, without.text
    assert without.json()["event_date"] is None
    assert without.json()["source_posted_at"].startswith("2026-05-02T09:30")

    for created in (with_dates.json(), without.json()):
        bid = uuid.UUID(created["id"])
        db.query(Media).filter(Media.geolocation_id == bid).delete(synchronize_session=False)
        db.query(Geolocation).filter(Geolocation.id == bid).delete(synchronize_session=False)
    db.commit()


def test_create_strips_inline_images_from_proof(db, author):
    """A bounty's proof is image-free: an inline image that would otherwise
    pass sanitisation is dropped (it has no ``proof_images`` row to anchor it,
    so it would orphan) while the surrounding text survives."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Lead on the depot."}],
            },
            {"type": "image", "attrs": {"src": "/uploads/x.png"}},
        ],
    }
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "Image in proof",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
            "proof": json.dumps(doc),
        },
        files={"files": _tiny_jpeg()},
    )
    assert response.status_code == 201, response.text
    stored = response.json()["proof"]
    node_types = [node["type"] for node in stored["content"]]
    assert "image" not in node_types
    assert stored["content"] == [
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": "Lead on the depot."}],
        }
    ]

    bid = uuid.UUID(response.json()["id"])
    db.query(Media).filter(Media.geolocation_id == bid).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == bid).delete(synchronize_session=False)
    db.commit()


def test_create_rejects_invalid_event_date(author):
    """Garbage ``event_date`` → 422 before any S3 round-trip."""
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "x",
            "source_url": "https://example.com/post/1",
            "event_date": "not-a-date",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"files": _tiny_jpeg()},
    )
    assert response.status_code == 422
    assert "event_date" in response.json()["detail"].lower()


def test_create_populates_sha256_on_media(db, author):
    """SHA-256 hash of the uploaded bytes lands on the row + read API.

    Independent recomputation should match — that's the whole pitch:
    given the API response, an auditor can prove the bytes on S3 still
    match what the analyst submitted.
    """
    # The EXIF strip re-encodes, so the post-strip sha256 isn't known ahead of
    # time; assert API-response hash == row hash (internal consistency).
    # End-to-end auditor-replay needs a real S3 fetch — out of scope here.
    payload = TINY_JPEG

    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "hash test",
            "source_url": "https://example.com/post/1",
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"files": ("tiny.jpg", payload, "image/jpeg")},
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

    # Provenance fields landed on the row.
    assert row.original_filename == "tiny.jpg"
    # IP comes from TestClient ('testclient' isn't a parseable IP) →
    # NULL is the correct fail-safe (see services/audit.py docstring).
    assert row.uploaded_ip is None
    # UA from httpx's default TestClient — non-empty.
    assert row.uploaded_user_agent is not None

    bounty_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.geolocation_id == bounty_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == bounty_id).delete(synchronize_session=False)
    db.commit()


# ── DELETE /bounties/{id} ─────────────────────────────────────────────────


def test_delete_requires_authentication(db, author):
    bounty = _make_bounty(db, author=author)
    response = client.delete(f"/api/v1/bounties/{bounty.id}")
    assert response.status_code == 401


def test_delete_returns_404_for_unknown_id(author):
    response = client.delete(f"/api/v1/bounties/{uuid.uuid4()}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_404_for_soft_deleted(db, author):
    bounty = _make_bounty(db, author=author, deleted=True)
    response = client.delete(f"/api/v1/bounties/{bounty.id}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_403_when_not_author(db, author, second_user):
    bounty = _make_bounty(db, author=author)
    response = client.delete(f"/api/v1/bounties/{bounty.id}", headers=login_as(client, second_user))
    assert response.status_code == 403


def test_delete_succeeds_for_author_and_cascades_media(db, author):
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    response = client.delete(f"/api/v1/bounties/{bounty_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == bounty_id).first() is None
    assert db.query(Media).filter(Media.geolocation_id == bounty_id).count() == 0


def test_delete_no_longer_blocked_by_a_later_geolocation(db, author, second_user):
    """The old 409-on-delete guard is gone. Fulfilment no longer copies the
    request into a separate geolocation (it transitions the same row in place),
    so there is no promotion trace to protect: an unrelated later located event
    doesn't block deleting a still-open request. Deleting the request succeeds.
    """
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    # An independent located event by another analyst — no relationship to the
    # request now that the promotion apparatus is gone.
    _make_geolocated(db, author=second_user)

    response = client.delete(f"/api/v1/bounties/{bounty_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == bounty_id).first() is None


# ── POST /bounties/{id}/claim ─────────────────────────────────────────────


def test_claim_requires_authentication(db, author):
    bounty = _make_bounty(db, author=author)
    response = client.post(f"/api/v1/bounties/{bounty.id}/claim")
    assert response.status_code == 401


def test_claim_inserts_row(db, author, second_user):
    bounty = _make_bounty(db, author=author)
    response = client.post(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    assert response.status_code == 204
    db.expire_all()
    claims = db.query(GeolocationClaim).filter(GeolocationClaim.geolocation_id == bounty.id).all()
    assert len(claims) == 1
    assert claims[0].user_id == second_user.id


def test_claim_is_idempotent(db, author, second_user):
    bounty = _make_bounty(db, author=author)
    for _ in range(3):
        response = client.post(
            f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
        )
        assert response.status_code == 204
    db.expire_all()
    assert (
        db.query(GeolocationClaim)
        .filter(
            GeolocationClaim.geolocation_id == bounty.id,
            GeolocationClaim.user_id == second_user.id,
        )
        .count()
        == 1
    )


def test_multiple_analysts_can_claim_same_bounty(db, author, second_user, third_user):
    """The core multi-claim contract — two analysts both signaling."""
    bounty = _make_bounty(db, author=author)
    r1 = client.post(f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user))
    r2 = client.post(f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, third_user))
    assert r1.status_code == 204
    assert r2.status_code == 204
    db.expire_all()
    user_ids = {
        c.user_id
        for c in db.query(GeolocationClaim)
        .filter(GeolocationClaim.geolocation_id == bounty.id)
        .all()
    }
    assert user_ids == {second_user.id, third_user.id}


def test_claim_rejected_on_non_open_status(db, author, second_user):
    bounty = _make_bounty(db, author=author, status=STATUS_CLOSED)
    response = client.post(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    assert response.status_code == 409


def test_claim_404_for_soft_deleted(db, author, second_user):
    bounty = _make_bounty(db, author=author, deleted=True)
    response = client.post(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    assert response.status_code == 404


# ── DELETE /bounties/{id}/claim ───────────────────────────────────────────


def test_unclaim_removes_row(db, author, second_user):
    bounty = _make_bounty(db, author=author)
    db.add(GeolocationClaim(geolocation_id=bounty.id, user_id=second_user.id))
    db.commit()

    response = client.delete(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    assert response.status_code == 204
    db.expire_all()
    assert (
        db.query(GeolocationClaim)
        .filter(
            GeolocationClaim.geolocation_id == bounty.id,
            GeolocationClaim.user_id == second_user.id,
        )
        .count()
        == 0
    )


def test_unclaim_is_noop_when_not_a_claimer(db, author, second_user):
    """Unclaiming when you weren't claiming is still a 204 — the user-
    observable post-condition (caller not in the working set) is what
    we promise, not "exactly one row was deleted." """
    bounty = _make_bounty(db, author=author)
    response = client.delete(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    assert response.status_code == 204


# ── POST /bounties/{id}/close ─────────────────────────────────────────────


def test_close_author_only(db, author, second_user):
    bounty = _make_bounty(db, author=author)
    response = client.post(
        f"/api/v1/bounties/{bounty.id}/close", headers=login_as(client, second_user)
    )
    assert response.status_code == 403


def test_close_transitions_to_closed(db, author):
    bounty = _make_bounty(db, author=author)
    response = client.post(f"/api/v1/bounties/{bounty.id}/close", headers=login_as(client, author))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == STATUS_CLOSED
    assert body["closed_at"] is not None


def test_close_rejected_on_terminal_state(db, author):
    """An already-closed request can't be re-closed (terminal state) — 409."""
    bounty = _make_bounty(db, author=author, status=STATUS_CLOSED)
    response = client.post(f"/api/v1/bounties/{bounty.id}/close", headers=login_as(client, author))
    assert response.status_code == 409


# ── POST /geolocations/{id}/submit — fulfilment in place ──────────────────
# Since the merge, fulfilling a bounty is not a row copy: the requested event is
# transitioned in place to ``geolocated`` by the submit endpoint. Any authed user
# may answer an open request; ``author_id`` transfers to the fulfiller while
# ``requested_by`` keeps the original poster.


def _make_geolocated(db, *, author: User) -> Geolocation:
    """A directly-submitted ``geolocated`` event (has a location). Helper for the
    "located events don't show in the requested view" assertions."""
    from geoalchemy2.shape import from_shape
    from shapely.geometry import Point

    geo = Geolocation(
        author_id=author.id,
        title=f"Located {uuid.uuid4().hex[:8]}",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/located",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_GEOLOCATED,
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)
    return geo


def _submit_fulfilment(client, bounty_id, fulfiller, *tags, **overrides):
    """POST the submit form that fulfils a requested event. The request already
    carries media (a bounty requires it), so no new files are needed."""
    data = {
        "title": "Fulfilled from a request",
        "lat": "48.5",
        "lng": "34.5",
        "source_url": "https://example.com/post",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "tag_ids": _required_tag_ids(*tags),
    }
    data.update(overrides)
    return client.post(
        f"/api/v1/geolocations/{bounty_id}/submit",
        headers=login_as(client, fulfiller),
        data=data,
    )


def test_submit_fulfils_requested_and_transfers_ownership(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """The end-to-end promise: another analyst answers an open request, the row
    transitions to ``geolocated`` in place, ``author_id`` moves to the fulfiller,
    and ``requested_by`` keeps the original poster."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id

    response = _submit_fulfilment(client, bounty_id, second_user, conflict_tag, capture_source_tag)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(bounty_id)
    assert body["status"] == "geolocated"
    assert body["lat"] == 48.5
    assert body["lng"] == 34.5
    # Ownership transferred to the fulfiller; the poster stays on requested_by.
    assert body["author"]["username"] == second_user.username
    assert body["requested_by"]["username"] == author.username

    db.expire_all()
    row = db.query(Geolocation).filter(Geolocation.id == bounty_id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.author_id == second_user.id
    assert row.requested_by_id == author.id
    assert row.location is not None


def test_submit_fulfilled_event_leaves_requested_view(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """Once fulfilled the row is ``geolocated``, so it drops off the bounty
    (requested) surface and appears on ``/geolocations`` instead."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id

    assert (
        _submit_fulfilment(client, bounty_id, second_user, conflict_tag, capture_source_tag)
    ).status_code == 200

    # Gone from the requested-view detail + list.
    assert client.get(f"/api/v1/bounties/{bounty_id}").status_code == 404
    assert all(row["id"] != str(bounty_id) for row in client.get("/api/v1/bounties").json())
    # Present on the located surface.
    located = client.get(f"/api/v1/geolocations/{bounty_id}")
    assert located.status_code == 200
    assert located.json()["status"] == "geolocated"


def test_submit_fulfilment_reuses_existing_media(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """Fulfilment keeps the request's media on the same row (no transfer / churn):
    the bounty's one media survives the transition without any new upload."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    media_id = db.query(Media.id).filter(Media.geolocation_id == bounty_id).scalar()

    assert (
        _submit_fulfilment(client, bounty_id, second_user, conflict_tag, capture_source_tag)
    ).status_code == 200

    db.expire_all()
    medias = db.query(Media).filter(Media.geolocation_id == bounty_id).all()
    assert [m.id for m in medias] == [media_id]


def test_submit_fulfilment_accepts_extra_files(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """The submit form may add media on top of what the request carries; the new
    upload lands alongside the request's existing media on the same row."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    existing_media_id = db.query(Media.id).filter(Media.geolocation_id == bounty_id).scalar()

    response = client.post(
        f"/api/v1/geolocations/{bounty_id}/submit",
        headers=login_as(client, second_user),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com/post",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": _required_tag_ids(conflict_tag, capture_source_tag),
        },
        files=[("files", _tiny_jpeg())],
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    medias = db.query(Media).filter(Media.geolocation_id == bounty_id).all()
    # One kept from the request + one fresh upload = two total.
    assert len(medias) == 2
    assert existing_media_id in {m.id for m in medias}


def test_submit_fulfilment_honors_analyst_title_and_tags(
    db, author, second_user, free_tag, conflict_tag, capture_source_tag
):
    """The fulfilling analyst CAN refine the title and tags — they know more than
    the poster did (place name resolved, conflict tag added). The refined values
    land on the row; the required conflict + capture_source floor is enforced."""
    bounty = _make_bounty(db, author=author, title="Original bounty title", tags=[free_tag])
    bounty_id = bounty.id

    response = _submit_fulfilment(
        client,
        bounty_id,
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


def test_submit_fulfilment_blocked_without_required_tags(db, author, second_user):
    """The submit floor still applies to fulfilment: a requested row without the
    conflict + capture_source tags 400s (the request itself may be tagless)."""
    bounty = _make_bounty(db, author=author)
    response = client.post(
        f"/api/v1/geolocations/{bounty.id}/submit",
        headers=login_as(client, second_user),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com/post",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_submit_fulfilment_rejected_when_closed(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """A withdrawn (``closed``) request is terminal, not answerable — submit 409s
    with the invalid_state code (only ``requested`` / ``detected`` transition)."""
    bounty = _make_bounty(db, author=author, status=STATUS_CLOSED)
    response = _submit_fulfilment(client, bounty.id, second_user, conflict_tag, capture_source_tag)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_submit_fulfilment_404_for_unknown(author, conflict_tag, capture_source_tag):
    response = _submit_fulfilment(client, uuid.uuid4(), author, conflict_tag, capture_source_tag)
    assert response.status_code == 404
