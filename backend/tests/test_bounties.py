"""End-to-end tests for `/bounties`.

Scope: public read surface (list, detail) + the author-side mutation
contract (create, delete, close) + the multi-analyst claim signal +
the fulfilment flow that promotes a bounty into a geolocation. Local
storage backend so file uploads exercise the real path without S3.

What we lock in:

* Soft-delete invariant — every public read filters ``deleted_at IS NULL``.
* List filters honour status / tag / author contracts.
* List response carries ``claimer_count`` + a small ``claimer_sample``.
* ``POST /bounties`` rejects empty title / source_url / files; auth
  required; bounty is created with status=open.
* ``DELETE /bounties/{id}`` author-only; 404 for unknown / soft-deleted;
  409 when a geolocation already traces back to the row.
* ``POST /bounties/{id}/claim`` is idempotent, multi-analyst (no single-
  claimer reservation), rejected on non-open status. ``DELETE`` is a
  no-op when the caller wasn't a claimer.
* ``POST /bounties/{id}/close`` author-only; rejects already-terminal
  states; transitions to ``closed`` + stamps ``closed_at``.
* ``POST /geolocations`` with ``bounty_id`` transfers the bounty's media
  rows in place (no S3 churn), sets ``originated_from_bounty_id`` on
  the new geo, and flips the bounty to ``fulfilled``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.main import app
from app.models.bounty import (
    STATUS_CLOSED,
    STATUS_FULFILLED,
    STATUS_OPEN,
    Bounty,
    BountyClaim,
)
from app.models.geolocation import Geolocation
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
    # Manual cascade: bounties → media + bounty_claims (handled by FK CASCADE); then user.
    db.query(Bounty).filter(Bounty.author_id == user_id).delete(synchronize_session=False)
    db.query(BountyClaim).filter(BountyClaim.user_id == user_id).delete(synchronize_session=False)
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
    db.query(Bounty).filter(Bounty.author_id == user_id).delete(synchronize_session=False)
    db.query(BountyClaim).filter(BountyClaim.user_id == user_id).delete(synchronize_session=False)
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
    db.query(BountyClaim).filter(BountyClaim.user_id == user_id).delete(synchronize_session=False)
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


# `POST /geolocations` requires one conflict + one capture_source tag.
# The bounty-fulfilment path is no exception (tags come from the form's
# `tag_ids`), so the 201-expecting fulfilment tests below thread both
# through this helper.
def _required_tag_ids(*tags: Tag) -> str:
    import json as _json

    return _json.dumps([str(t.id) for t in tags])


def _make_bounty(
    db,
    *,
    author: User,
    title: str | None = None,
    source_url: str = "https://example.com/post",
    status: str = STATUS_OPEN,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    with_media: bool = True,
) -> Bounty:
    bounty = Bounty(
        author_id=author.id,
        title=title or f"Bounty {uuid.uuid4().hex[:8]}",
        source_url=source_url,
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
                bounty_id=bounty.id,
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
    open_one = _make_bounty(db, author=author, status=STATUS_OPEN)
    closed = _make_bounty(db, author=author, status=STATUS_CLOSED)

    response = client.get(f"/api/v1/bounties?status={STATUS_OPEN}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(open_one.id) in ids
    assert str(closed.id) not in ids


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
    db.add(BountyClaim(bounty_id=bounty.id, user_id=second_user.id))
    db.add(BountyClaim(bounty_id=bounty.id, user_id=third_user.id))
    db.commit()
    try:
        response = client.get("/api/v1/bounties")
        assert response.status_code == 200
        row = next(r for r in response.json() if r["id"] == str(bounty.id))
        assert row["claimer_count"] == 2
        usernames = {u["username"] for u in row["claimer_sample"]}
        assert usernames == {second_user.username, third_user.username}
    finally:
        db.query(BountyClaim).filter(BountyClaim.bounty_id == bounty.id).delete(
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
    assert body["status"] == STATUS_OPEN
    assert body["author"]["username"] == author.username
    assert any(tag["name"] == free_tag.name for tag in body["tags"])
    assert len(body["media"]) == 1
    assert body["claimers"] == []
    assert body["fulfilled_by"] is None


def test_detail_404_for_unknown_id():
    response = client.get(f"/api/v1/bounties/{uuid.uuid4()}")
    assert response.status_code == 404


def test_detail_404_for_soft_deleted(db, author):
    bounty = _make_bounty(db, author=author, deleted=True)
    response = client.get(f"/api/v1/bounties/{bounty.id}")
    assert response.status_code == 404


def test_detail_lists_every_claimer(db, author, second_user, third_user):
    bounty = _make_bounty(db, author=author)
    db.add(BountyClaim(bounty_id=bounty.id, user_id=second_user.id))
    db.add(BountyClaim(bounty_id=bounty.id, user_id=third_user.id))
    db.commit()
    try:
        response = client.get(f"/api/v1/bounties/{bounty.id}")
        assert response.status_code == 200
        body = response.json()
        usernames = {c["username"] for c in body["claimers"]}
        assert usernames == {second_user.username, third_user.username}
    finally:
        db.query(BountyClaim).filter(BountyClaim.bounty_id == bounty.id).delete(
            synchronize_session=False
        )
        db.commit()


def test_detail_reflects_fulfilled_geolocation(db, author):
    bounty = _make_bounty(db, author=author)
    geo = Geolocation(
        author_id=author.id,
        title="Promoted",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url=bounty.source_url,
        event_date=date(2026, 5, 1),
        originated_from_bounty_id=bounty.id,
    )
    db.add(geo)
    db.commit()
    try:
        response = client.get(f"/api/v1/bounties/{bounty.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["fulfilled_by"] is not None
        assert body["fulfilled_by"]["id"] == str(geo.id)
        assert body["fulfilled_by"]["title"] == "Promoted"
    finally:
        db.expire_all()
        db.query(Geolocation).filter(Geolocation.id == geo.id).delete(synchronize_session=False)
        db.commit()


# ── POST /bounties — auth + validation + happy path ───────────────────────


def test_create_requires_authentication():
    response = client.post("/api/v1/bounties")
    assert response.status_code == 401


def test_create_rejects_missing_files(author):
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={"title": "x", "source_url": "https://example.com"},
    )
    assert response.status_code in (400, 422)


def test_create_rejects_blank_title(author):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={"title": "   ", "source_url": "https://example.com"},
        files=files,
    )
    assert response.status_code == 400
    assert "title" in response.json()["detail"].lower()


def test_create_rejects_blank_source_url(author):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={"title": "ok", "source_url": "  "},
        files=files,
    )
    assert response.status_code == 400
    assert "source_url" in response.json()["detail"].lower()


def test_create_rejects_invalid_description_json(author):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "ok",
            "source_url": "https://example.com",
            "description": "{not valid",
        },
        files=files,
    )
    assert response.status_code == 400
    assert "description" in response.json()["detail"].lower()


def test_create_happy_path(db, author, free_tag):
    files = {"files": _tiny_jpeg()}
    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "Footage from a strike",
            "source_url": "https://example.com/post/1",
            "tag_ids": f'["{free_tag.id}"]',
        },
        files=files,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_OPEN
    assert body["author"]["username"] == author.username
    assert any(t["name"] == free_tag.name for t in body["tags"])
    assert len(body["media"]) == 1
    assert body["claimers"] == []

    bounty_id = uuid.UUID(body["id"])
    db.query(Media).filter(Media.bounty_id == bounty_id).delete(synchronize_session=False)
    db.query(Bounty).filter(Bounty.id == bounty_id).delete(synchronize_session=False)
    db.commit()


def test_create_populates_sha256_on_media(db, author):
    """SHA-256 hash of the uploaded bytes lands on the row + read API.

    Independent recomputation should match — that's the whole pitch:
    given the API response, an auditor can prove the bytes on S3 still
    match what the analyst submitted.
    """
    # We don't know the post-EXIF-strip sha256 ahead of time (the
    # strip re-encodes), so the test compares the API response hash
    # against the row hash for internal consistency. End-to-end
    # auditor-replay (download URL, recompute) requires a real S3
    # fetch and is out of scope for this unit-flavoured test.
    payload = TINY_JPEG

    response = client.post(
        "/api/v1/bounties",
        headers=login_as(client, author),
        data={
            "title": "hash test",
            "source_url": "https://example.com/post/1",
        },
        files={"files": ("tiny.jpg", payload, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["media"]) == 1
    media = body["media"][0]
    assert isinstance(media["sha256"], str)
    assert len(media["sha256"]) == 64
    # The strip recompresses, so we can't predict the hash. What we
    # CAN verify is internal consistency: the API response hash
    # matches the row hash matches an independent re-hash of the
    # response storage_url's content (skipped here — needs a real S3
    # fetch). The row check below is the load-bearing assertion.
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
    db.query(Media).filter(Media.bounty_id == bounty_id).delete(synchronize_session=False)
    db.query(Bounty).filter(Bounty.id == bounty_id).delete(synchronize_session=False)
    db.commit()


# ── DELETE /bounties/{id} ─────────────────────────────────────────────────


def test_delete_requires_authentication(db, author):
    bounty = _make_bounty(db, author=author)
    response = client.delete(f"/api/v1/bounties/{bounty.id}")
    assert response.status_code == 401


def test_delete_returns_404_for_unknown_id(author):
    response = client.delete(
        f"/api/v1/bounties/{uuid.uuid4()}", headers=login_as(client, author)
    )
    assert response.status_code == 404


def test_delete_returns_404_for_soft_deleted(db, author):
    bounty = _make_bounty(db, author=author, deleted=True)
    response = client.delete(f"/api/v1/bounties/{bounty.id}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_403_when_not_author(db, author, second_user):
    bounty = _make_bounty(db, author=author)
    response = client.delete(
        f"/api/v1/bounties/{bounty.id}", headers=login_as(client, second_user)
    )
    assert response.status_code == 403


def test_delete_succeeds_for_author_and_cascades_media(db, author):
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    response = client.delete(f"/api/v1/bounties/{bounty_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Bounty).filter(Bounty.id == bounty_id).first() is None
    assert db.query(Media).filter(Media.bounty_id == bounty_id).count() == 0


def test_delete_returns_409_when_fulfilled(db, author):
    bounty = _make_bounty(db, author=author)
    geo = Geolocation(
        author_id=author.id,
        title="Promoted",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url=bounty.source_url,
        event_date=date(2026, 5, 1),
        originated_from_bounty_id=bounty.id,
    )
    db.add(geo)
    db.commit()
    try:
        response = client.delete(
            f"/api/v1/bounties/{bounty.id}", headers=login_as(client, author)
        )
        assert response.status_code == 409
    finally:
        db.expire_all()
        db.query(Geolocation).filter(Geolocation.id == geo.id).delete(synchronize_session=False)
        db.commit()


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
    claims = db.query(BountyClaim).filter(BountyClaim.bounty_id == bounty.id).all()
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
        db.query(BountyClaim)
        .filter(BountyClaim.bounty_id == bounty.id, BountyClaim.user_id == second_user.id)
        .count()
        == 1
    )


def test_multiple_analysts_can_claim_same_bounty(db, author, second_user, third_user):
    """The core multi-claim contract — two analysts both signaling."""
    bounty = _make_bounty(db, author=author)
    r1 = client.post(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    r2 = client.post(f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, third_user))
    assert r1.status_code == 204
    assert r2.status_code == 204
    db.expire_all()
    user_ids = {
        c.user_id for c in db.query(BountyClaim).filter(BountyClaim.bounty_id == bounty.id).all()
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
    db.add(BountyClaim(bounty_id=bounty.id, user_id=second_user.id))
    db.commit()

    response = client.delete(
        f"/api/v1/bounties/{bounty.id}/claim", headers=login_as(client, second_user)
    )
    assert response.status_code == 204
    db.expire_all()
    assert (
        db.query(BountyClaim)
        .filter(BountyClaim.bounty_id == bounty.id, BountyClaim.user_id == second_user.id)
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
    response = client.post(
        f"/api/v1/bounties/{bounty.id}/close", headers=login_as(client, author)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == STATUS_CLOSED
    assert body["closed_at"] is not None


def test_close_rejected_on_terminal_state(db, author):
    bounty = _make_bounty(db, author=author, status=STATUS_FULFILLED)
    response = client.post(
        f"/api/v1/bounties/{bounty.id}/close", headers=login_as(client, author)
    )
    assert response.status_code == 409


# ── POST /geolocations bounty_id=… ────────────────────────────────────────


def test_geolocate_from_bounty_transfers_media_and_fulfills(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """The end-to-end slice-2 promise: another analyst submits a
    geolocation from a bounty, the bounty's media moves over to the
    new row in place, and the bounty flips to fulfilled."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    media_id = db.query(Media.id).filter(Media.bounty_id == bounty_id).scalar()

    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, second_user),
        data={
            "title": "Promoted from bounty",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": bounty.source_url,
            "event_date": "2026-05-01",
            "bounty_id": str(bounty_id),
            "tag_ids": _required_tag_ids(conflict_tag, capture_source_tag),
        },
        # No files — the bounty's existing media transfers in.
    )
    assert response.status_code == 201, response.text
    body = response.json()
    geo_id = uuid.UUID(body["id"])

    db.expire_all()
    # Bounty flipped to fulfilled, closed_at stamped.
    reloaded = db.query(Bounty).filter(Bounty.id == bounty_id).one()
    assert reloaded.status == STATUS_FULFILLED
    assert reloaded.closed_at is not None
    # New geo carries the trace.
    geo = db.query(Geolocation).filter(Geolocation.id == geo_id).one()
    assert geo.originated_from_bounty_id == bounty_id
    # Media row moved over in place: same media id, now owned by the geo.
    moved = db.query(Media).filter(Media.id == media_id).one()
    assert moved.geolocation_id == geo_id
    assert moved.bounty_id is None

    # Cleanup
    db.query(Media).filter(Media.geolocation_id == geo_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
    db.commit()


def test_geolocate_from_bounty_rejected_when_bounty_not_open(db, author, second_user):
    bounty = _make_bounty(db, author=author, status=STATUS_CLOSED)
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, second_user),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "bounty_id": str(bounty.id),
        },
    )
    assert response.status_code == 409


