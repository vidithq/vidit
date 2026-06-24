"""End-to-end tests for `/geolocations`.

Scope of this file: the public read surface (list, points, detail) +
the author-side mutation contract (create-validation, delete authz)
that doesn't require S3 round-trips. Heavy multipart-upload paths are
covered indirectly through `test_storage_local.py` and the admin
maintenance tests; we don't reproduce them here.

What we lock in:

* `_apply_filters` invariants — soft-delete filter applied to every
  public read, conflict / tag / author / bbox filters honour their
  contracts, never silently degrade to "return everything" on bad
  input.
* The points endpoint's compact shape + cache discipline (MISS → HIT,
  invalidate on mutation).
* The detail endpoint's 404 for soft-deleted rows (same surface as
  unknown id, no enumeration oracle).
* The delete endpoint's author-only + soft-delete-treated-as-404
  semantics.
* `bbox` validation (422 on malformed) — also covered in dedicated
  tests below.

Out of scope here: file-upload happy path, proof-image adoption,
S3 sweep on delete.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.cache import points_cache
from app.database import SessionLocal
from app.main import app
from app.models.geolocation import STATE_DETECTED, Geolocation
from app.models.proof_image import ProofImage
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as

client = TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_cookies_and_cache():
    """Prevent state-bleed across tests.

    - The TestClient cookie jar sticks the session from any prior
      ``login_as`` call; an anonymous test would otherwise inherit that
      identity. Wipe between tests.
    - `points_cache` is process-global; tests assert MISS / HIT
      sequences, so we clear before each test to make the first call
      deterministic.
    """
    client.cookies.clear()
    points_cache.invalidate()
    yield
    client.cookies.clear()
    points_cache.invalidate()


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
        username=f"auth{uuid.uuid4().hex[:8]}",
        email=f"auth-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Geolocation).filter(Geolocation.author_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def second_user(db):
    user = User(
        username=f"oth{uuid.uuid4().hex[:8]}",
        email=f"other-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Geolocation).filter(Geolocation.author_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _make_geo(
    db,
    *,
    author: User,
    lat: float = 48.5,
    lng: float = 34.5,
    title: str | None = None,
    event_date: date | None = None,
    deleted: bool = False,
    tags: list[Tag] | None = None,
) -> Geolocation:
    geo = Geolocation(
        author_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        location=from_shape(Point(lng, lat), srid=4326),
        source_url="https://example.com/source",
        event_date=event_date or date(2026, 5, 1),
    )
    if deleted:
        geo.deleted_at = datetime.now(UTC)
    if tags:
        geo.tags = tags
    db.add(geo)
    db.commit()
    db.refresh(geo)
    return geo


@pytest.fixture
def free_tag(db):
    tag = Tag(name=f"tag-{uuid.uuid4().hex[:8]}", category="free")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(
        Tag.__table__.delete().where(Tag.id == tag_id),
    )
    db.commit()


@pytest.fixture
def conflict_tag(db):
    tag = Tag(name=f"conflict-{uuid.uuid4().hex[:8]}", category="conflict")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(
        Tag.__table__.delete().where(Tag.id == tag_id),
    )
    db.commit()


@pytest.fixture
def capture_source_tag(db):
    tag = Tag(name=f"capture-{uuid.uuid4().hex[:8]}", category="capture_source")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(
        Tag.__table__.delete().where(Tag.id == tag_id),
    )
    db.commit()


# ── GET /geolocations — list ──────────────────────────────────────────────


def test_list_returns_seeded_geolocation(db, author):
    geo = _make_geo(db, author=author)
    response = client.get("/api/v1/geolocations")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(geo.id) in ids


def test_list_excludes_soft_deleted_rows(db, author):
    """Soft-delete is the load-bearing public-read invariant.

    Every public endpoint that surfaces geolocations must filter
    `deleted_at IS NULL`. If this regresses, admin removals leak back
    into the public catalog with no indication to the operator.
    """
    live = _make_geo(db, author=author)
    dead = _make_geo(db, author=author, deleted=True)

    response = client.get("/api/v1/geolocations")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_list_filters_by_free_tag(db, author, free_tag, conflict_tag):
    with_tag = _make_geo(db, author=author, tags=[free_tag])
    without_tag = _make_geo(db, author=author)

    response = client.get(f"/api/v1/geolocations?tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_tag.id) in ids
    assert str(without_tag.id) not in ids


def test_list_filters_by_conflict(db, author, conflict_tag):
    with_conflict = _make_geo(db, author=author, tags=[conflict_tag])
    other = _make_geo(db, author=author)

    response = client.get(f"/api/v1/geolocations?conflict={conflict_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_conflict.id) in ids
    assert str(other.id) not in ids


def test_list_conflict_filter_does_not_match_free_tag_of_same_name(db, author):
    """A free tag named the same as a conflict tag must not match `?conflict=`.

    Conflict filtering keys on `Tag.category == "conflict"`. If that
    constraint regresses, a `free` tag with a clashing name (e.g.
    someone tags a geo with the free string "Ukraine") would leak into
    the conflict filter and inflate counts.
    """
    free = Tag(name=f"clash-{uuid.uuid4().hex[:8]}", category="free")
    db.add(free)
    db.commit()
    geo = _make_geo(db, author=author, tags=[free])
    try:
        response = client.get(f"/api/v1/geolocations?conflict={free.name}")
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert str(geo.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id == free.id))
        db.commit()


def test_list_filters_by_capture_source(db, author, capture_source_tag):
    with_cs = _make_geo(db, author=author, tags=[capture_source_tag])
    other = _make_geo(db, author=author)

    response = client.get(f"/api/v1/geolocations?capture_source={capture_source_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_cs.id) in ids
    assert str(other.id) not in ids


def test_capture_source_filter_does_not_match_free_tag_of_same_name(db, author):
    """A free tag named like a capture-source tag must not match
    `?capture_source=` — the filter pins `category == "capture_source"`,
    same guard as the conflict bucket."""
    free = Tag(name=f"lens-{uuid.uuid4().hex[:8]}", category="free")
    db.add(free)
    db.commit()
    geo = _make_geo(db, author=author, tags=[free])
    try:
        response = client.get(f"/api/v1/geolocations?capture_source={free.name}")
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert str(geo.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id == free.id))
        db.commit()


def test_list_filters_by_author_substring(db, author):
    """`?author=` does a case-insensitive substring match on the
    username-safe ASCII whitelist (`[A-Za-z0-9_-]{1,50}`)."""
    geo = _make_geo(db, author=author)
    needle = author.username[2:6]
    response = client.get(f"/api/v1/geolocations?author={needle}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(geo.id) in ids


def test_list_rejects_author_with_like_meta(author):
    """LIKE-injection vectors (`%`, `\\`, `;`, …) and over-length input
    are rejected at the input boundary so nothing outside
    `[A-Za-z0-9_-]{1,50}` reaches the `ilike(f"%{author}%")` builder."""
    for bad in ("a%", "a\\b", "a;b", "a b", "a'b", "", "a" * 51):
        response = client.get("/api/v1/geolocations", params={"author": bad})
        assert response.status_code == 422, (
            f"expected 422 for author={bad!r}, got {response.status_code}"
        )


def test_points_rejects_author_with_like_meta(author):
    response = client.get("/api/v1/geolocations/points", params={"author": "a%"})
    assert response.status_code == 422


def test_list_filters_by_event_date_range(db, author):
    early = _make_geo(db, author=author, event_date=date(2026, 1, 1))
    mid = _make_geo(db, author=author, event_date=date(2026, 6, 1))
    late = _make_geo(db, author=author, event_date=date(2026, 12, 1))

    response = client.get(
        "/api/v1/geolocations?event_date_from=2026-05-01&event_date_to=2026-09-01"
    )
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(mid.id) in ids
    assert str(early.id) not in ids
    assert str(late.id) not in ids


def test_list_filters_by_bbox(db, author):
    inside = _make_geo(db, author=author, lat=48.5, lng=34.5)
    outside = _make_geo(db, author=author, lat=10.0, lng=10.0)

    # Box around Ukraine area, inside=(48.5, 34.5) is inside, (10, 10) is not.
    response = client.get("/api/v1/geolocations?bbox=45.0,30.0,50.0,40.0")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(inside.id) in ids
    assert str(outside.id) not in ids


def test_list_honours_limit(db, author):
    geos = [_make_geo(db, author=author) for _ in range(3)]  # noqa: F841
    response = client.get("/api/v1/geolocations?limit=2")
    assert response.status_code == 200
    assert len(response.json()) <= 2


# ── GET /geolocations/{id} — detail ───────────────────────────────────────


def test_detail_returns_full_shape(db, author, free_tag):
    geo = _make_geo(db, author=author, lat=48.7, lng=34.7, tags=[free_tag])
    response = client.get(f"/api/v1/geolocations/{geo.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(geo.id)
    assert body["title"] == geo.title
    assert body["lat"] == pytest.approx(48.7)
    assert body["lng"] == pytest.approx(34.7)
    assert body["author"]["username"] == author.username
    assert any(tag["name"] == free_tag.name for tag in body["tags"])


def test_detail_404_for_unknown_id():
    response = client.get(f"/api/v1/geolocations/{uuid.uuid4()}")
    assert response.status_code == 404


def test_detail_404_for_soft_deleted_geo(db, author):
    geo = _make_geo(db, author=author, deleted=True)
    response = client.get(f"/api/v1/geolocations/{geo.id}")
    assert response.status_code == 404, "soft-deleted geo must surface as 404, not the live shape"


# ── GET /geolocations/points ──────────────────────────────────────────────


def test_points_returns_compact_shape(db, author):
    geo = _make_geo(db, author=author, lat=48.5, lng=34.5)
    response = client.get("/api/v1/geolocations/points")
    assert response.status_code == 200
    body = response.json()
    # Find our row in the array
    matching = [row for row in body if row[0] == str(geo.id)]
    assert len(matching) == 1
    row = matching[0]
    assert len(row) == 6  # [id, lat, lng, event_date, submitted_date, detected]
    assert row[1] == pytest.approx(48.5)
    assert row[2] == pytest.approx(34.5)
    assert row[3] == geo.event_date.isoformat()  # ISO YYYY-MM-DD for the timeline
    assert row[4] == geo.created_at.date().isoformat()  # submitted (created_at) day
    assert row[5] == 0  # validated row → not marked detected


def test_points_excludes_soft_deleted(db, author):
    live = _make_geo(db, author=author)
    dead = _make_geo(db, author=author, deleted=True)
    response = client.get("/api/v1/geolocations/points")
    ids = {row[0] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_detected_row_renders_marked_across_surfaces(db, author):
    geo = Geolocation(
        author_id=author.id,
        title="Detected geo",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://x.com/a/status/1",
        event_date=date(2026, 5, 1),
        state=STATE_DETECTED,
        detected_from_url="https://x.com/a/status/1",
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)

    # /points — the compact map payload marks it with the detected flag.
    points = client.get("/api/v1/geolocations/points").json()
    point = next(r for r in points if r[0] == str(geo.id))
    assert point[5] == 1

    # Detail — state + the distinct detected_from_url provenance link.
    detail = client.get(f"/api/v1/geolocations/{geo.id}").json()
    assert detail["state"] == "detected"
    assert detail["detected_from_url"] == "https://x.com/a/status/1"

    # List card — carries state too.
    listing = client.get("/api/v1/geolocations").json()
    item = next(i for i in listing if i["id"] == str(geo.id))
    assert item["state"] == "detected"


def test_points_cache_miss_then_hit(db, author):
    """First call cold, second call warm — locks in the cache contract.

    The endpoint advertises this via the `X-Cache` response header so
    operators can sanity-check cache behaviour in prod logs without
    instrumenting metrics. Test guards against accidental cache
    bypass (e.g. someone removing the `points_cache.set` call).
    """
    _make_geo(db, author=author)
    first = client.get("/api/v1/geolocations/points")
    assert first.headers.get("x-cache") == "MISS"
    second = client.get("/api/v1/geolocations/points")
    assert second.headers.get("x-cache") == "HIT"
    # Bytes identical too — the cached path returns the same bytes object.
    assert first.content == second.content


def test_points_cache_keys_on_filter_combination(db, author, free_tag):
    """Different filter combos must miss independently.

    Without filter-aware keys, a cached "all points" response would
    bleed into a "filtered" request and return wrong data.
    """
    _make_geo(db, author=author, tags=[free_tag])
    _make_geo(db, author=author)

    unfiltered = client.get("/api/v1/geolocations/points")
    filtered = client.get(f"/api/v1/geolocations/points?tag={free_tag.name}")
    assert unfiltered.headers.get("x-cache") == "MISS"
    assert filtered.headers.get("x-cache") == "MISS", "different filter must MISS"
    # Filtered set is strictly smaller than unfiltered.
    assert len(filtered.json()) < len(unfiltered.json())


def test_points_filters_media_trusted_and_demo(db, author):
    """``media``, ``trusted_only`` and ``hide_demo`` each narrow the point set."""
    from app.models.media import Media

    plain = _make_geo(db, author=author, lat=40.0, lng=40.0)
    with_video = _make_geo(db, author=author, lat=41.0, lng=41.0)
    db.add(Media(geolocation_id=with_video.id, storage_url="s3://x/v.mp4", media_type="video"))
    demo = _make_geo(db, author=author, lat=42.0, lng=42.0)
    demo.is_demo = True

    trusted = User(
        username=f"tr{uuid.uuid4().hex[:8]}",
        email=f"tr-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_trusted=True,
        trust_reason="verified",
    )
    db.add(trusted)
    db.commit()
    by_trusted = _make_geo(db, author=trusted, lat=43.0, lng=43.0)

    def ids(query: str) -> set[str]:
        return {row[0] for row in client.get(f"/api/v1/geolocations/points{query}").json()}

    media_ids = ids("?media=video")
    assert str(with_video.id) in media_ids
    assert str(plain.id) not in media_ids

    trusted_ids = ids("?trusted_only=true")
    assert str(by_trusted.id) in trusted_ids
    assert str(plain.id) not in trusted_ids

    nodemo_ids = ids("?hide_demo=true")
    assert str(plain.id) in nodemo_ids
    assert str(demo.id) not in nodemo_ids

    # A junk media value is rejected (422), not silently treated as "no match".
    assert client.get("/api/v1/geolocations/points?media=bogus").status_code == 422

    # ``by_trusted`` belongs to a user the ``author`` fixture won't clean up.
    db.query(Geolocation).filter(Geolocation.author_id == trusted.id).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id == trusted.id).delete(synchronize_session=False)
    db.commit()


def test_points_cache_key_builder_is_separator_safe():
    """Filter values carrying the legacy ``:`` separator must not collide.

    The previous key shape (``f"points:{conflict}:{tag}:..."``) folded
    ``conflict=["a:b"], tag=None`` and ``conflict=["a"], tag=["b"]`` onto
    the same string, so the second request silently served the first
    request's cached payload. The hashed builder serialises the tuple
    via ``orjson`` before the hash, so colon-bearing inputs land in
    distinct keys.
    """
    from app.routers.geolocations import _build_points_cache_key

    colliding_a = _build_points_cache_key(
        conflict=["a:b"],
        capture_source=None,
        tag=None,
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    colliding_b = _build_points_cache_key(
        conflict=["a"],
        capture_source=None,
        tag=["b"],
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert colliding_a != colliding_b, "colon-bearing inputs must produce distinct keys"

    # Same inputs → same key. Locks in cache-hit behaviour after the
    # builder swap so a regression doesn't silently turn every request
    # into a MISS.
    same_a = _build_points_cache_key(
        conflict=["ukraine"],
        capture_source=None,
        tag=None,
        event_date_from="2024-01-01",
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    same_b = _build_points_cache_key(
        conflict=["ukraine"],
        capture_source=None,
        tag=None,
        event_date_from="2024-01-01",
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert same_a == same_b, "identical filter tuples must produce the same key"

    # capture_source participates in the key — two filter sets that
    # differ only by capture_source must not collide (guards against the
    # new bucket being dropped from the hashed payload).
    cs_a = _build_points_cache_key(
        conflict=None,
        capture_source=["Satellite"],
        tag=None,
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    cs_b = _build_points_cache_key(
        conflict=None,
        capture_source=["Drone"],
        tag=None,
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert cs_a != cs_b, "capture_source must participate in the cache key"


@pytest.mark.parametrize(
    "bucket",
    ["conflict", "capture_source", "tag"],
    ids=["conflict-list", "capture-source-list", "tag-list"],
)
def test_points_cache_key_is_list_order_insensitive(bucket):
    """``?bucket=a&bucket=b`` and ``?bucket=b&bucket=a`` describe the same filter.

    The user can click the chips in either order; we sort each list
    inside the cache-key builder so both clicks hit the same cache
    entry. Without this, the second click would always MISS and re-run
    the query for what is logically the same filter set. Every list
    bucket needs the same guarantee — parametrised so a future refactor
    that sorts one but forgets another can't slip past CI.
    """
    from app.routers.geolocations import _build_points_cache_key

    buckets = ("conflict", "capture_source", "tag")
    forward = _build_points_cache_key(
        **{bucket: ["alpha", "beta"]},
        **{other: None for other in buckets if other != bucket},
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    reverse = _build_points_cache_key(
        **{bucket: ["beta", "alpha"]},
        **{other: None for other in buckets if other != bucket},
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert forward == reverse


def test_points_or_within_free_tag_list(db, author):
    """Multiple ``?tag=`` values match geos carrying ANY listed tag.

    OR semantics within the list — clicking ``drone`` and ``tank`` on
    the map filter should surface every geo tagged drone OR tank, not
    the (much smaller) set that carries both.
    """
    tag_a = Tag(name=f"a-{uuid.uuid4().hex[:8]}", category="free")
    tag_b = Tag(name=f"b-{uuid.uuid4().hex[:8]}", category="free")
    db.add_all([tag_a, tag_b])
    db.commit()

    geo_a = _make_geo(db, author=author, tags=[tag_a])
    geo_b = _make_geo(db, author=author, tags=[tag_b])
    geo_none = _make_geo(db, author=author)

    try:
        response = client.get(f"/api/v1/geolocations/points?tag={tag_a.name}&tag={tag_b.name}")
        assert response.status_code == 200
        ids = {row[0] for row in response.json()}
        assert str(geo_a.id) in ids
        assert str(geo_b.id) in ids
        assert str(geo_none.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id.in_([tag_a.id, tag_b.id])))
        db.commit()


def test_points_or_within_conflict_list(db, author):
    """Multiple ``?conflict=`` values match geos in ANY listed conflict.

    Same OR-within story as free tags. Conflict matching additionally
    requires the matched tag's ``category == "conflict"`` so a free
    tag named "Ukraine" can't poison the result.
    """
    conflict_a = Tag(name=f"ca-{uuid.uuid4().hex[:8]}", category="conflict")
    conflict_b = Tag(name=f"cb-{uuid.uuid4().hex[:8]}", category="conflict")
    free_same_name = Tag(name=conflict_a.name + "-free", category="free")
    db.add_all([conflict_a, conflict_b, free_same_name])
    db.commit()

    geo_a = _make_geo(db, author=author, tags=[conflict_a])
    geo_b = _make_geo(db, author=author, tags=[conflict_b])
    geo_none = _make_geo(db, author=author, tags=[free_same_name])

    try:
        response = client.get(
            f"/api/v1/geolocations/points?conflict={conflict_a.name}&conflict={conflict_b.name}"
        )
        assert response.status_code == 200
        ids = {row[0] for row in response.json()}
        assert str(geo_a.id) in ids
        assert str(geo_b.id) in ids
        assert str(geo_none.id) not in ids
    finally:
        db.execute(
            Tag.__table__.delete().where(
                Tag.id.in_([conflict_a.id, conflict_b.id, free_same_name.id])
            )
        )
        db.commit()


def test_points_and_across_conflict_and_tag(db, author):
    """``?conflict=X&tag=Y`` returns the intersection.

    A geo needs at least one conflict tag in the conflict list AND at
    least one free tag in the tag list. Without the AND-across-categories
    rule, the filter would degrade into a union and surface noise the
    analyst didn't ask for.
    """
    conflict = Tag(name=f"conf-{uuid.uuid4().hex[:8]}", category="conflict")
    free = Tag(name=f"free-{uuid.uuid4().hex[:8]}", category="free")
    db.add_all([conflict, free])
    db.commit()

    matching = _make_geo(db, author=author, tags=[conflict, free])
    conflict_only = _make_geo(db, author=author, tags=[conflict])
    free_only = _make_geo(db, author=author, tags=[free])

    try:
        response = client.get(
            f"/api/v1/geolocations/points?conflict={conflict.name}&tag={free.name}"
        )
        assert response.status_code == 200
        ids = {row[0] for row in response.json()}
        assert str(matching.id) in ids
        assert str(conflict_only.id) not in ids
        assert str(free_only.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id.in_([conflict.id, free.id])))
        db.commit()


def test_points_single_tag_value_back_compat(db, author, free_tag):
    """``?tag=X`` (single value, no second occurrence) still works.

    The deployed frontend on v0.1.0 sends a single tag. FastAPI parses
    that into ``["X"]`` and the new list-shaped filter handles it the
    same way the single-value branch used to.
    """
    geo = _make_geo(db, author=author, tags=[free_tag])
    _make_geo(db, author=author)

    response = client.get(f"/api/v1/geolocations/points?tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row[0] for row in response.json()}
    assert str(geo.id) in ids


# ── bbox validation (422 on malformed) ────────────────────────────────────


def test_bbox_well_formed_does_not_422():
    response = client.get("/api/v1/geolocations?bbox=44.0,30.0,46.0,32.0")
    assert response.status_code == 200


def test_bbox_wrong_count_returns_422():
    # Empty string is treated as "filter omitted" by the `if bbox:` guard.
    for bad in ["1,2,3", "1,2,3,4,5", "1"]:
        response = client.get(f"/api/v1/geolocations?bbox={bad}")
        assert response.status_code == 422, f"expected 422 for bbox={bad!r}"


def test_bbox_non_numeric_returns_422():
    response = client.get("/api/v1/geolocations?bbox=foo,bar,baz,qux")
    assert response.status_code == 422


def test_bbox_latitude_out_of_range_returns_422():
    response = client.get("/api/v1/geolocations?bbox=95.0,0.0,96.0,1.0")
    assert response.status_code == 422


def test_bbox_longitude_out_of_range_returns_422():
    response = client.get("/api/v1/geolocations?bbox=0.0,200.0,1.0,201.0")
    assert response.status_code == 422


def test_bbox_inverted_north_south_returns_422():
    response = client.get("/api/v1/geolocations?bbox=46.0,30.0,44.0,32.0")
    assert response.status_code == 422


def test_bbox_inverted_east_west_returns_422():
    response = client.get("/api/v1/geolocations?bbox=44.0,32.0,46.0,30.0")
    assert response.status_code == 422


def test_no_bbox_returns_200():
    response = client.get("/api/v1/geolocations")
    assert response.status_code == 200


# ── DELETE /geolocations/{id} ─────────────────────────────────────────────


def test_delete_requires_authentication(db, author):
    geo = _make_geo(db, author=author)
    response = client.delete(f"/api/v1/geolocations/{geo.id}")
    assert response.status_code == 401


def test_delete_returns_404_for_unknown_id(author):
    response = client.delete(
        f"/api/v1/geolocations/{uuid.uuid4()}", headers=login_as(client, author)
    )
    assert response.status_code == 404


def test_delete_returns_404_for_soft_deleted(db, author):
    """Admin already removed it; the author sees the same 404 surface.

    Same observed behaviour as an unknown id — the author can't infer
    that "an admin reached in and removed this," only that the row is
    gone from their perspective.
    """
    geo = _make_geo(db, author=author, deleted=True)
    response = client.delete(f"/api/v1/geolocations/{geo.id}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_403_when_not_author(db, author, second_user):
    geo = _make_geo(db, author=author)
    response = client.delete(
        f"/api/v1/geolocations/{geo.id}", headers=login_as(client, second_user)
    )
    assert response.status_code == 403


def test_delete_succeeds_for_author_and_removes_row(db, author):
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    response = client.delete(f"/api/v1/geolocations/{geo_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == geo_id).first() is None


def test_delete_invalidates_points_cache(db, author):
    """The map gets stale instantly when the author drops a row.

    Without this, anyone holding a cached `/points` response would see
    the deleted row's marker for up to the cache TTL.
    """
    geo = _make_geo(db, author=author)
    # Warm the cache
    first = client.get("/api/v1/geolocations/points")
    assert first.headers.get("x-cache") == "MISS"
    warm = client.get("/api/v1/geolocations/points")
    assert warm.headers.get("x-cache") == "HIT"

    client.delete(f"/api/v1/geolocations/{geo.id}", headers=login_as(client, author))

    # After delete the cache must be cold again
    after = client.get("/api/v1/geolocations/points")
    assert after.headers.get("x-cache") == "MISS", "delete must invalidate the points cache"


# ── POST /geolocations — auth + validation paths ──────────────────────────


def test_create_requires_authentication():
    """Anon POST short-circuits in the dependency before file parsing."""
    response = client.post("/api/v1/geolocations")
    assert response.status_code == 401


def test_create_rejects_missing_files(author):
    """Empty multipart with no files → handler 400.

    The `files: list[UploadFile] = File(...)` signature requires at
    least one file in the multipart body; FastAPI rejects the request
    with 422 before the handler runs.
    """
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
        },
    )
    # FastAPI's `File(...)` requirement triggers 422 (validation), not
    # the handler's own 400. Either is acceptable as "rejected"; we
    # assert the contract loosely.
    assert response.status_code in (400, 422)


def test_create_rejects_invalid_latitude(author):
    """Out-of-range coord is rejected by the handler before any upload.

    Important property: this 400 fires *before* `await upload_file()`
    so a malformed coord can never strand half-written S3 objects.
    """
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "95.0",  # invalid
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_coordinates"
    assert "Latitude" in detail["message"]


def test_create_rejects_invalid_event_date(author):
    """``event_date='not-a-date'`` returns a clean 422 before any S3
    round-trip. Before the fix the raw string flowed through to a
    ``Mapped[date]`` column and 500'd at flush time — AFTER the files
    had already been uploaded. 422 matches the ``_parse_filter_date``
    / ``_parse_bbox`` shape so all malformed-input rejections on this
    router share one status code."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "not-a-date",
        },
        files=files,
    )
    assert response.status_code == 422
    assert "event_date" in response.json()["detail"].lower()


