"""Public read surface for `/geolocations`.

List and filters, `/points` and its cache, detail shape, `bbox` validation.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.conflict import Conflict
from app.models.event import STATUS_DETECTED, STATUS_REQUESTED, Event, EventDetection
from app.models.tag import Tag
from app.services.event_filters import parse_bbox
from tests._fixtures import fake_sha256
from tests.events._helpers import WORLD_BBOX, _make_geo, client

# The parsed twin of ``WORLD_BBOX``, which the cache-key builder keys on.
WORLD_BOUNDS = parse_bbox(WORLD_BBOX)


def test_list_returns_seeded_geolocation(db, author):
    geo = _make_geo(db, author=author)
    response = client.get("/api/v1/events")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(geo.id) in ids


def test_list_excludes_soft_deleted_rows(db, author):
    """Soft-deleted rows never appear on any public read (``deleted_at IS NULL``)."""
    live = _make_geo(db, author=author)
    dead = _make_geo(db, author=author, deleted=True)

    response = client.get("/api/v1/events")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_list_filters_by_free_tag(db, author, free_tag):
    with_tag = _make_geo(db, author=author, tags=[free_tag])
    without_tag = _make_geo(db, author=author)

    response = client.get(f"/api/v1/events?tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_tag.id) in ids
    assert str(without_tag.id) not in ids


def test_list_filters_by_conflict(db, author, conflict):
    with_conflict = _make_geo(db, author=author, conflicts=[conflict])
    other = _make_geo(db, author=author)

    response = client.get(f"/api/v1/events?conflict={conflict.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_conflict.id) in ids
    assert str(other.id) not in ids


def test_list_conflict_filter_does_not_match_free_tag_of_same_name(db, author):
    """A free tag named like a conflict must not match `?conflict=`.

    Conflict filtering joins the `conflicts` referential, never the tags table.
    """
    free = Tag(name=f"clash-{uuid.uuid4().hex[:8]}")
    db.add(free)
    db.commit()
    geo = _make_geo(db, author=author, tags=[free])
    try:
        response = client.get(f"/api/v1/events?conflict={free.name}")
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert str(geo.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id == free.id))
        db.commit()


def test_sensor_filter_matches_any_source_and_ors_within_the_list(db, author):
    """``?sensor=`` keeps an event when any of its sources has a listed sensor."""
    mixed = _make_geo(
        db, author=author, sensor="smartphone", secondary_source_urls=["https://t.me/c/2"]
    )
    drone = _make_geo(db, author=author, sensor="drone")
    satellite = _make_geo(db, author=author, sensor="satellite")

    response = client.get(
        "/api/v1/events", params={"sensor": ["unknown", "drone"], "author": author.username}
    )
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert ids == {str(mixed.id), str(drone.id)}
    assert str(satellite.id) not in ids


def test_level_filter_keeps_events_with_a_source_of_that_level(db, author):
    indirect = _make_geo(db, author=author)
    indirect.sources[0].level = "indirect"
    db.commit()
    direct = _make_geo(db, author=author)

    def ids(levels: list[str]) -> set[str]:
        response = client.get(
            "/api/v1/events/points",
            params={"bbox": WORLD_BBOX, "level": levels, "author": author.username},
        )
        assert response.status_code == 200
        return {row[0] for row in response.json()}

    assert ids(["indirect"]) == {str(indirect.id)}
    assert ids(["direct", "indirect"]) == {str(indirect.id), str(direct.id)}


def test_tag_filter_matches_a_source_tag(db, author, free_tag):
    """``?tag=`` matches a tag on the event or on any of its sources."""
    on_source = _make_geo(db, author=author)
    on_source.sources[0].tags = [free_tag]
    db.commit()
    on_event = _make_geo(db, author=author, tags=[free_tag])
    untagged = _make_geo(db, author=author)

    response = client.get("/api/v1/events", params={"tag": free_tag.name})
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert {str(on_source.id), str(on_event.id)} <= ids
    assert str(untagged.id) not in ids


def test_list_filters_by_author_exact_case_insensitive(db, author):
    """`?author=` matches the username exactly (case-insensitive), not as a fragment."""
    geo = _make_geo(db, author=author)
    response = client.get(f"/api/v1/events?author={author.username.upper()}")
    assert response.status_code == 200
    assert str(geo.id) in {row["id"] for row in response.json()}
    response = client.get(f"/api/v1/events?author={author.username[2:6]}")
    assert response.status_code == 200
    assert str(geo.id) not in {row["id"] for row in response.json()}


def test_list_rejects_author_with_like_meta(author):
    """Junk vectors (`%`, `;`, ...) and over-length input are rejected before the SQL builder."""
    for bad in ("a%", "a\\b", "a;b", "a b", "a'b", "", "a" * 51):
        response = client.get("/api/v1/events", params={"author": bad})
        assert response.status_code == 422, (
            f"expected 422 for author={bad!r}, got {response.status_code}"
        )


def test_points_rejects_author_with_like_meta(author):
    # One ``params=`` dict: httpx replaces the URL query with it, so a query string
    # would drop ``bbox`` and pass on the missing-parameter 422 instead of the guard.
    response = client.get("/api/v1/events/points", params={"bbox": WORLD_BBOX, "author": "a%"})
    assert response.status_code == 422


def test_list_filters_by_event_date_range(db, author):
    early = _make_geo(db, author=author, occurred_date=date(2026, 1, 1))
    mid = _make_geo(db, author=author, occurred_date=date(2026, 6, 1))
    late = _make_geo(db, author=author, occurred_date=date(2026, 12, 1))

    response = client.get(
        "/api/v1/events?occurred_date_from=2026-05-01&occurred_date_to=2026-09-01"
    )
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(mid.id) in ids
    assert str(early.id) not in ids
    assert str(late.id) not in ids


def test_list_filters_by_status(db, author):
    """`?status=` narrows within the view; repeatable, any-match."""
    located = _make_geo(db, author=author)
    detected = _make_geo(db, author=author, status=STATUS_DETECTED)

    response = client.get("/api/v1/events?status=detected")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(detected.id) in ids
    assert str(located.id) not in ids

    response = client.get("/api/v1/events?status=detected&status=geolocated")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(detected.id) in ids
    assert str(located.id) in ids


def test_list_rejects_unknown_status(author):
    """A `?status=` typo returns 422 at the boundary, never a silent empty."""
    response = client.get("/api/v1/events?status=located")
    assert response.status_code == 422


def test_list_filters_by_bbox(db, author):
    inside = _make_geo(db, author=author, lat=48.5, lng=34.5)
    outside = _make_geo(db, author=author, lat=10.0, lng=10.0)

    # Box around Ukraine area, inside=(48.5, 34.5) is inside, (10, 10) is not.
    response = client.get("/api/v1/events?bbox=45.0,30.0,50.0,40.0")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(inside.id) in ids
    assert str(outside.id) not in ids


def test_list_filters_requests_by_location_guess(db, author):
    guessed = _make_geo(db, author=author, status=STATUS_REQUESTED)
    blind = _make_geo(db, author=author, status=STATUS_REQUESTED, lat=None, lng=None)
    base = f"/api/v1/events?view=requested&author={author.username}"

    with_guess = client.get(f"{base}&has_coords=true")
    without_guess = client.get(f"{base}&has_coords=false")
    either = client.get(base)

    assert [row["id"] for row in with_guess.json()] == [str(guessed.id)]
    assert [row["id"] for row in without_guess.json()] == [str(blind.id)]
    assert {row["id"] for row in either.json()} == {str(guessed.id), str(blind.id)}


def test_list_carries_requested_at(db, author):
    request = _make_geo(db, author=author, status=STATUS_REQUESTED)
    geo = _make_geo(db, author=author)

    requested = client.get(f"/api/v1/events?view=requested&author={author.username}").json()
    located = client.get(f"/api/v1/events?author={author.username}").json()

    assert [row["id"] for row in requested] == [str(request.id)]
    assert datetime.fromisoformat(requested[0]["requested_at"]) == request.requested_at
    assert [row["id"] for row in located] == [str(geo.id)]
    assert located[0]["requested_at"] is None


def test_list_honours_limit(db, author):
    """One ``limit`` code path serves both views, so this covers the requested queue too."""
    for _ in range(3):
        _make_geo(db, author=author)
    response = client.get("/api/v1/events?limit=2")
    assert response.status_code == 200
    # Three matching rows seeded, so the cap is exact, not just an upper bound.
    assert len(response.json()) == 2


def test_detail_returns_full_shape(db, author, free_tag):
    geo = _make_geo(db, author=author, lat=48.7, lng=34.7, tags=[free_tag])
    response = client.get(f"/api/v1/events/{geo.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(geo.id)
    assert body["title"] == geo.title
    assert body["coords"]["lat"] == pytest.approx(48.7)
    assert body["coords"]["lng"] == pytest.approx(34.7)
    [source] = body["sources"]
    assert (source["level"], source["sensor"]) == ("direct", "smartphone")
    assert [link["url"] for link in source["links"]] == ["https://example.com/source"]
    assert body["owner"]["username"] == author.username
    # `AuthorRef` field-set guard: the byline renders these fields off this block.
    assert set(body["owner"]) == {
        "id",
        "username",
        "avatar_url",
    }
    assert [g["username"] for g in body["geolocators"]] == []
    assert any(tag["name"] == free_tag.name for tag in body["tags"])


def test_detail_404_for_unknown_id():
    response = client.get(f"/api/v1/events/{uuid.uuid4()}")
    assert response.status_code == 404


def test_detail_404_for_soft_deleted_geo(db, author):
    geo = _make_geo(db, author=author, deleted=True)
    response = client.get(f"/api/v1/events/{geo.id}")
    assert response.status_code == 404, "soft-deleted geo must surface as 404, not the live shape"


def test_points_requires_bbox():
    """No ``bbox``, no payload: a bare ``curl /events/points`` must not return the catalog."""
    response = client.get("/api/v1/events/points")
    assert response.status_code == 422


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "1,2,3",
        "1,2,3,4,5",
        "foo,bar,baz,qux",
        "95.0,0.0,96.0,1.0",
        "0.0,200.0,1.0,201.0",
        "46.0,30.0,44.0,32.0",
        "44.0,32.0,46.0,30.0",
    ],
    ids=[
        "empty",
        "too-few",
        "too-many",
        "non-numeric",
        "latitude-out-of-range",
        "longitude-out-of-range",
        "south-above-north",
        "west-east-of-east",
    ],
)
def test_points_rejects_malformed_bbox(bad):
    """Every ``parse_bbox`` rejection is a 422, an empty ``bbox`` included."""
    response = client.get(f"/api/v1/events/points?bbox={bad}")
    assert response.status_code == 422, f"expected 422 for bbox={bad!r}"


def test_points_filters_by_bbox(db, author):
    """The viewport, not the catalog, decides what comes back."""
    inside = _make_geo(db, author=author, lat=48.5, lng=34.5)
    outside = _make_geo(db, author=author, lat=10.0, lng=10.0)

    response = client.get("/api/v1/events/points?bbox=45.0,30.0,50.0,40.0")
    assert response.status_code == 200
    ids = {row[0] for row in response.json()}
    assert str(inside.id) in ids
    assert str(outside.id) not in ids


def test_points_cache_keys_on_bbox(db, author):
    """Two viewports must not share a cache entry (``bbox`` is part of the key)."""
    _make_geo(db, author=author, lat=48.5, lng=34.5)
    _make_geo(db, author=author, lat=10.0, lng=10.0)

    ukraine = client.get("/api/v1/events/points?bbox=45.0,30.0,50.0,40.0")
    africa = client.get("/api/v1/events/points?bbox=5.0,5.0,15.0,15.0")
    assert ukraine.headers.get("x-cache") == "MISS"
    assert africa.headers.get("x-cache") == "MISS", "a different viewport must MISS"
    assert ukraine.content != africa.content
    assert client.get("/api/v1/events/points?bbox=45.0,30.0,50.0,40.0").headers["x-cache"] == "HIT"


def test_points_cache_hits_across_one_grid_cell(db, author):
    """Two viewports inside one grid cell share a cache entry.

    ``snap_bbox`` grows each box onto the server grid before keying, so client
    jitter cannot evict the LRU.
    """
    _make_geo(db, author=author, lat=48.5, lng=34.5)

    first = client.get("/api/v1/events/points?bbox=45.01,30.01,49.99,39.99")
    second = client.get("/api/v1/events/points?bbox=45.02,30.02,49.98,39.98")
    assert first.headers.get("x-cache") == "MISS"
    assert second.headers.get("x-cache") == "HIT", "same grid cell must share an entry"
    assert first.content == second.content


def test_points_cache_key_covers_bbox():
    """The builder itself separates two boxes under an identical filter set."""
    from app.routers.events.read import _build_points_cache_key

    def key(bbox: tuple[float, float, float, float]) -> str:
        return _build_points_cache_key(
            bbox=bbox,
            conflict=None,
            sensor=None,
            level=None,
            tag=None,
            occurred_date_from=None,
            occurred_date_to=None,
            submitted_from=None,
            submitted_to=None,
            author=None,
        )

    assert key((45.0, 30.0, 50.0, 40.0)) != key((5.0, 5.0, 15.0, 15.0))


def test_points_returns_compact_shape(db, author):
    geo = _make_geo(db, author=author, lat=48.5, lng=34.5)
    response = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert response.status_code == 200
    body = response.json()
    matching = [row for row in body if row[0] == str(geo.id)]
    assert len(matching) == 1
    row = matching[0]
    assert len(row) == 6  # [id, lat, lng, occurred_date, submitted_date, detected]
    assert row[1] == pytest.approx(48.5)
    assert row[2] == pytest.approx(34.5)
    assert row[3] == geo.occurred_date.isoformat()  # ISO YYYY-MM-DD for the timeline
    assert row[4] == geo.created_at.date().isoformat()  # submitted (created_at) day
    assert row[5] == 0  # submitted row → not marked detected


def test_points_null_event_date_serialises_as_null(db, author):
    """A dateless geolocation reaches the map as ``null`` (``.isoformat()`` on None 500ed)."""
    geo = Event(
        owner_id=author.id,
        title="Dateless geo",
        coords=from_shape(Point(34.5, 48.5), srid=4326),
        occurred_date=None,
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)

    response = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert response.status_code == 200
    row = next(r for r in response.json() if r[0] == str(geo.id))
    assert row[3] is None
    assert row[4] == geo.created_at.date().isoformat()


def test_points_excludes_soft_deleted(db, author):
    live = _make_geo(db, author=author)
    dead = _make_geo(db, author=author, deleted=True)
    response = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    ids = {row[0] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_detected_row_renders_marked_across_surfaces(db, author):
    geo = Event(
        owner_id=author.id,
        title="Detected geo",
        coords=from_shape(Point(34.5, 48.5), srid=4326),
        occurred_date=date(2026, 5, 1),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
        detection=EventDetection(from_url="https://x.com/a/status/1"),
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)

    # /points: the compact map payload marks it with the detected flag.
    points = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").json()
    point = next(r for r in points if r[0] == str(geo.id))
    assert point[5] == 1

    # Detail: status + the distinct detected_from_url provenance link.
    detail = client.get(f"/api/v1/events/{geo.id}").json()
    assert detail["status"] == "detected"
    assert detail["detected_from_url"] == "https://x.com/a/status/1"

    # List card: carries status too.
    listing = client.get("/api/v1/events").json()
    item = next(i for i in listing if i["id"] == str(geo.id))
    assert item["status"] == "detected"


def test_points_cache_miss_then_hit(db, author):
    """First call cold, second warm (``X-Cache``); guards against a removed ``points_cache.set``."""
    _make_geo(db, author=author)
    first = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert first.headers.get("x-cache") == "MISS"
    second = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert second.headers.get("x-cache") == "HIT"
    assert first.content == second.content


def test_points_cache_keys_on_filter_combination(db, author, free_tag):
    """Different filter combos must miss independently, not share a cached response."""
    _make_geo(db, author=author, tags=[free_tag])
    _make_geo(db, author=author)

    unfiltered = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    filtered = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}&tag={free_tag.name}")
    assert unfiltered.headers.get("x-cache") == "MISS"
    assert filtered.headers.get("x-cache") == "MISS", "different filter must MISS"
    assert len(filtered.json()) < len(unfiltered.json())


def test_points_filters_media(db, author):
    """``media`` matches a source file or a proof image of that type."""
    from app.models.media import Media

    plain = _make_geo(db, author=author, lat=40.0, lng=40.0)
    with_video = _make_geo(db, author=author, lat=41.0, lng=41.0)
    with_video.sources[0].media = Media(
        sha256=fake_sha256(), storage_url="s3://x/v.mp4", kind="video"
    )
    proof_only = _make_geo(db, author=author, lat=42.0, lng=42.0)
    db.add(
        Media(
            sha256=fake_sha256(), event_id=proof_only.id, storage_url="s3://x/p.jpg", kind="image"
        )
    )
    db.commit()

    def ids(query: str) -> set[str]:
        url = f"/api/v1/events/points?bbox={WORLD_BBOX}&author={author.username}&{query}"
        return {row[0] for row in client.get(url).json()}

    assert ids("media=video") == {str(with_video.id)}
    assert ids("media=image") == {str(proof_only.id)}
    assert str(plain.id) not in ids("media=image&media=video")

    # A junk media value is rejected (422), not silently treated as "no match".
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}&media=bogus").status_code == 422


def test_points_cache_key_builder_is_separator_safe():
    """Filter values carrying the legacy ``:`` separator must not collide.

    The old ``f"points:{conflict}:{tag}"`` key folded ``conflict=["a:b"]`` and
    ``conflict=["a"], tag=["b"]`` together; the hashed builder serialises via ``orjson``.
    """
    from app.routers.events.read import _build_points_cache_key

    colliding_a = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=["a:b"],
        sensor=None,
        level=None,
        tag=None,
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    colliding_b = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=["a"],
        sensor=None,
        level=None,
        tag=["b"],
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert colliding_a != colliding_b, "colon-bearing inputs must produce distinct keys"

    # Same inputs give the same key, so a builder change cannot turn every request into a MISS.
    same_a = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=["ukraine"],
        sensor=None,
        level=None,
        tag=None,
        occurred_date_from="2024-01-01",
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    same_b = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=["ukraine"],
        sensor=None,
        level=None,
        tag=None,
        occurred_date_from="2024-01-01",
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert same_a == same_b, "identical filter tuples must produce the same key"

    # sensor and level participate in the key (guards against a bucket being dropped).
    cs_a = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=None,
        sensor=["satellite"],
        level=None,
        tag=None,
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    cs_b = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=None,
        sensor=["drone"],
        level=None,
        tag=None,
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert cs_a != cs_b, "sensor must participate in the cache key"
    level_key = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        conflict=None,
        sensor=["satellite"],
        level=["indirect"],
        tag=None,
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert level_key != cs_a, "level must participate in the cache key"


@pytest.mark.parametrize(
    "bucket",
    ["conflict", "sensor", "level", "tag"],
    ids=["conflict-list", "sensor-list", "level-list", "tag-list"],
)
def test_points_cache_key_is_list_order_insensitive(bucket):
    """``?bucket=a&bucket=b`` and ``?bucket=b&bucket=a`` hit the same cache entry.

    Parametrised so a refactor that sorts one list bucket but not another fails.
    """
    from app.routers.events.read import _build_points_cache_key

    buckets = ("conflict", "sensor", "level", "tag")
    forward = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        **{bucket: ["alpha", "beta"]},
        **{other: None for other in buckets if other != bucket},
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    reverse = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        **{bucket: ["beta", "alpha"]},
        **{other: None for other in buckets if other != bucket},
        occurred_date_from=None,
        occurred_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    assert forward == reverse


def test_points_or_within_free_tag_list(db, author):
    """Multiple ``?tag=`` values match geos carrying ANY listed tag (OR, not AND)."""
    tag_a = Tag(name=f"a-{uuid.uuid4().hex[:8]}")
    tag_b = Tag(name=f"b-{uuid.uuid4().hex[:8]}")
    db.add_all([tag_a, tag_b])
    db.commit()

    geo_a = _make_geo(db, author=author, tags=[tag_a])
    geo_b = _make_geo(db, author=author, tags=[tag_b])
    geo_none = _make_geo(db, author=author)

    try:
        response = client.get(
            f"/api/v1/events/points?bbox={WORLD_BBOX}&tag={tag_a.name}&tag={tag_b.name}"
        )
        assert response.status_code == 200
        ids = {row[0] for row in response.json()}
        assert str(geo_a.id) in ids
        assert str(geo_b.id) in ids
        assert str(geo_none.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id.in_([tag_a.id, tag_b.id])))
        db.commit()


def test_points_or_within_conflict_list(db, author):
    """Multiple ``?conflict=`` values match geos in ANY listed conflict (OR within the list)."""
    conflict_a = Conflict(name=f"ca-{uuid.uuid4().hex[:8]}", is_ongoing=True, origin="manual")
    conflict_b = Conflict(name=f"cb-{uuid.uuid4().hex[:8]}", is_ongoing=True, origin="manual")
    free_same_name = Tag(name=conflict_a.name + "-free")
    db.add_all([conflict_a, conflict_b, free_same_name])
    db.commit()

    geo_a = _make_geo(db, author=author, conflicts=[conflict_a])
    geo_b = _make_geo(db, author=author, conflicts=[conflict_b])
    geo_none = _make_geo(db, author=author, tags=[free_same_name])

    try:
        response = client.get(
            f"/api/v1/events/points?bbox={WORLD_BBOX}&conflict={conflict_a.name}&conflict={conflict_b.name}"
        )
        assert response.status_code == 200
        ids = {row[0] for row in response.json()}
        assert str(geo_a.id) in ids
        assert str(geo_b.id) in ids
        assert str(geo_none.id) not in ids
    finally:
        db.execute(
            Conflict.__table__.delete().where(Conflict.id.in_([conflict_a.id, conflict_b.id]))
        )
        db.execute(Tag.__table__.delete().where(Tag.id == free_same_name.id))
        db.commit()


def test_points_and_across_conflict_and_tag(db, author):
    """``?conflict=X&tag=Y`` returns the intersection (AND across buckets, not a union)."""
    conflict = Conflict(name=f"conf-{uuid.uuid4().hex[:8]}", is_ongoing=True, origin="manual")
    free = Tag(name=f"free-{uuid.uuid4().hex[:8]}")
    db.add_all([conflict, free])
    db.commit()

    matching = _make_geo(db, author=author, tags=[free], conflicts=[conflict])
    conflict_only = _make_geo(db, author=author, conflicts=[conflict])
    free_only = _make_geo(db, author=author, tags=[free])

    try:
        response = client.get(
            f"/api/v1/events/points?bbox={WORLD_BBOX}&conflict={conflict.name}&tag={free.name}"
        )
        assert response.status_code == 200
        ids = {row[0] for row in response.json()}
        assert str(matching.id) in ids
        assert str(conflict_only.id) not in ids
        assert str(free_only.id) not in ids
    finally:
        db.execute(Conflict.__table__.delete().where(Conflict.id == conflict.id))
        db.execute(Tag.__table__.delete().where(Tag.id == free.id))
        db.commit()


def test_points_single_tag_value_back_compat(db, author, free_tag):
    """A single ``?tag=X`` (parsed to ``["X"]``) works with the list-shaped filter."""
    geo = _make_geo(db, author=author, tags=[free_tag])
    _make_geo(db, author=author)

    response = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}&tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row[0] for row in response.json()}
    assert str(geo.id) in ids


# An empty ``bbox`` reads as "filter omitted" on ``/events``, so it is not a malformed shape here.


@pytest.mark.parametrize(
    "bad",
    [
        "1,2,3",
        "1,2,3,4,5",
        "1",
        "foo,bar,baz,qux",
        "95.0,0.0,96.0,1.0",
        "0.0,200.0,1.0,201.0",
        "46.0,30.0,44.0,32.0",
        "44.0,32.0,46.0,30.0",
    ],
    ids=[
        "too-few-values",
        "too-many-values",
        "single-value",
        "non-numeric",
        "latitude-out-of-range",
        "longitude-out-of-range",
        "inverted-north-south",
        "inverted-east-west",
    ],
)
def test_bbox_malformed_returns_422(bad):
    response = client.get(f"/api/v1/events?bbox={bad}")
    assert response.status_code == 422, f"expected 422 for bbox={bad!r}"
