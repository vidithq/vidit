"""End-to-end tests for ``GET /search``.

Scope: the search surface — three FTS-backed result groups (geolocations,
bounties, users), the highlight-marker contract, the ``type`` filter,
soft-delete invariants, auth, and the empty-query short-circuit.

Since the bounty + geolocation merge the "bounties" group is a view over the
one ``geolocations`` table: a bounty is a ``requested`` row (no location). The
located view (``geolocations`` group) filters ``location IS NOT NULL``; the
requested view filters ``status = 'requested'``, so the two never overlap.

We seed fresh rows per test with unique-suffix titles / usernames so
matches are bounded to this test's data — the dev DB carries the demo
seed, and an FTS query like "Donetsk" would otherwise pull in
arbitrary neighbours. Suffix lookups also make the assertions
deterministic without coupling to insertion order.
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
from app.models.geolocation import STATUS_REQUESTED, Geolocation
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from app.services.search import HIGHLIGHT_START, HIGHLIGHT_STOP
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
def caller(db):
    """Authenticated request originator for the search endpoint (auth-required).

    Unique username so it doesn't accidentally show up as a result.
    """
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
    """Highly unique alphanumeric token usable in titles / bios.

    We embed it in seeded text and query for it so the assertions
    aren't contaminated by other rows in the dev DB (demo seeds,
    other tests' leftovers).
    """
    return f"vidqterm{uuid.uuid4().hex[:10]}"


# ── Empty + validation ────────────────────────────────────────────────────


def test_search_requires_auth():
    response = client.get("/api/v1/search?q=anything")
    assert response.status_code == 401


def test_empty_query_returns_empty_groups(caller):
    response = client.get("/api/v1/search?q=&type=all", headers=login_as(client, caller))
    assert response.status_code == 200
    body = response.json()
    assert body["geolocations"] == []
    assert body["bounties"] == []
    assert body["users"] == []
    assert body["total"] == {"geolocations": 0, "bounties": 0, "users": 0}
    assert body["query"] == ""
    assert body["type"] == "all"


def test_whitespace_only_query_returns_empty_groups(caller):
    response = client.get("/api/v1/search?q=%20%20%20", headers=login_as(client, caller))
    assert response.status_code == 200
    assert all(response.json()[k] == [] for k in ("geolocations", "bounties", "users"))


def test_invalid_type_returns_422(caller):
    response = client.get("/api/v1/search?q=x&type=bogus", headers=login_as(client, caller))
    assert response.status_code == 422
    assert "type" in response.json()["detail"].lower()


def test_limit_outside_range_returns_422(caller):
    response = client.get("/api/v1/search?q=x&limit=0", headers=login_as(client, caller))
    assert response.status_code == 422
    response = client.get("/api/v1/search?q=x&limit=51", headers=login_as(client, caller))
    assert response.status_code == 422


# ── Geolocations ──────────────────────────────────────────────────────────


def test_search_matches_geolocation_by_title(db, caller):
    token = _unique_token()
    geo = Geolocation(
        author_id=caller.id,
        title=f"Spotted {token} convoy near checkpoint",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-a",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
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
        body = response.json()
        assert body["total"]["geolocations"] == 1
        hit = body["geolocations"][0]
        assert hit["id"] == str(geo_id)
        assert token in hit["title"]
        # The highlight wraps the matched token with the agreed sentinels;
        # the frontend will turn those into <mark> elements.
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]
    finally:
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.commit()


def test_search_does_not_match_geolocation_by_source_url(db, caller):
    """``source_url`` is intentionally not in the FTS index — Postgres'
    simple parser tokenizes URLs as host/path units, so a URL-fragment
    query would only match the whole-path token anyway. Locked in as a
    regression guard: a future contributor adding the URL column to
    the index expression will surface here and need to read the
    migration's rationale block."""
    token = _unique_token()
    geo = Geolocation(
        author_id=caller.id,
        title="Plain title with no match",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url=f"https://example.com/{token}/post",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
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
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.commit()


def test_search_excludes_soft_deleted_geolocations(db, caller):
    token = _unique_token()
    geo = Geolocation(
        author_id=caller.id,
        title=f"Soft-deleted {token} should be hidden",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/post-b",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
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
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.commit()


# ── Bounties ──────────────────────────────────────────────────────────────


def test_search_matches_bounty_by_title_with_claimer_count(db, caller):
    token = _unique_token()
    # A bounty is a ``requested`` event: no location (the requested-view search
    # filter is ``status = 'requested'``).
    bounty = Geolocation(
        author_id=caller.id,
        title=f"Bounty {token} — please geolocate",
        source_url="https://example.com/bounty-a",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
    )
    db.add(bounty)
    db.flush()
    db.add(
        Media(
            geolocation_id=bounty.id,
            storage_url=(f"http://localhost:8000/local-storage/bounty_uploads/{bounty.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    bounty_id = bounty.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=bounty",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"]["bounties"] == 1
        hit = body["bounties"][0]
        assert hit["id"] == str(bounty_id)
        # Mirrors the BountyList aggregate so the search card can reuse
        # the same "N working" treatment.
        assert hit["claimer_count"] == 0
        assert hit["status"] == STATUS_REQUESTED
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]
    finally:
        db.query(Geolocation).filter(Geolocation.id == bounty_id).delete(synchronize_session=False)
        db.commit()


def test_search_excludes_soft_deleted_bounties(db, caller):
    token = _unique_token()
    bounty = Geolocation(
        author_id=caller.id,
        title=f"Hidden bounty {token}",
        source_url="https://example.com/bounty-b",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        deleted_at=datetime.now(UTC),
    )
    db.add(bounty)
    db.commit()
    bounty_id = bounty.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=bounty",
            headers=login_as(client, caller),
        )
        assert response.json()["bounties"] == []
    finally:
        db.query(Geolocation).filter(Geolocation.id == bounty_id).delete(synchronize_session=False)
        db.commit()


# ── Users ─────────────────────────────────────────────────────────────────


def test_search_matches_user_by_username(db, caller):
    # Username == the token directly. Postgres' simple parser does
    # exact-token matching, not substring, so ``f"u{token}"`` would
    # become a single token Postgres can't subdivide.
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
        # No bio set, so the bio_highlight should be None — the UI uses
        # this to decide whether to render the snippet block.
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
        # Bio matched, so the snippet field MUST carry the sentinels.
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


# ── Grouped (type=all) ────────────────────────────────────────────────────


def test_search_type_all_returns_three_groups(db, caller):
    token = _unique_token()
    # Plant one matching row per entity so we can prove all three
    # branches fire on type=all without depending on dev-DB demo data.
    geo = Geolocation(
        author_id=caller.id,
        title=f"Geo {token} unique-token row",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
    )
    bounty = Geolocation(
        author_id=caller.id,
        title=f"Bounty {token} unique-token row",
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
    )
    user = User(
        username=token,
        email=f"all-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add_all([geo, bounty, user])
    db.flush()
    db.add(
        Media(
            geolocation_id=bounty.id,
            storage_url=(f"http://localhost:8000/local-storage/bounty_uploads/{bounty.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    geo_id, bounty_id, user_id = geo.id, bounty.id, user.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=all",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        # Each group has exactly the one row we planted — the unique
        # token isolates us from any neighbour rows in the dev DB.
        assert [h["id"] for h in body["geolocations"]] == [str(geo_id)]
        assert [h["id"] for h in body["bounties"]] == [str(bounty_id)]
        assert [h["id"] for h in body["users"]] == [str(user_id)]
        assert body["total"] == {"geolocations": 1, "bounties": 1, "users": 1}
        assert body["query"] == token
        assert body["type"] == "all"
    finally:
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.query(Geolocation).filter(Geolocation.id == bounty_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_type_filter_scopes_to_one_group(db, caller):
    """``type=geolocation`` returns geo hits and empty arrays for the
    other groups — the JSON shape stays stable so the frontend doesn't
    have to gate on key presence."""
    token = _unique_token()
    geo = Geolocation(
        author_id=caller.id,
        title=f"Geo only {token}",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
    )
    bounty = Geolocation(
        author_id=caller.id,
        title=f"Bounty also {token}",
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
    )
    db.add_all([geo, bounty])
    db.flush()
    db.add(
        Media(
            geolocation_id=bounty.id,
            storage_url=(f"http://localhost:8000/local-storage/bounty_uploads/{bounty.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    geo_id, bounty_id = geo.id, bounty.id
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=geolocation",
            headers=login_as(client, caller),
        )
        body = response.json()
        assert [h["id"] for h in body["geolocations"]] == [str(geo_id)]
        # Other groups stay empty arrays — the shape doesn't depend on
        # the filter.
        assert body["bounties"] == []
        assert body["users"] == []
    finally:
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.query(Geolocation).filter(Geolocation.id == bounty_id).delete(synchronize_session=False)
        db.commit()


def test_search_limit_caps_per_group(db, caller):
    """Plant 4 matching bounties, ask for limit=2, expect 2 back —
    proves the LIMIT clause makes it through the rank-then-hydrate
    pipeline."""
    token = _unique_token()
    bounties = []
    for i in range(4):
        b = Geolocation(
            author_id=caller.id,
            title=f"Bounty {token} number {i}",
            source_url="https://example.com",
            source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
            status=STATUS_REQUESTED,
        )
        db.add(b)
        bounties.append(b)
    db.flush()
    for b in bounties:
        db.add(
            Media(
                geolocation_id=b.id,
                storage_url=(f"http://localhost:8000/local-storage/bounty_uploads/{b.id}/x.jpg"),
                media_type="image",
            )
        )
    db.commit()
    bounty_ids = [b.id for b in bounties]
    try:
        response = client.get(
            f"/api/v1/search?q={token}&type=bounty&limit=2",
            headers=login_as(client, caller),
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["bounties"]) == 2
        # ``total`` is the pre-LIMIT count from ``COUNT(*) OVER ()`` so
        # it must reflect all 4 matches, not just the 2 we returned.
        # Locks in the fix for the "total is len(arrays)" review finding.
        assert body["total"]["bounties"] == 4
    finally:
        for bid in bounty_ids:
            db.query(Geolocation).filter(Geolocation.id == bid).delete(synchronize_session=False)
        db.commit()


# ── Sentinel-collision regression (review finding #1) ─────────────────────


def test_search_strips_planted_sentinel_bytes_from_bio(db, caller):
    """A hostile user could plant the highlight-sentinel bytes (STX /
    ETX) in their own ``bio`` via a raw-bytes PATCH and corrupt the
    highlight string's even/odd parity for everyone reading their
    content. Defence: the SQL wraps every ``ts_headline`` document arg
    in ``translate(col, chr(2) || chr(3), '')`` so the stripped
    document never carries planted markers into the response.

    A bio containing STX + ETX, searched for a word that actually
    matches the bio, must return a highlight string where every STX
    has a matching ETX and vice-versa.
    """
    token = _unique_token()
    user = User(
        username=f"u{uuid.uuid4().hex[:8]}",
        email=f"hl-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
        # Planted sentinels surrounding text; the searchable token is
        # outside the planted run so the match doesn't depend on the
        # stripped bytes. Without the strip, ts_headline would echo
        # these bytes verbatim and break the frontend split's parity.
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
        # Equal STX and ETX counts → every opening marker has a closing
        # marker → the frontend split's even/odd parity holds.
        assert bio_hl.count(HIGHLIGHT_START) == bio_hl.count(HIGHLIGHT_STOP)
        # The token IS wrapped by sentinels in the headline output.
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in bio_hl
        # The analyst's words ("fake-start") survive in the bio snippet
        # — we strip only the abusive markers around them, not user
        # content, so the row's text isn't censored.
        assert "fake-start" in bio_hl
    finally:
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_strips_planted_sentinel_bytes_from_title(db, caller):
    """Same defence applied to geolocation / bounty titles. Plant the
    sentinel bytes in a geo's title, search by an adjacent word, and
    expect the response to have balanced sentinel parity."""
    token = _unique_token()
    geo = Geolocation(
        author_id=caller.id,
        title=f"planted \x02bad\x03 then {token} fragment",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
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
        db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
        db.commit()