def test_list_rejects_malformed_date_filter(author):
    """``submitted_to=not-a-date`` returns 422, NOT a 500. Before the
    fix the raw string was concatenated with ``' 23:59:59'`` and
    handed to Postgres, which raised ``InvalidDatetimeFormat`` and
    surfaced as a 500. ``/points`` will be anonymous-reachable once read
    endpoints open, so this is a Sentry-noise + abuse-amplifier vector."""
    response = client.get(
        "/api/v1/geolocations/points?submitted_to=not-a-date",
        headers=login_as(client, author),
    )
    assert response.status_code == 422


def test_create_rejects_too_many_files(author):
    """A multipart with more than ``MAX_FILES_PER_GEOLOCATION`` files is
    rejected before any upload. Without the cap, one submit can pin the
    worker through Pillow + derivative + S3 work for hundreds of files
    in a single request."""
    # 13 small jpegs > the cap of 12.
    files = [("files", (f"tiny-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(13)]
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
        },
        files=files,
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "too_many_files"
    assert "files per submission" in detail["message"]


def test_create_rejects_disallowed_file_type(author, conflict_tag, capture_source_tag):
    """A file with a MIME type outside `ALLOWED_TYPES` is rejected with the
    typed `invalid_file` envelope BEFORE any S3 IO. Passes the required
    tags so the request reaches the file-validate loop in the service —
    without them, the earlier tag-categories guard fires first and the
    test exercises the wrong code path."""
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        },
        files={"files": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_file"
    assert "not allowed" in detail["message"].lower()


def test_create_rejects_invalid_proof_json(author):
    """Invalid Tiptap proof JSON → 400 before any S3 upload."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "proof": "{not valid json",
        },
        files=files,
    )
    assert response.status_code == 400
    assert "proof" in response.json()["detail"].lower()


# ── POST /geolocations — required tag categories ──────────────────────────


def test_create_rejects_no_tags(author):
    """No tags at all → 400. Conflict is checked first, before any upload."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_missing_conflict_tag(author, capture_source_tag):
    """A capture-source tag without a conflict tag → 400."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "tag_ids": json.dumps([str(capture_source_tag.id)]),
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_missing_capture_source_tag(author, conflict_tag):
    """A conflict tag without a capture-source tag → 400."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "tag_ids": json.dumps([str(conflict_tag.id)]),
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "capture source" in detail["message"].lower()


def test_create_rejects_free_tag_only(author, free_tag):
    """A free tag alone satisfies neither required category → 400.

    Guards against the resolved-category check being fooled by *any*
    tag being present — it has to be the right categories.
    """
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "tag_ids": json.dumps([str(free_tag.id)]),
        },
        files=files,
    )
    assert response.status_code == 400