def test_geolocate_from_bounty_404_for_unknown(author):
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "bounty_id": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 404


def test_geolocate_without_bounty_still_requires_media(author):
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
        },
    )
    assert response.status_code == 400
    assert "media" in response.json()["detail"].lower()


# ── Hardening: trust the bounty, never the form ───────────────────────────


def test_geolocate_from_bounty_overrides_form_source_url(
    db, author, second_user, free_tag, conflict_tag, capture_source_tag
):
    """The fulfilling analyst cannot swap the bounty's source URL. The
    bounty's ``source_url`` is the evidence link the bounty was opened
    against; if the fulfilling analyst could swap it, they could
    "fulfill" the bounty with proof from an unrelated event. The
    frontend renders this field locked, and the API enforces the same
    so a hostile caller can't bypass the UI lock."""
    bounty = _make_bounty(
        db,
        author=author,
        title="Real bounty title",
        source_url="https://real-source.example.com/post",
        tags=[free_tag],
    )

    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, second_user),
        data={
            "title": "Analyst-refined title",
            # Hostile source_url — must be ignored server-side.
            "source_url": "https://evil.example.com/redirect",
            "lat": "48.5",
            "lng": "34.5",
            "event_date": "2026-05-01",
            "bounty_id": str(bounty.id),
            "tag_ids": _required_tag_ids(conflict_tag, capture_source_tag),
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source_url"] == "https://real-source.example.com/post"
    geo_id = uuid.UUID(body["id"])

    # Cleanup
    db.query(Media).filter(Media.geolocation_id == geo_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
    db.commit()


def test_geolocate_from_bounty_honors_analyst_title_and_tags(
    db, author, second_user, free_tag, conflict_tag, capture_source_tag
):
    """The fulfilling analyst CAN refine the title and tags. They know
    more than the bounty author did at posting time (place name resolved,
    conflict tag added, etc.). The bounty's own title/tags remain on the
    bounty row, so the bounty page stays accurate too. Moderation sees
    bad-faith refinements via the ``originated_from_bounty`` trace on
    the geolocation."""
    other_tag = Tag(name=f"other-{uuid.uuid4().hex[:8]}", category="free")
    db.add(other_tag)
    db.commit()
    other_tag_id = other_tag.id

    bounty = _make_bounty(
        db,
        author=author,
        title="Original bounty title",
        tags=[free_tag],
    )

    try:
        import json as _json

        response = client.post(
            "/api/v1/geolocations",
            headers=login_as(client, second_user),
            data={
                "title": "Refined title with place name",
                "lat": "48.5",
                "lng": "34.5",
                "source_url": "https://example.com",
                "event_date": "2026-05-01",
                "bounty_id": str(bounty.id),
                # Analyst attaches a tag that wasn't on the bounty AND
                # drops the bounty's original tag — both moves are allowed.
                # Required conflict + capture_source tags ride along.
                "tag_ids": _json.dumps(
                    [str(other_tag_id), str(conflict_tag.id), str(capture_source_tag.id)]
                ),
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["title"] == "Refined title with place name"
        tag_names = {t["name"] for t in body["tags"]}
        assert other_tag.name in tag_names
        assert free_tag.name not in tag_names

        # Bounty row itself is unchanged — the bounty page stays accurate.
        db.expire_all()
        reloaded = db.query(Bounty).filter(Bounty.id == bounty.id).one()
        assert reloaded.title == "Original bounty title"
        bounty_tag_names = {t.name for t in reloaded.tags}
        assert free_tag.name in bounty_tag_names

        geo_id = uuid.UUID(body["id"])
        db.query(Media).filter(Media.geolocation_id == geo_id).delete(synchronize_session=False)
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id == other_tag_id))
        db.commit()


def test_partial_unique_index_blocks_double_fulfilment(db, author, second_user):
    """Fix #2 — even if the application-level row lock + status guard
    were somehow bypassed (future refactor forgets the lock, races on a
    replica, etc), the partial unique index on
    ``originated_from_bounty_id`` makes a duplicate fulfilment a DB
    constraint violation, not a silent doubling."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id

    # First geo: legitimately fulfils the bounty (we just write the row
    # directly to keep the test focused on the constraint, not the route).
    geo_a = Geolocation(
        author_id=second_user.id,
        title="first",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        event_date=date(2026, 5, 1),
        originated_from_bounty_id=bounty_id,
    )
    db.add(geo_a)
    db.commit()
    geo_a_id = geo_a.id

    # Second geo with the same bounty pointer must fail at commit.
    geo_b = Geolocation(
        author_id=second_user.id,
        title="second",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        event_date=date(2026, 5, 1),
        originated_from_bounty_id=bounty_id,
    )
    db.add(geo_b)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    # Cleanup
    db.query(Geolocation).filter(Geolocation.id == geo_a_id).delete(synchronize_session=False)
    db.commit()


def test_fulfilled_by_excludes_soft_deleted_geolocation(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """Fix #4 — once a fulfilment geolocation is admin-soft-deleted, the
    ``fulfilled_by`` relationship must hide it instead of surfacing a
    row that's supposed to be invisible. The partial unique index keeps
    ``uselist=False`` safe (no chance of two live geos colliding here)."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id

    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, second_user),
        data={
            "title": "fulfiller",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": bounty.source_url,
            "event_date": "2026-05-01",
            "bounty_id": str(bounty_id),
            "tag_ids": _required_tag_ids(conflict_tag, capture_source_tag),
        },
    )
    assert response.status_code == 201
    geo_id = uuid.UUID(response.json()["id"])

    # Pre-condition: bounty's detail surfaces the fulfilling geo.
    pre = client.get(f"/api/v1/bounties/{bounty_id}")
    assert pre.status_code == 200
    assert pre.json()["fulfilled_by"] is not None
    assert pre.json()["fulfilled_by"]["id"] == str(geo_id)

    # Soft-delete the geo directly (admin path stamps deleted_at).
    db.query(Geolocation).filter(Geolocation.id == geo_id).update(
        {Geolocation.deleted_at: datetime.now(UTC)},
        synchronize_session=False,
    )
    db.commit()

    # Post-condition: detail no longer leaks the soft-deleted row.
    post = client.get(f"/api/v1/bounties/{bounty_id}")
    assert post.status_code == 200
    assert post.json()["fulfilled_by"] is None

    # Cleanup
    db.query(Media).filter(Media.geolocation_id == geo_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
    db.commit()


def test_geolocate_from_bounty_accepts_extra_files(
    db, author, second_user, conflict_tag, capture_source_tag
):
    """The form may include additional media on top of what the bounty
    carries — those files should land alongside the transferred bounty
    media on the resulting geolocation."""
    bounty = _make_bounty(db, author=author)
    bounty_id = bounty.id
    bounty_media_id = db.query(Media.id).filter(Media.bounty_id == bounty_id).scalar()

    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, second_user),
        data={
            "title": "x",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": bounty.source_url,
            "event_date": "2026-05-01",
            "bounty_id": str(bounty_id),
            "tag_ids": _required_tag_ids(conflict_tag, capture_source_tag),
        },
        files=[("files", _tiny_jpeg())],
    )
    assert response.status_code == 201, response.text
    geo_id = uuid.UUID(response.json()["id"])

    db.expire_all()
    medias = db.query(Media).filter(Media.geolocation_id == geo_id).all()
    # One transferred from the bounty + one fresh upload = two total.
    assert len(medias) == 2
    transferred_ids = {m.id for m in medias if m.id == bounty_media_id}
    assert transferred_ids == {bounty_media_id}

    # Cleanup
    db.query(Media).filter(Media.geolocation_id == geo_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
    db.commit()
