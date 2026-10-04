"""End-to-end tests for ``GET /search``.

The "requests" group is a view over the events table (``status = 'requested'``, no
location); the located view filters ``location IS NOT NULL``, so the two never overlap.
Each test seeds rows with a unique token so matches stay bounded to its own data.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.collection import Collection, CollectionEvent
from app.models.event import STATUS_DETECTED, STATUS_REQUESTED, Event
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from app.services.search import HIGHLIGHT_START, HIGHLIGHT_STOP
from tests._fixtures import collection_description
from tests.conftest import login_as

client = TestClient(app)


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
def caller(db):
    """Owner of the seeded rows; the unique username keeps it out of results."""
    user = User(
        username=f"caller{uuid.uuid4().hex[:8]}",
        email=f"caller-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _unique_token() -> str:
    """A token unique enough to isolate a test from other rows in the dev DB."""
    return f"vidqterm{uuid.uuid4().hex[:10]}"


def test_search_is_anonymous():
    """No session required."""
    response = client.get("/api/v1/search?q=anything")
    assert response.status_code == 200


def test_empty_query_returns_empty_groups(caller):
    response = client.get("/api/v1/search?q=&type=all", headers=login_as(client, caller))
    assert response.status_code == 200
    body = response.json()
    assert body["geolocations"] == []
    assert body["requests"] == []
    assert body["users"] == []
    assert body["collections"] == []
    assert body["total"] == {"geolocations": 0, "requests": 0, "collections": 0, "users": 0}
    assert body["query"] == ""
    assert body["type"] == "all"


def test_whitespace_only_query_returns_empty_groups(caller):
    response = client.get("/api/v1/search?q=%20%20%20", headers=login_as(client, caller))
    assert response.status_code == 200
    assert all(
        response.json()[k] == [] for k in ("geolocations", "requests", "collections", "users")
    )


def test_invalid_type_returns_422(caller):
    response = client.get("/api/v1/search?q=x&type=bogus", headers=login_as(client, caller))
    assert response.status_code == 422
    assert "type" in response.json()["detail"].lower()


def test_limit_outside_range_returns_422(caller):
    response = client.get("/api/v1/search?q=x&limit=0", headers=login_as(client, caller))
    assert response.status_code == 422
    response = client.get("/api/v1/search?q=x&limit=51", headers=login_as(client, caller))
    assert response.status_code == 422


def test_search_matches_geolocation_by_title(db, caller):
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title=f"Spotted {token} convoy near checkpoint",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-a",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.flush()
    db.add(
        Media(
            event_id=geo.id,
            role="source",
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{geo.id}/x.jpg",
            media_type="image",
        )
    )
    # The thumbnail pick prefers ``source`` (``services.thumbnails``), so proof stays off the hit.
    db.add(
        Media(
            event_id=geo.id,
            role="proof",
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{geo.id}/p.jpg",
            media_type="image",
        )
    )
    db.commit()
    geo_id = geo.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"]["geolocations"] == 1
        hit = body["geolocations"][0]
        assert hit["id"] == str(geo_id)
        assert token in hit["title"]
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]
        # Regression: the located group carries the picked thumbnail, as the list view does.
        assert [m["media_type"] for m in hit["media"]] == ["image"]
        assert all(m["role"] == "source" for m in hit["media"])
        # An unflagged event reads false rather than omitting the key.
        assert hit["is_graphic"] is False
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.commit()


def test_search_proof_only_event_surfaces_proof_image_thumbnail(db, caller):
    """With no source media a proof image is the thumbnail; a proof video is never picked."""
    token = _unique_token()
    proof_only = Event(
        owner_id=caller.id,
        title=f"Proof-only {token} strike footage",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-proof-only",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    video_only = Event(
        owner_id=caller.id,
        title=f"Video-proof {token} strike footage",
        event_coords=from_shape(Point(34.6, 48.6), srid=4326),
        source_url="https://example.com/post-proof-video",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add_all([proof_only, video_only])
    db.flush()
    db.add(
        Media(
            event_id=proof_only.id,
            role="proof",
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{proof_only.id}/p.jpg",
            media_type="image",
        )
    )
    # Defensive: a proof video should not exist but must never be picked.
    db.add(
        Media(
            event_id=video_only.id,
            role="proof",
            storage_url=f"http://localhost:8000/local-storage/geolocation_media/{video_only.id}/p.mp4",
            media_type="video",
        )
    )
    db.commit()
    ids = [proof_only.id, video_only.id]
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        hits = {h["id"]: h for h in response.json()["geolocations"]}
        proof_hit = hits[str(ids[0])]
        assert [(m["role"], m["media_type"]) for m in proof_hit["media"]] == [("proof", "image")]
        assert hits[str(ids[1])]["media"] == []
    finally:
        db.query(Event).filter(Event.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def test_search_does_not_match_geolocation_by_source_url(db, caller):
    """``source_url`` is intentionally not in the FTS index (see the migration's rationale)."""
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title="Plain title with no match",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url=f"https://example.com/{token}/post",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    geo_id = geo.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        ids = [h["id"] for h in response.json()["geolocations"]]
        assert str(geo_id) not in ids
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.commit()


def test_search_excludes_soft_deleted_geolocations(db, caller):
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title=f"Soft-deleted {token} should be hidden",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-b",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    geo_id = geo.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        assert response.json()["geolocations"] == []
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.commit()


def test_search_matches_request_by_title(db, caller):
    token = _unique_token()
    request = Event(
        owner_id=caller.id,
        title=f"Request {token} — please geolocate",
        source_url="https://example.com/request-a",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    db.add(request)
    db.flush()
    db.add(
        Media(
            event_id=request.id,
            role="source",
            storage_url=(f"http://localhost:8000/local-storage/request_uploads/{request.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    request_id = request.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=request",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"]["requests"] == 1
        hit = body["requests"][0]
        assert hit["id"] == str(request_id)
        assert hit["status"] == STATUS_REQUESTED
        assert hit["is_graphic"] is False
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]
    finally:
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
        db.commit()


def test_search_hits_carry_the_graphic_flag(db, caller):
    """Both result groups report the graphic flag."""
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title=f"Graphic {token} aftermath",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-graphic",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
        is_graphic=True,
    )
    request = Event(
        owner_id=caller.id,
        title=f"Graphic {token} request",
        source_url="https://example.com/request-graphic",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
        is_graphic=True,
    )
    db.add_all([geo, request])
    db.commit()
    ids = [geo.id, request.id]
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=all",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert [hit["is_graphic"] for hit in body["geolocations"]] == [True]
        assert [hit["is_graphic"] for hit in body["requests"]] == [True]
    finally:
        db.query(Event).filter(Event.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def test_search_excludes_soft_deleted_requests(db, caller):
    token = _unique_token()
    request = Event(
        owner_id=caller.id,
        title=f"Hidden request {token}",
        source_url="https://example.com/request-b",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),
    )
    db.add(request)
    db.commit()
    request_id = request.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=request",
            headers=login_as(client, caller),
        )
        assert response.json()["requests"] == []
    finally:
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
        db.commit()


def test_search_matches_user_by_username(db, caller):
    # Postgres' simple parser matches whole tokens, so the username is the bare token.
    token = _unique_token()
    user = User(
        username=token,
        email=f"u-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=user",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"]["users"] == 1
        hit = body["users"][0]
        assert hit["id"] == str(user_id)
        assert token in hit["username_highlight"]
        assert hit["bio_highlight"] is None
    finally:
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_matches_user_by_bio_with_highlighted_snippet(db, caller):
    token = _unique_token()
    user = User(
        username=f"u{uuid.uuid4().hex[:8]}",
        email=f"bio-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
        bio=(
            f"Long bio with the {token} marker embedded in the middle of a "
            "longer sentence so the ts_headline fragment selector has "
            "something to cut around."
        ),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=user",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        hits = response.json()["users"]
        assert any(h["id"] == str(user_id) for h in hits)
        hit = next(h for h in hits if h["id"] == str(user_id))
        assert hit["bio_highlight"] is not None
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["bio_highlight"]
    finally:
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_excludes_soft_deleted_users(db, caller):
    token = _unique_token()
    user = User(
        username=token,
        email=f"sd-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
        deleted_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=user",
            headers=login_as(client, caller),
        )
        assert response.json()["users"] == []
    finally:
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


@pytest.fixture
def seed_collection(db, caller):
    """Open a collection, optionally with one showable event on it.

    The item's title carries no test token, so it stays out of the geolocations group.
    """
    made: list[tuple[uuid.UUID, uuid.UUID | None]] = []

    def _make(title, description, *, owner=None, empty=False, hidden=False):
        collection = Collection(
            owner_id=(owner or caller).id,
            title=title,
            hidden_at=datetime.now(UTC) if hidden else None,
            **collection_description(description),
        )
        db.add(collection)
        db.flush()
        collection_id = collection.id
        event_id = None
        if not empty:
            event_id = _seed_geo(db, owner or caller, f"Item {uuid.uuid4().hex[:8]}")
            db.add(CollectionEvent(collection_id=collection_id, event_id=event_id))
        db.commit()
        made.append((collection_id, event_id))
        return collection_id

    yield _make
    db.expire_all()
    for collection_id, event_id in made:
        db.query(Collection).filter(Collection.id == collection_id).delete(
            synchronize_session=False
        )
        if event_id is not None:
            db.query(Event).filter(Event.id == event_id).delete(synchronize_session=False)
    db.commit()


def test_search_matches_collection_by_title(caller, seed_collection):
    """A title hit returns the full collection card payload."""
    token = _unique_token()
    collection_id = seed_collection(f"Sites around {token}", "What this one holds.")
    response = client.get(
        f"/api/v1/search?q={token}&type=collection",
        headers=login_as(client, caller),
    )
    assert response.status_code == 200
    body = response.json()
    assert [hit["id"] for hit in body["collections"]] == [str(collection_id)]
    assert body["total"]["collections"] == 1
    hit = body["collections"][0]
    assert hit["owner"]["username"] == caller.username
    assert hit["event_count"] == 1
    assert hit["description_text"] == "What this one holds."


def test_search_matches_collection_by_description(caller, seed_collection):
    """The index covers the description's plain-text projection."""
    token = _unique_token()
    collection_id = seed_collection("A plain name", f"Everything about {token}.")
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert [hit["id"] for hit in response.json()["collections"]] == [str(collection_id)]


def test_search_matches_a_word_the_description_only_bolds(db, caller, seed_collection):
    """The index reads the projection, not the JSONB, so marked runs are findable."""
    token = _unique_token()
    collection_id = seed_collection("A plain name", "Placeholder.")
    collection = db.query(Collection).filter(Collection.id == collection_id).one()
    collection.description = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": token, "marks": [{"type": "bold"}]}],
            }
        ],
    }
    collection.description_text = token
    db.commit()

    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert [hit["id"] for hit in response.json()["collections"]] == [str(collection_id)]


def test_search_excludes_hidden_collections(caller, seed_collection):
    """A withheld collection is out of search."""
    token = _unique_token()
    seed_collection(f"Withheld {token}", "Taken down.", hidden=True)
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert response.json()["collections"] == []
    assert response.json()["total"]["collections"] == 0


def test_search_excludes_empty_collections(caller, seed_collection):
    """A collection with nothing showable on it stays out, as on a profile."""
    token = _unique_token()
    seed_collection(f"Nothing on it {token}", "Still scaffolding.", empty=True)
    response = client.get(f"/api/v1/search?q={token}&type=collection")
    assert response.json()["collections"] == []


def test_search_type_collection_returns_only_that_group(db, caller, seed_collection):
    """Other groups stay empty arrays: the response shape is stable."""
    token = _unique_token()
    collection_id = seed_collection(f"Shelf {token}", "One shelf.")
    geo = _seed_geo(db, caller, f"Geo {token}")
    try:
        response = client.get(f"/api/v1/search?q={token}&type=collection")
        body = response.json()
        assert [hit["id"] for hit in body["collections"]] == [str(collection_id)]
        assert body["geolocations"] == []
        assert body["requests"] == []
        assert body["users"] == []
        assert body["type"] == "collection"
    finally:
        db.query(Event).filter(Event.id == geo).delete(synchronize_session=False)
        db.commit()


def test_author_filter_narrows_collections_to_that_owner(db, caller, other_author, seed_collection):
    """``author`` scopes the collections group to that owner rather than emptying it."""
    token = _unique_token()
    mine = seed_collection(f"Mine {token}", "Owned by the caller.")
    seed_collection(f"Theirs {token}", "Owned by somebody else.", owner=other_author)
    response = client.get(f"/api/v1/search?q={token}&author={caller.username}")
    body = response.json()
    assert [hit["id"] for hit in body["collections"]] == [str(mine)]
    assert body["total"]["collections"] == 1


def test_event_filter_empties_the_collections_group(caller, seed_collection):
    """Every filter but ``author`` is an event predicate, so it empties the group."""
    token = _unique_token()
    seed_collection(f"Shelf {token}", "One shelf.")
    response = client.get(f"/api/v1/search?q={token}&status=geolocated")
    assert response.json()["collections"] == []
    assert response.json()["total"]["collections"] == 0


def test_browse_lists_the_authors_collections_newest_first(caller, seed_collection):
    """Empty query plus ``author`` browses that analyst's collections (the profile "Show more")."""
    token = _unique_token()
    older = seed_collection(f"Older {token}", "Shelved first.")
    newer = seed_collection(f"Newer {token}", "Shelved second.")
    response = client.get(f"/api/v1/search?type=collection&author={caller.username}")
    assert response.status_code == 200
    body = response.json()
    assert [hit["id"] for hit in body["collections"]] == [str(newer), str(older)]
    assert body["total"]["collections"] == 2
    assert body["collections"][0]["event_count"] == 1


def test_browse_excludes_hidden_and_empty_collections(caller, seed_collection):
    """Browse applies the same visibility and non-empty predicates as a typed query."""
    token = _unique_token()
    shown = seed_collection(f"Shown {token}", "Holds something.")
    seed_collection(f"Withheld {token}", "Taken down.", hidden=True)
    seed_collection(f"Bare {token}", "Still scaffolding.", empty=True)
    response = client.get(f"/api/v1/search?type=collection&author={caller.username}")
    body = response.json()
    assert [hit["id"] for hit in body["collections"]] == [str(shown)]
    assert body["total"]["collections"] == 1


def test_browse_without_an_author_leaves_the_group_empty(caller, seed_collection):
    """An empty query with no author (or a non-author filter) answers with nothing."""
    token = _unique_token()
    seed_collection(f"Shelf {token}", "One shelf.")
    assert client.get("/api/v1/search?type=collection").json()["collections"] == []
    filtered = client.get(
        f"/api/v1/search?type=collection&author={caller.username}&status=geolocated"
    ).json()
    assert filtered["collections"] == []
    assert filtered["total"]["collections"] == 0


def test_typed_query_still_narrows_within_an_author(caller, seed_collection):
    """The text predicate applies alongside ``author``."""
    token = _unique_token()
    wanted = seed_collection(f"Kupiansk {token}", "The eastern approach.")
    seed_collection(f"Kherson {token}", "The river bank.")
    response = client.get(
        f"/api/v1/search?q=Kupiansk {token}&type=collection&author={caller.username}"
    )
    body = response.json()
    assert [hit["id"] for hit in body["collections"]] == [str(wanted)]
    assert body["total"]["collections"] == 1


def test_collection_fts_query_uses_the_gin_index(db):
    """The ORM tsvector must match the migration's GIN index expression, or it silently seq-scans."""
    from sqlalchemy import func as safunc
    from sqlalchemy import text as satext

    from app.services import search as search_service

    tsquery = safunc.plainto_tsquery(search_service._TS_CONFIG, "depot")
    stmt = db.query(Collection.id).filter(search_service._collection_tsvector().op("@@")(tsquery))
    compiled = stmt.statement.compile(db.get_bind(), compile_kwargs={"literal_binds": True})
    db.execute(satext("SET enable_seqscan = off"))
    try:
        plan = "\n".join(row[0] for row in db.execute(satext(f"EXPLAIN {compiled}")))
    finally:
        db.execute(satext("RESET enable_seqscan"))
    assert "ix_collections_search_fts" in plan, plan


def test_search_type_all_returns_every_group(db, caller, seed_collection):
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title=f"Geo {token} unique-token row",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    request = Event(
        owner_id=caller.id,
        title=f"Request {token} unique-token row",
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    user = User(
        username=token,
        email=f"all-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add_all([geo, request, user])
    db.flush()
    db.add(
        Media(
            event_id=request.id,
            role="source",
            storage_url=(f"http://localhost:8000/local-storage/request_uploads/{request.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    geo_id, request_id, user_id = geo.id, request.id, user.id
    collection_id = seed_collection(f"Shelf {token}", "One shelf.")
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=all",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert [h["id"] for h in body["geolocations"]] == [str(geo_id)]
        assert [h["id"] for h in body["requests"]] == [str(request_id)]
        assert [h["id"] for h in body["users"]] == [str(user_id)]
        assert [h["id"] for h in body["collections"]] == [str(collection_id)]
        assert body["total"] == {
            "geolocations": 1,
            "requests": 1,
            "collections": 1,
            "users": 1,
        }
        assert body["query"] == token
        assert body["type"] == "all"
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_type_filter_scopes_to_one_group(db, caller):
    """Other groups stay empty arrays so the frontend need not gate on key presence."""
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title=f"Geo only {token}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    request = Event(
        owner_id=caller.id,
        title=f"Request also {token}",
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    db.add_all([geo, request])
    db.flush()
    db.add(
        Media(
            event_id=request.id,
            role="source",
            storage_url=(f"http://localhost:8000/local-storage/request_uploads/{request.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    geo_id, request_id = geo.id, request.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        body = response.json()
        assert [h["id"] for h in body["geolocations"]] == [str(geo_id)]
        assert body["requests"] == []
        assert body["users"] == []
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
        db.commit()


def test_search_limit_caps_per_group(db, caller):
    """The limit survives the rank-then-hydrate pipeline."""
    token = _unique_token()
    requests = []
    for i in range(4):
        b = Event(
            owner_id=caller.id,
            title=f"Request {token} number {i}",
            source_url="https://example.com",
            source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
            status=STATUS_REQUESTED,
            requested_at=datetime.now(UTC),
        )
        db.add(b)
        requests.append(b)
    db.flush()
    for b in requests:
        db.add(
            Media(
                event_id=b.id,
                role="source",
                storage_url=(f"http://localhost:8000/local-storage/request_uploads/{b.id}/x.jpg"),
                media_type="image",
            )
        )
    db.commit()
    request_ids = [b.id for b in requests]
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=request&limit=2",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["requests"]) == 2
        # ``total`` is the pre-LIMIT count, not len(array).
        assert body["total"]["requests"] == 4
    finally:
        for bid in request_ids:
            db.query(Event).filter(Event.id == bid).delete(synchronize_session=False)
        db.commit()


def test_search_strips_planted_sentinel_bytes_from_bio(db, caller):
    """A bio planting STX/ETX must not break the highlight's marker parity.

    The SQL wraps every ``ts_headline`` document in ``translate(col, chr(2) || chr(3), '')``.
    """
    token = _unique_token()
    user = User(
        username=f"u{uuid.uuid4().hex[:8]}",
        email=f"hl-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
        bio=f"hostile \x02fake-start\x03 prefix then real {token} match",
    )
    db.add(user)
    db.commit()
    user_id = user.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=user",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        hit = next(h for h in response.json()["users"] if h["id"] == str(user_id))
        bio_hl = hit["bio_highlight"]
        assert bio_hl is not None
        assert bio_hl.count(HIGHLIGHT_START) == bio_hl.count(HIGHLIGHT_STOP)
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in bio_hl
        # Only the marker bytes are stripped, not the user's words.
        assert "fake-start" in bio_hl
    finally:
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_strips_planted_sentinel_bytes_from_title(db, caller):
    """The same sentinel stripping applies to geolocation and request titles."""
    token = _unique_token()
    geo = Event(
        owner_id=caller.id,
        title=f"planted \x02bad\x03 then {token} fragment",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    geo_id = geo.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        hit = next(h for h in response.json()["geolocations"] if h["id"] == str(geo_id))
        th = hit["title_highlight"]
        assert th.count(HIGHLIGHT_START) == th.count(HIGHLIGHT_STOP)
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in th
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.commit()


@pytest.fixture
def other_author(db):
    user = User(
        username=f"otherauth{uuid.uuid4().hex[:8]}",
        email=f"other-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _seed_geo(db, owner, title):
    geo = Event(
        owner_id=owner.id,
        title=title,
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-a",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    return geo.id


def test_author_filter_scopes_event_groups_and_empties_users(db, caller, other_author):
    token = _unique_token()
    mine = _seed_geo(db, caller, f"Strike {token} east")
    theirs = _seed_geo(db, other_author, f"Strike {token} west")
    try:
        response = client.get(f"/api/v1/search?q={token}&author={caller.username}")
        assert response.status_code == 200
        body = response.json()
        assert [h["id"] for h in body["geolocations"]] == [str(mine)]
        assert body["total"]["geolocations"] == 1
        # Otherwise the caller's username would match itself.
        assert body["users"] == []
        assert body["total"]["users"] == 0
    finally:
        db.query(Event).filter(Event.id.in_([mine, theirs])).delete(synchronize_session=False)
        db.commit()


def test_author_with_empty_query_browses_the_authors_view(db, caller, other_author):
    token = _unique_token()
    older = _seed_geo(db, caller, f"First {token}")
    newer = _seed_geo(db, caller, f"Second {token}")
    noise = _seed_geo(db, other_author, f"Noise {token}")
    request_row = Event(
        owner_id=caller.id,
        requested_by_id=caller.id,
        title=f"Where is {token}",
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
        # ``ck_events_source_url_status`` requires it on a request.
        source_url="https://example.com/request-footage",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
    )
    db.add(request_row)
    db.commit()
    request_id = request_row.id
    try:
        response = client.get(f"/api/v1/search?author={caller.username}")
        assert response.status_code == 200
        body = response.json()
        geo_ids = [h["id"] for h in body["geolocations"]]
        assert geo_ids.index(str(newer)) < geo_ids.index(str(older))
        assert str(noise) not in geo_ids
        # Without an FTS predicate the plain title is the highlight.
        newest = next(h for h in body["geolocations"] if h["id"] == str(newer))
        assert newest["title_highlight"] == newest["title"]
        assert HIGHLIGHT_START not in newest["title_highlight"]
        # The requested view rides the same scope.
        assert str(request_id) in [h["id"] for h in body["requests"]]
    finally:
        db.query(Event).filter(Event.id.in_([older, newer, noise, request_id])).delete(
            synchronize_session=False
        )
        db.commit()


def test_author_unknown_returns_empty_groups(caller):
    response = client.get("/api/v1/search?author=no-such-analyst-here")
    assert response.status_code == 200
    assert all(
        response.json()[k] == [] for k in ("geolocations", "requests", "collections", "users")
    )


def test_author_rejects_malformed_username():
    response = client.get("/api/v1/search?q=x&author=bad%20name%21")
    assert response.status_code == 422


def test_conflict_filter_scopes_search(db, caller):
    from app.models.conflict import Conflict

    token = _unique_token()
    row = Conflict(name=f"conf-{token}", ongoing=True, source="manual")
    db.add(row)
    db.commit()
    tagged = _seed_geo(db, caller, f"Tagged {token}")
    tagged_event = db.query(Event).filter(Event.id == tagged).one()
    tagged_event.conflicts.append(row)
    untagged = _seed_geo(db, caller, f"Untagged {token}")
    db.commit()
    try:
        response = client.get(f"/api/v1/search?q={token}&conflict=conf-{token}")
        assert response.status_code == 200
        body = response.json()
        assert [h["id"] for h in body["geolocations"]] == [str(tagged)]
        assert body["users"] == [] and body["total"]["users"] == 0
    finally:
        db.query(Event).filter(Event.id.in_([tagged, untagged])).delete(synchronize_session=False)
        db.execute(Conflict.__table__.delete().where(Conflict.id == row.id))
        db.commit()


def test_event_date_filter_scopes_search_and_browses(db, caller):
    token = _unique_token()
    inside = _seed_geo(db, caller, f"Inside {token}")
    outside = _seed_geo(db, caller, f"Outside {token}")
    db.query(Event).filter(Event.id == outside).update({"event_date": date(2020, 1, 1)})
    db.commit()
    try:
        response = client.get(f"/api/v1/search?q={token}&event_date_from=2026-01-01")
        ids = [h["id"] for h in response.json()["geolocations"]]
        assert str(inside) in ids and str(outside) not in ids
        # The date window alone is an active filter in browse mode.
        response = client.get(f"/api/v1/search?author={caller.username}&event_date_from=2026-01-01")
        ids = [h["id"] for h in response.json()["geolocations"]]
        assert str(inside) in ids and str(outside) not in ids
    finally:
        db.query(Event).filter(Event.id.in_([inside, outside])).delete(synchronize_session=False)
        db.commit()


def test_status_filter_scopes_search(db, caller):
    """`?status=` narrows the event groups; an unknown value 422s."""
    token = _unique_token()
    located = _seed_geo(db, caller, f"Located {token}")
    detected = _seed_geo(db, caller, f"Detected {token}")
    db.query(Event).filter(Event.id == detected).update(
        {"status": STATUS_DETECTED, "detected_at": datetime.now(UTC), "geolocated_at": None}
    )
    db.commit()
    try:
        response = client.get(f"/api/v1/search?q={token}&status=detected")
        assert response.status_code == 200
        body = response.json()
        assert [h["id"] for h in body["geolocations"]] == [str(detected)]
        assert body["users"] == [] and body["total"]["users"] == 0

        response = client.get(f"/api/v1/search?q={token}&status=hallucinated")
        assert response.status_code == 422
    finally:
        db.query(Event).filter(Event.id.in_([located, detected])).delete(synchronize_session=False)
        db.commit()


def test_garbage_date_filter_returns_422(caller):
    response = client.get("/api/v1/search?q=x&event_date_from=not-a-date")
    assert response.status_code == 422


def test_garbage_media_filter_returns_422(caller):
    response = client.get("/api/v1/search?q=x&media=hologram")
    assert response.status_code == 422


def test_type_event_returns_both_event_groups_without_users(db, caller):
    """Both event groups and no analysts, even when the query matches a username."""
    token = _unique_token()
    geo = _seed_geo(db, caller, f"Event-type {token}")
    try:
        response = client.get(f"/api/v1/search?q={token}&type=event")
        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "event"
        assert [h["id"] for h in body["geolocations"]] == [str(geo)]
        assert body["requests"] == []
        assert body["users"] == [] and body["total"]["users"] == 0
    finally:
        db.query(Event).filter(Event.id == geo).delete(synchronize_session=False)
        db.commit()


def test_author_suggestions_substring_prefix_first(db, caller, other_author):
    """Substring match, prefix matches first. Only analysts owning a live event are suggested,
    which keeps the anonymous endpoint from being an account-enumeration oracle."""
    geo = _seed_geo(db, caller, f"Suggestable {_unique_token()}")
    try:
        fragment = caller.username[:6]  # "caller" prefix shared by the fixture pool
        response = client.get(f"/api/v1/search/authors?q={fragment}")
        assert response.status_code == 200
        authors = response.json()["authors"]
        assert caller.username in authors
        assert other_author.username not in authors
        mid = caller.username[2:8]
        response = client.get(f"/api/v1/search/authors?q={mid}")
        assert caller.username in response.json()["authors"]
        # The enumeration guard holds even on an exact username probe.
        response = client.get(f"/api/v1/search/authors?q={other_author.username}")
        assert response.json()["authors"] == []
    finally:
        db.query(Event).filter(Event.id == geo).delete(synchronize_session=False)
        db.commit()


def test_author_suggestions_exclude_soft_deleted(db, caller):
    from datetime import UTC as _UTC
    from datetime import datetime as _dt

    geo = _seed_geo(db, caller, f"Deleted owner {_unique_token()}")
    caller.deleted_at = _dt.now(_UTC)
    db.commit()
    try:
        response = client.get(f"/api/v1/search/authors?q={caller.username}")
        assert response.status_code == 200
        assert caller.username not in response.json()["authors"]
    finally:
        db.query(Event).filter(Event.id == geo).delete(synchronize_session=False)
        db.commit()


def test_author_suggestions_empty_and_invalid_q(caller):
    assert client.get("/api/v1/search/authors?q=").json()["authors"] == []
    assert client.get("/api/v1/search/authors?q=bad%20name%21").status_code == 422


def test_author_filter_is_exact_on_search(db, caller):
    """`?author=` on /search matches exactly, never a fragment sweep."""
    token = _unique_token()
    geo = _seed_geo(db, caller, f"Exact {token}")
    try:
        fragment = caller.username[:6]
        response = client.get(f"/api/v1/search?q={token}&author={fragment}")
        assert response.status_code == 200
        assert response.json()["geolocations"] == []
        response = client.get(f"/api/v1/search?q={token}&author={caller.username.upper()}")
        assert [h["id"] for h in response.json()["geolocations"]] == [str(geo)]
    finally:
        db.query(Event).filter(Event.id == geo).delete(synchronize_session=False)
        db.commit()


def test_browse_mode_strips_planted_sentinel_bytes_from_title(db, caller):
    """Browse mode (plain title as highlight) strips planted STX/ETX like the ts_headline branch."""
    token = _unique_token()
    geo = _seed_geo(db, caller, f"Planted {HIGHLIGHT_START}fake{HIGHLIGHT_STOP} {token}")
    try:
        response = client.get(f"/api/v1/search?author={caller.username}")
        assert response.status_code == 200
        hit = next(h for h in response.json()["geolocations"] if h["id"] == str(geo))
        assert HIGHLIGHT_START not in hit["title_highlight"]
        assert HIGHLIGHT_STOP not in hit["title_highlight"]
    finally:
        db.query(Event).filter(Event.id == geo).delete(synchronize_session=False)
        db.commit()


def test_fts_query_uses_the_gin_index(db):
    """The ORM tsvector must match the migration's GIN index expression, or search seq-scans."""
    from sqlalchemy import func as safunc
    from sqlalchemy import text as satext

    from app.services import search as search_service

    tsquery = safunc.plainto_tsquery(search_service._TS_CONFIG, "depot")
    # Only the FTS predicate: other WHERE legs let the planner pick another index on a
    # near-empty CI table. With seq scans discouraged, the GIN is used iff the expression matches.
    stmt = db.query(Event.id).filter(search_service._geo_tsvector().op("@@")(tsquery))
    compiled = stmt.statement.compile(db.get_bind(), compile_kwargs={"literal_binds": True})
    db.execute(satext("SET enable_seqscan = off"))
    try:
        plan = "\n".join(row[0] for row in db.execute(satext(f"EXPLAIN {compiled}")))
    finally:
        db.execute(satext("RESET enable_seqscan"))
    assert "ix_events_search_fts" in plan, plan