def test_create_succeeds_with_both_required_tags(
    db, author, conflict_tag, capture_source_tag, tmp_path, monkeypatch
):
    """Conflict + capture-source present → 201, both tags land on the row."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "valid create",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        },
        files={"files": ("ok.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    categories = {t["category"] for t in body["tags"]}
    assert {"conflict", "capture_source"} <= categories


def test_create_accepts_optional_source_date(
    db, author, conflict_tag, capture_source_tag, tmp_path, monkeypatch
):
    """``source_date`` is optional: supplied → round-trips on the read model;
    omitted → the row's source_date is null."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    base = {
        "title": "with source date",
        "lat": "48.5",
        "lng": "34.5",
        "source_url": "https://t.me/c/1",
        "event_date": "2026-05-01",
        "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
    }

    with_date = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={**base, "source_date": "2026-05-03"},
        files={"files": ("ok.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert with_date.status_code == 201, with_date.text
    assert with_date.json()["source_date"] == "2026-05-03"

    without = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data=base,
        files={"files": ("ok.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert without.status_code == 201, without.text
    assert without.json()["source_date"] is None


def test_create_rejects_invalid_source_date(author):
    """Garbage ``source_date`` → 422 before any S3 round-trip (same contract
    as ``event_date``)."""
    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_date": "not-a-date",
        },
        files={"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 422
    assert "source_date" in response.json()["detail"].lower()


# ── POST /geolocations/proof-images — sha256 contract ──────────────────────


def test_proof_image_upload_persists_sha256_and_provenance(db, author):
    """Inline-proof image upload captures sha256 + provenance on the row."""
    response = client.post(
        "/api/v1/geolocations/proof-images",
        headers=login_as(client, author),
        files={"file": ("p.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert isinstance(body["sha256"], str)
    assert len(body["sha256"]) == 64
    assert "url" in body

    # Find the row by response sha256 (the EXIF strip re-encodes so we
    # can't predict it from the input). The response hash equals the
    # row hash — that's the consistency invariant.
    row = (
        db.query(ProofImage)
        .filter(ProofImage.user_id == author.id, ProofImage.sha256 == body["sha256"])
        .order_by(ProofImage.created_at.desc())
        .first()
    )
    assert row is not None, "proof_image row missing or sha256 not persisted"
    assert row.sha256 == body["sha256"]

    # Provenance fields landed.
    assert row.original_filename == "p.jpg"
    # 'testclient' isn't a parseable IP → NULL is the correct fail-safe.
    assert row.uploaded_ip is None
    assert row.uploaded_user_agent is not None

    # Clean up the row + reset the per-user 24h ceiling for other tests.
    db.query(ProofImage).filter(ProofImage.id == row.id).delete(synchronize_session=False)
    db.commit()


def test_proof_image_upload_rejects_corrupt_image(db, author):
    """A 4-byte stub that's the right MIME but not a real JPEG → 400.

    Pillow's EXIF-strip pre-decode catches truncated / malformed
    images before they reach S3, so we surface the failure as 400
    rather than letting half-written objects strand.
    """
    response = client.post(
        "/api/v1/geolocations/proof-images",
        headers=login_as(client, author),
        files={"file": ("bad.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert response.status_code == 400
    assert "decode" in response.json()["detail"].lower()


def test_create_geolocation_cleans_up_s3_on_mid_batch_failure(
    db, author, conflict_tag, capture_source_tag, tmp_path, monkeypatch
):
    """Mid-batch upload failure must not strand orphan S3 objects.

    File #1 uploads successfully, file #2 is a corrupt JPEG that the
    EXIF-strip pre-pass rejects with a 400. Without cleanup the
    transaction rolls back and file #1 sits in S3 forever with no
    DB row pointing at it. With cleanup, the just-uploaded key is
    swept via `Storage.delete_many` before the exception bubbles.

    Passes the two required tags (conflict + capture source) so the
    request reaches the upload stage — without them the new required-
    category guard would 400 *before* any upload and the test would
    pass vacuously, exercising none of the cleanup path it's here for.

    Uses local storage so we can inspect the filesystem directly.
    """
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/geolocations",
        headers=login_as(client, author),
        data={
            "title": "orphan cleanup test",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        },
        files=[
            ("files", ("ok.jpg", TINY_JPEG, "image/jpeg")),
            ("files", ("bad.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")),
        ],
    )
    # The bad file fails EXIF-strip → 400 typed-error envelope from the service.
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "evidence_processing_failed"
    assert detail["message"]  # non-empty Pillow / strip_metadata message

    # Crucial invariant: no .jpg files were left behind on disk.
    uploads_dir = tmp_path / "uploads"
    if uploads_dir.exists():
        leaked = list(uploads_dir.rglob("*.jpg"))
        assert leaked == [], (
            f"S3 orphans after rolled-back create: {leaked}. The mid-batch "
            f"cleanup block in routers/geolocations.py::create_geolocation "
            f"failed to sweep them."
        )

    # And no Geolocation / Media rows committed.
    assert db.query(Geolocation).filter(Geolocation.author_id == author.id).count() == 0


# ── GET /geolocations/possible-duplicates ─────────────────────────────────


def _make_geo_with_source(
    db,
    *,
    author: User,
    lat: float,
    lng: float,
    source_url: str,
    event_date_value: date,
) -> Geolocation:
    """Constructor wrapper that lets the duplicate-probe tests pin the
    source URL and event date. ``_make_geo`` defaults both to fixed
    values that don't exercise the host / date match legs."""
    geo = Geolocation(
        author_id=author.id,
        title=f"Geo {uuid.uuid4().hex[:8]}",
        location=from_shape(Point(lng, lat), srid=4326),
        source_url=source_url,
        event_date=event_date_value,
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)
    return geo


def test_possible_duplicates_requires_auth():
    """Anonymous callers get 401 — the proximity probe is a cheap
    sidestep of the bbox-required /points hardening, so it stays
    behind the cookie."""
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.5,
            "lng": 34.5,
            "source_url": "https://example.com/x",
            "event_date": "2026-05-01",
        },
    )
    assert response.status_code == 401


def test_possible_duplicates_returns_host_match(db, author):
    """Nearby geolocation whose source URL host matches the caller's
    is surfaced. Distance-from-caller is rendered as ``distance_m``."""
    target = _make_geo_with_source(
        db,
        author=author,
        lat=48.50000,
        lng=34.50000,
        source_url="https://t.me/somechannel/12345",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50050,  # ~55 m north — comfortably inside 500 m
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/99999",  # same host
            "event_date": "2025-01-01",  # no date match → host leg only
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert any(hit["id"] == str(target.id) for hit in body), (
        f"host match should surface the nearby geo; got {body}"
    )
    hit = next(h for h in body if h["id"] == str(target.id))
    assert hit["distance_m"] >= 0
    assert hit["distance_m"] < 200, (
        f"two coords ~55 m apart should report a small distance, got {hit['distance_m']}"
    )


def test_possible_duplicates_returns_date_match(db, author):
    """Nearby geolocation with the same event date but a different
    source host is surfaced via the date leg."""
    target = _make_geo_with_source(
        db,
        author=author,
        lat=48.50000,
        lng=34.50000,
        source_url="https://t.me/somechannel/12345",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50050,
            "lng": 34.50000,
            "source_url": "https://twitter.com/x/status/9",  # different host
            "event_date": "2026-05-01",  # same date → date leg matches
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert any(hit["id"] == str(target.id) for hit in body)


def test_possible_duplicates_excludes_distant_rows(db, author):
    """Geo > 500 m away is not surfaced even when host + date match.

    Locks the proximity leg in — without it the endpoint would
    degenerate into "every geo this analyst ever submitted that
    happens to share a host", which is useless on a soft-warning
    surface that lists every candidate inline.
    """
    distant = _make_geo_with_source(
        db,
        author=author,
        lat=49.00000,  # ~55 km north of the probe point
        lng=34.50000,
        source_url="https://t.me/somechannel/12345",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50000,
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/99999",
            "event_date": "2026-05-01",
        },
    )
    assert response.status_code == 200
    # Tighter than ``== []``: assert this *specific* distant row is
    # absent. If a previously-seeded demo geolocation happens to sit
    # inside the 500 m radius AND share the source host or the
    # event_date, the response can legitimately be non-empty without
    # invalidating the invariant under test.
    ids = {hit["id"] for hit in response.json()}
    assert str(distant.id) not in ids, (
        "distant geo must not surface even with both match legs satisfied"
    )


def test_possible_duplicates_rejects_like_meta_characters_in_host(db, author):
    """The host extractor's `[a-z0-9.-]+` whitelist disarms LIKE-meta
    characters before the host reaches the ILIKE substring match.
    Without the whitelist, ``source_url=https://%.com/x`` would
    extract ``%.com`` and `ILIKE '%%.com%'` would match every row
    whose stored ``source_url`` happens to contain ``.com``.

    Regression test for the central safety claim in the endpoint's
    docstring and the CHANGELOG entry — a future commit loosening
    `_HOST_SAFE_PATTERN` (e.g. accidentally allowing `_`) would slip
    past CI silently without this test.
    """
    unrelated = _make_geo_with_source(
        db,
        author=author,
        lat=48.50000,
        lng=34.50000,
        source_url="https://twitter.com/foo",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50050,
            "lng": 34.50000,
            # Host carrying a LIKE wildcard. With the whitelist
            # active, ``_extract_host`` returns None → host leg is
            # dropped → only the date leg fires, and we pass a date
            # that doesn't match either → empty response. Without
            # the whitelist, ``%.com`` would substring-match
            # ``twitter.com`` and surface the unrelated row.
            "source_url": "https://%.com/x",
            "event_date": "2025-01-01",
        },
    )
    assert response.status_code == 200
    ids = {hit["id"] for hit in response.json()}
    assert str(unrelated.id) not in ids, "LIKE-wildcard in host must not surface unrelated rows"


def test_possible_duplicates_excludes_soft_deleted(db, author):
    geo = _make_geo_with_source(
        db,
        author=author,
        lat=48.50000,
        lng=34.50000,
        source_url="https://t.me/somechannel/12345",
        event_date_value=date(2026, 5, 1),
    )
    geo.deleted_at = datetime.now(UTC)
    db.commit()
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50050,
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/99999",
            "event_date": "2026-05-01",
        },
    )
    assert response.status_code == 200
    ids = {hit["id"] for hit in response.json()}
    assert str(geo.id) not in ids


def test_possible_duplicates_returns_empty_without_either_leg(db, author):
    """No source URL AND no event date → no usable match leg →
    empty list. The frontend calls eagerly while fields are being
    typed, so this contract spares an obviously-empty round trip."""
    _make_geo_with_source(
        db,
        author=author,
        lat=48.50000,
        lng=34.50000,
        source_url="https://t.me/somechannel/12345",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={"lat": 48.50000, "lng": 34.50000},
    )
    assert response.status_code == 200
    assert response.json() == []


def test_possible_duplicates_tolerates_partial_source_url(db, author):
    """Mid-form pastes like ``t.me/channel/123`` (no scheme) still
    yield a usable host. The frontend can't promise a well-formed URL
    while the user is still typing — the endpoint normalises silently
    rather than 422-ing."""
    target = _make_geo_with_source(
        db,
        author=author,
        lat=48.50000,
        lng=34.50000,
        source_url="https://t.me/somechannel/12345",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50050,
            "lng": 34.50000,
            "source_url": "t.me/somechannel/9999",  # no scheme
            "event_date": "2025-01-01",  # forces host-leg-only
        },
    )
    assert response.status_code == 200
    ids = {hit["id"] for hit in response.json()}
    assert str(target.id) in ids


def test_possible_duplicates_orders_by_distance(db, author):
    """Closer candidates come first — the UI relies on this to put
    the most plausibly-duplicate row at the top of the warning."""
    far = _make_geo_with_source(
        db,
        author=author,
        lat=48.50300,  # ~330 m north
        lng=34.50000,
        source_url="https://t.me/somechannel/aaa",
        event_date_value=date(2026, 5, 1),
    )
    near = _make_geo_with_source(
        db,
        author=author,
        lat=48.50050,  # ~55 m north
        lng=34.50000,
        source_url="https://t.me/somechannel/bbb",
        event_date_value=date(2026, 5, 1),
    )
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/possible-duplicates",
        params={
            "lat": 48.50000,
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/ccc",
            "event_date": "2026-05-01",
        },
    )
    assert response.status_code == 200
    body = response.json()
    # Two-stage assertion so a seeded-demo bleed (the LIMIT 10 cutting
    # `near` off the response entirely) surfaces as "row absent" rather
    # than as a confusing ordering mismatch. The "both present" line
    # guards against silently testing ordering on a single-row list.
    present = {hit["id"] for hit in body}
    assert str(near.id) in present, f"near row missing from response: {body}"
    assert str(far.id) in present, f"far row missing from response: {body}"
    target_ids = [hit["id"] for hit in body if hit["id"] in {str(far.id), str(near.id)}]
    assert target_ids == [str(near.id), str(far.id)], f"expected near before far; got {target_ids}"


# ── POST /geolocations/import-from-tweet ──────────────────────────────────


def _stub_parse_tweet(monkeypatch, *, returns=None, raises=None, detections=None):
    """Replace ``parse_tweet`` + ``preview_detection`` on the router module.

    Routes call both for ``import-from-tweet`` (the human pre-fill and the
    machine preview over the same cached tweet), so both are patched at the
    router module's binding to keep the test off the network.
    """
    from app.routers import geolocations as geolocations_router

    def fake(url, *, client=None):
        if raises is not None:
            raise raises
        return returns

    def fake_preview(url, *, client=None):
        if raises is not None:
            raise raises
        return detections or []

    monkeypatch.setattr(geolocations_router, "parse_tweet", fake)
    monkeypatch.setattr(geolocations_router, "preview_detection", fake_preview)


def test_import_from_tweet_requires_auth():
    response = client.post(
        "/api/v1/geolocations/import-from-tweet",
        json={"url": "https://x.com/handle/status/1234567890"},
    )
    assert response.status_code == 401


def test_import_from_tweet_returns_parsed_payload(author, monkeypatch):
    from app.services.tweet_ingest import ParsedCoord, ParsedMedia, ParsedTweet

    _stub_parse_tweet(
        monkeypatch,
        returns=ParsedTweet(
            source_url="https://x.com/handle/status/1234567890",
            original_tweet_url="https://x.com/handle/status/1234567890",
            posted_at="2025-11-12T14:33:00.000Z",
            author_handle="handle",
            tweet_text="Strike at 48.012345, 37.802411",
            suggested_title="Strike at 48.012345, 37.802411",
            parsed_coords=[ParsedCoord(lat=48.012345, lng=37.802411)],
            media=[
                ParsedMedia(
                    kind="image",
                    remote_url="https://pbs.twimg.com/media/foo.jpg",
                    content_type="image/jpeg",
                    origin="op",
                )
            ],
            quoted_tweet=None,
        ),
    )
    response = client.post(
        "/api/v1/geolocations/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/1234567890"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source_url"] == "https://x.com/handle/status/1234567890"
    assert body["author_handle"] == "handle"
    assert body["suggested_title"].startswith("Strike")
    assert body["parsed_coords"] == [{"lat": 48.012345, "lng": 37.802411}]
    assert body["media"][0]["remote_url"].startswith("https://pbs.twimg.com/")


def test_import_from_tweet_surfaces_detection_preview_without_persisting(author, monkeypatch, db):
    from app.services.tweet_ingest import DetectedGeoloc, ParsedCoord, ParsedMedia, ParsedTweet

    before = db.query(Geolocation).count()
    _stub_parse_tweet(
        monkeypatch,
        returns=ParsedTweet(
            source_url="https://x.com/handle/status/1",
            original_tweet_url="https://x.com/handle/status/1",
            posted_at="2025-11-12T14:33:00.000Z",
            author_handle="handle",
            tweet_text="Strike at 48.012345, 37.802411",
            suggested_title="Strike",
            parsed_coords=[],
            media=[],
            quoted_tweet=None,
        ),
        detections=[
            DetectedGeoloc(
                coordinate=ParsedCoord(lat=48.012345, lng=37.802411),
                title="Strike",
                proof_text="Strike",
                detected_from_url="https://x.com/handle/status/1",
                owner_handle="handle",
                event_date=date(2025, 11, 12),
                media=[
                    ParsedMedia(
                        kind="image",
                        remote_url="https://pbs.twimg.com/media/x.jpg",
                        content_type="image/jpeg",
                    )
                ],
            )
        ],
    )
    response = client.post(
        "/api/v1/geolocations/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/1"},
    )
    assert response.status_code == 200, response.text
    detected = response.json()["detected"]
    assert len(detected) == 1
    assert detected[0]["lat"] == 48.012345
    assert detected[0]["detected_from_url"] == "https://x.com/handle/status/1"
    assert detected[0]["media"][0]["remote_url"].startswith("https://pbs.twimg.com/")
    # The preview never persists — the strongest no-write guard.
    assert db.query(Geolocation).count() == before


def test_import_from_tweet_returns_400_for_invalid_url(author, monkeypatch):
    from app.services.tweet_ingest import InvalidTweetUrl

    _stub_parse_tweet(monkeypatch, raises=InvalidTweetUrl("Not a tweet URL"))
    response = client.post(
        "/api/v1/geolocations/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://example.com"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Not a tweet URL"


def test_import_from_tweet_returns_404_for_inaccessible_tweet(author, monkeypatch):
    from app.services.tweet_ingest import TweetNotAccessible

    _stub_parse_tweet(monkeypatch, raises=TweetNotAccessible("Tweet not accessible"))
    response = client.post(
        "/api/v1/geolocations/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/9999999999"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Tweet not accessible"


def test_import_from_tweet_returns_502_on_syndication_failure(author, monkeypatch):
    from app.services.tweet_ingest import TweetFetchFailed

    _stub_parse_tweet(monkeypatch, raises=TweetFetchFailed("upstream timeout"))
    response = client.post(
        "/api/v1/geolocations/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/1234567890"},
    )
    assert response.status_code == 502
    # The graceful banner string the frontend renders verbatim — the
    # transport detail is hidden behind it so a syndication outage and
    # a schema-drift bug are operationally identical to the caller.
    assert response.json()["detail"] == "Couldn't read tweet — fill the form manually"


# ── GET /geolocations/import-from-tweet/media ─────────────────────────────


def test_import_from_tweet_media_requires_auth():
    response = client.get(
        "/api/v1/geolocations/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 401


def test_import_from_tweet_media_rejects_non_twitter_host(author):
    """SSRF guard: only ``pbs.twimg.com`` / ``video.twimg.com`` are
    fetchable through the proxy."""
    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/import-from-tweet/media",
        params={"u": "https://evil.example.com/foo.jpg"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "URL host not allowed"


def test_import_from_tweet_media_aborts_above_size_cap(author, monkeypatch):
    """A hostile / buggy upstream that streams past the cap must be
    rejected mid-stream — not allowed to OOM the worker by buffering
    the full body and then checking the size.

    Patches ``httpx.stream`` with a mock that yields chunks summing to
    well past the cap. The mock counts how many bytes it actually
    emitted; the assert checks the route consumed less than the full
    body (i.e. the streaming abort fired). Without the byte-counter
    check, the previous buffered implementation would *also* pass
    this test — the cap check would just run after the full body
    landed, hiding the regression we're guarding against.
    """
    import httpx

    from app.routers import geolocations as geolocations_router

    cap = geolocations_router._MEDIA_PROXY_MAX_BYTES
    chunk_size = max(1, cap // 4)
    # Total body is 10× the cap so a buffered implementation would
    # land all of it in memory before the size check fires.
    total_body = cap * 10
    yielded_bytes = 0

    class _MockStream:
        status_code = 200
        headers = {"content-type": "video/mp4"}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def iter_bytes(self):
            nonlocal yielded_bytes
            remaining = total_body
            while remaining > 0:
                step = min(chunk_size, remaining)
                yielded_bytes += step
                yield b"\x00" * step
                remaining -= step

    monkeypatch.setattr(httpx, "stream", lambda *a, **kw: _MockStream())

    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Media exceeded size cap"
    # The crux: the loop must have stopped early, not consumed the
    # full body. ``cap + chunk_size`` is the worst case under correct
    # streaming behaviour (cap detected on the chunk that crosses
    # it). Anything close to ``total_body`` means the route reverted
    # to the buffered-then-check anti-pattern.
    assert yielded_bytes < total_body, (
        f"route consumed the full {total_body}-byte body before bailing — streaming abort regressed"
    )
    assert yielded_bytes <= cap + chunk_size, (
        f"route consumed {yielded_bytes} bytes; expected ≤ {cap + chunk_size} "
        f"(cap + one chunk to detect the overrun)"
    )


def test_import_from_tweet_media_rejects_giant_content_length_upfront(author, monkeypatch):
    """Advertised ``Content-Length`` over the cap → 502 without opening
    the body stream (cheap pre-check)."""
    import httpx

    from app.routers import geolocations as geolocations_router

    cap = geolocations_router._MEDIA_PROXY_MAX_BYTES

    class _MockStream:
        status_code = 200
        headers = {"content-type": "video/mp4", "content-length": str(cap + 1)}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def iter_bytes(self):
            raise AssertionError("body stream must not be read after a giant content-length")

    monkeypatch.setattr(httpx, "stream", lambda *a, **kw: _MockStream())

    login_as(client, author)
    response = client.get(
        "/api/v1/geolocations/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Media exceeded size cap"
