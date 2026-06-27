"""Public read surface for `/geolocations`.

List + filters, the compact `/points` payload and its cache discipline, the
`/{id}` detail shape, the `detected`-renders-marked invariant, and `bbox`
validation. Shared fixtures live in `conftest.py`; `client` / `_make_geo` in
`_helpers.py`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.geolocation import STATE_DETECTED, Geolocation
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests.geolocations._helpers import _make_geo, client

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
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
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
    from app.routers.geolocations.read import _build_points_cache_key

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
    from app.routers.geolocations.read import _build_points_cache_key

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
