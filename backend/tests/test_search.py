"""End-to-end tests for ``GET /search``.

Scope: the search surface — three FTS-backed result groups (geolocations,
requests, users), the highlight-marker contract, the ``type`` filter,
soft-delete invariants, auth, and the empty-query short-circuit.

Since the request + geolocation merge the "requests" group is a view over the
one ``geolocations`` table: a request is a ``requested`` row (no location). The
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
from app.models.event import STATUS_REQUESTED, Event
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
    """Authenticated request originator for the search endpoint.

    The endpoint is anonymous; most tests still call it signed-in so the
    seeded rows have an owner. Unique username so it doesn't accidentally
    show up as a result.
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


def test_search_is_anonymous():
    """Search is part of the public read surface — no session required."""
    response = client.get("/api/v1/search?q=anything")
    assert response.status_code == 200


def test_empty_query_returns_empty_groups(caller):
    response = client.get("/api/v1/search?q=&type=all", headers=login_as(client, caller))
    assert response.status_code == 200
    body = response.json()
    assert body["geolocations"] == []
    assert body["requests"] == []
    assert body["users"] == []
    assert body["total"] == {"geolocations": 0, "requests": 0, "users": 0}
    assert body["query"] == ""
    assert body["type"] == "all"


def test_whitespace_only_query_returns_empty_groups(caller):
    response = client.get("/api/v1/search?q=%20%20%20", headers=login_as(client, caller))
    assert response.status_code == 200
    assert all(response.json()[k] == [] for k in ("geolocations", "requests", "users"))


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
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.commit()


def test_search_does_not_match_geolocation_by_source_url(db, caller):
    """``source_url`` is intentionally not in the FTS index — Postgres'
    simple parser tokenizes URLs as host/path units, so a URL-fragment
    query would only match the whole-path token anyway. Locked in as a
    regression guard: a future contributor adding the URL column to
    the index expression will surface here and need to read the
    migration's rationale block."""
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


# ── Requests ──────────────────────────────────────────────────────────────


def test_search_matches_request_by_title_with_claimer_count(db, caller):
    token = _unique_token()
    # A request is a ``requested`` event: no location (the requested-view search
    # filter is ``status = 'requested'``).
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
        # Mirrors the RequestList aggregate so the search card can reuse
        # the same "N working" treatment.
        assert hit["claimer_count"] == 0
        assert hit["status"] == STATUS_REQUESTED
        assert f"{HIGHLIGHT_START}{token}{HIGHLIGHT_STOP}" in hit["title_highlight"]
    finally:
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
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
        assert [h["id"] for h in body["requests"]] == [str(request_id)]
        assert [h["id"] for h in body["users"]] == [str(user_id)]
        assert body["total"] == {"geolocations": 1, "requests": 1, "users": 1}
        assert body["query"] == token
        assert body["type"] == "all"
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()


def test_search_type_filter_scopes_to_one_group(db, caller):
    """``type=geolocation`` returns geo hits and empty arrays for the
    other groups — the JSON shape stays stable so the frontend doesn't
    have to gate on key presence."""
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
        # Other groups stay empty arrays — the shape doesn't depend on
        # the filter.
        assert body["requests"] == []
        assert body["users"] == []
    finally:
        db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
        db.query(Event).filter(Event.id == request_id).delete(synchronize_session=False)
        db.commit()


def test_search_limit_caps_per_group(db, caller):
    """Plant 4 matching requests, ask for limit=2, expect 2 back —
    proves the LIMIT clause makes it through the rank-then-hydrate
    pipeline."""
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
        # ``total`` is the pre-LIMIT count from ``COUNT(*) OVER ()`` so
        # it must reflect all 4 matches, not just the 2 we returned.
        # Locks in the fix for the "total is len(arrays)" review finding.
        assert body["total"]["requests"] == 4
    finally:
        for bid in request_ids:
            db.query(Event).filter(Event.id == bid).delete(synchronize_session=False)
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
    """Same defence applied to geolocation / request titles. Plant the
    sentinel bytes in a geo's title, search by an adjacent word, and
    expect the response to have balanced sentinel parity."""
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


# ── Author filter ─────────────────────────────────────────────────────────
# ``?author=<username>`` scopes the event groups to one owner (the profile's
# "Show more" entry point); with an empty ``q`` it browses that author's
# whole view, newest first, plain titles as their own highlight.


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
        # The users group empties under an author scope, even on type=all:
        # the caller's username would otherwise match itself.
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
        # A request always carries the footage it asks about
        # (``ck_events_source_url_status``).
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
        # Browse mode: the author's located view, newest first, noise excluded.
        assert geo_ids.index(str(newer)) < geo_ids.index(str(older))
        assert str(noise) not in geo_ids
        # No FTS predicate, so the plain title stands in for the highlight.
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
    assert all(response.json()[k] == [] for k in ("geolocations", "requests", "users"))


def test_author_rejects_malformed_username():
    response = client.get("/api/v1/search?q=x&author=bad%20name%21")
    assert response.status_code == 422


# ── The shared filter set ─────────────────────────────────────────────────
# /search composes the same predicates as /events and /events/points
# (services/event_filters). A spot-check per family, not the full matrix:
# the predicate internals are pinned by the /events read suite.


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
        # Any active event filter empties the users group, not just author.
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
        # With a query.
        response = client.get(f"/api/v1/search?q={token}&event_date_from=2026-01-01")
        ids = [h["id"] for h in response.json()["geolocations"]]
        assert str(inside) in ids and str(outside) not in ids
        # Browse mode: the date window alone is an active filter (no q).
        response = client.get(f"/api/v1/search?author={caller.username}&event_date_from=2026-01-01")
        ids = [h["id"] for h in response.json()["geolocations"]]
        assert str(inside) in ids and str(outside) not in ids
    finally:
        db.query(Event).filter(Event.id.in_([inside, outside])).delete(synchronize_session=False)
        db.commit()


def test_garbage_date_filter_returns_422(caller):
    response = client.get("/api/v1/search?q=x&event_date_from=not-a-date")
    assert response.status_code == 422


def test_garbage_media_filter_returns_422(caller):
    response = client.get("/api/v1/search?q=x&media=hologram")
    assert response.status_code == 422


def test_type_event_returns_both_event_groups_without_users(db, caller):
    """``type=event`` is the unified reader chip: both event groups, no
    analyst hits even when the query matches a username."""
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
