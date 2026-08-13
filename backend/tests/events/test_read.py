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

from app.models.conflict import Conflict
from app.models.event import STATUS_DETECTED, Event
from app.models.tag import Tag
from app.services.event_filters import parse_bbox
from tests.events._helpers import WORLD_BBOX, _make_geo, client

# The parsed twin of ``WORLD_BBOX``: the cache-key builder keys off the float
# tuple, not the raw query string. Derived, so the two can't drift.
WORLD_BOUNDS = parse_bbox(WORLD_BBOX)

# ── GET /geolocations — list ──────────────────────────────────────────────


def test_list_returns_seeded_geolocation(db, author):
    geo = _make_geo(db, author=author)
    response = client.get("/api/v1/events")
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

    Conflict filtering joins the `conflicts` referential, never the tags
    table. If that regresses, a `free` tag with a clashing name (e.g.
    someone tags a geo with the free string "Ukraine") would leak into
    the conflict filter and inflate counts.
    """
    free = Tag(name=f"clash-{uuid.uuid4().hex[:8]}", category="free")
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


def test_list_filters_by_capture_source(db, author, capture_source_tag):
    with_cs = _make_geo(db, author=author, tags=[capture_source_tag])
    other = _make_geo(db, author=author)

    response = client.get(f"/api/v1/events?capture_source={capture_source_tag.name}")
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
        response = client.get(f"/api/v1/events?capture_source={free.name}")
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert str(geo.id) not in ids
    finally:
        db.execute(Tag.__table__.delete().where(Tag.id == free.id))
        db.commit()


def test_list_filters_by_author_exact_case_insensitive(db, author):
    """`?author=` matches the owner username exactly (case-insensitive): the
    filter means "this analyst's work", and the surfaces pick real handles
    via the typeahead, so a fragment must not sweep in every containing
    handle."""
    geo = _make_geo(db, author=author)
    response = client.get(f"/api/v1/events?author={author.username.upper()}")
    assert response.status_code == 200
    assert str(geo.id) in {row["id"] for row in response.json()}
    # A strict substring of the username no longer matches.
    response = client.get(f"/api/v1/events?author={author.username[2:6]}")
    assert response.status_code == 200
    assert str(geo.id) not in {row["id"] for row in response.json()}


def test_list_rejects_author_with_like_meta(author):
    """Junk vectors (`%`, `\\`, `;`, …) and over-length input are rejected
    at the input boundary so nothing outside `[A-Za-z0-9_-]{1,50}` reaches
    the SQL builder."""
    for bad in ("a%", "a\\b", "a;b", "a b", "a'b", "", "a" * 51):
        response = client.get("/api/v1/events", params={"author": bad})
        assert response.status_code == 422, (
            f"expected 422 for author={bad!r}, got {response.status_code}"
        )


def test_points_rejects_author_with_like_meta(author):
    # One ``params=`` dict, never a query string plus ``params=``: httpx
    # *replaces* the URL's query with the mapping, which would drop ``bbox``
    # and pass the test on the missing-parameter 422 instead of the guard.
    response = client.get("/api/v1/events/points", params={"bbox": WORLD_BBOX, "author": "a%"})
    assert response.status_code == 422


def test_list_filters_by_event_date_range(db, author):
    early = _make_geo(db, author=author, event_date=date(2026, 1, 1))
    mid = _make_geo(db, author=author, event_date=date(2026, 6, 1))
    late = _make_geo(db, author=author, event_date=date(2026, 12, 1))

    response = client.get("/api/v1/events?event_date_from=2026-05-01&event_date_to=2026-09-01")
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


def test_list_honours_limit(db, author):
    """One ``limit`` code path serves both views, so this covers the requested
    queue too."""
    for _ in range(3):
        _make_geo(db, author=author)
    response = client.get("/api/v1/events?limit=2")
    assert response.status_code == 200
    # Three matching rows seeded, so the cap is exact, not just an upper bound.
    assert len(response.json()) == 2


# ── GET /geolocations/{id} — detail ───────────────────────────────────────


def test_detail_returns_full_shape(db, author, free_tag):
    geo = _make_geo(db, author=author, lat=48.7, lng=34.7, tags=[free_tag])
    response = client.get(f"/api/v1/events/{geo.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(geo.id)
    assert body["title"] == geo.title
    assert body["event_coords"]["lat"] == pytest.approx(48.7)
    assert body["event_coords"]["lng"] == pytest.approx(34.7)
    assert body["capture_source_coords"] is None
    assert body["owner"]["username"] == author.username
    # `AuthorRef` field-set guard: the byline renders handle + avatar + trust
    # signal off this block, so a dropped field silently empties a surface.
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


# ── GET /geolocations/points ──────────────────────────────────────────────


def test_points_requires_bbox():
    """No ``bbox``, no payload: the map serves a viewport, and a bare
    ``curl /events/points`` must not walk away with the catalog."""
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
    """Every rejection ``parse_bbox`` makes reaches the caller as a 422.

    The empty case matters most: on ``/events`` an empty ``bbox`` reads as
    "filter omitted", and if ``/points`` inherited that it would hand back
    the whole catalog to ``?bbox=``.
    """
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
    """Two viewports must not share a cache entry.

    Without ``bbox`` in the key, the first viewport's payload would be
    served for every later one, so the map would render another region's
    pins (and the required parameter would buy nothing).
    """
    _make_geo(db, author=author, lat=48.5, lng=34.5)
    _make_geo(db, author=author, lat=10.0, lng=10.0)

    ukraine = client.get("/api/v1/events/points?bbox=45.0,30.0,50.0,40.0")
    africa = client.get("/api/v1/events/points?bbox=5.0,5.0,15.0,15.0")
    assert ukraine.headers.get("x-cache") == "MISS"
    assert africa.headers.get("x-cache") == "MISS", "a different viewport must MISS"
    assert ukraine.content != africa.content
    # The same viewport twice still warms, so the key is bbox-aware, not
    # bbox-poisoned.
    assert client.get("/api/v1/events/points?bbox=45.0,30.0,50.0,40.0").headers["x-cache"] == "HIT"


def test_points_cache_hits_across_one_grid_cell(db, author):
    """Two viewports inside one grid cell share a cache entry.

    Client boxes carry ~11 m precision, so keying on them raw would miss on
    nearly every request and let one caller cycle a low decimal to evict the
    whole LRU. ``snap_bbox`` grows each box outward onto the server grid
    before it is keyed, so a jitter smaller than a cell warms the same entry.
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
            capture_source=None,
            tag=None,
            event_date_from=None,
            event_date_to=None,
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
    assert len(row) == 6  # [id, lat, lng, event_date, submitted_date, detected]
    assert row[1] == pytest.approx(48.5)
    assert row[2] == pytest.approx(34.5)
    assert row[3] == geo.event_date.isoformat()  # ISO YYYY-MM-DD for the timeline
    assert row[4] == geo.created_at.date().isoformat()  # submitted (created_at) day
    assert row[5] == 0  # submitted row → not marked detected


def test_points_null_event_date_serialises_as_null(db, author):
    """A dateless geolocation must reach the map as ``null``, not crash /points
    (regression: ``event_date`` went optional and the tuple builder still
    called ``.isoformat()`` unconditionally, 500ing the whole map payload)."""
    geo = Event(
        owner_id=author.id,
        title="Dateless geo",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://x.com/a/status/2",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=None,
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
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://x.com/a/status/1",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
        detected_from_url="https://x.com/a/status/1",
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)

    # /points — the compact map payload marks it with the detected flag.
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
    """First call cold, second call warm — locks in the cache contract.

    The endpoint advertises this via the `X-Cache` response header so
    operators can sanity-check cache behaviour in prod logs without
    instrumenting metrics. Test guards against accidental cache
    bypass (e.g. someone removing the `points_cache.set` call).
    """
    _make_geo(db, author=author)
    first = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert first.headers.get("x-cache") == "MISS"
    second = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
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

    unfiltered = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    filtered = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}&tag={free_tag.name}")
    assert unfiltered.headers.get("x-cache") == "MISS"
    assert filtered.headers.get("x-cache") == "MISS", "different filter must MISS"
    assert len(filtered.json()) < len(unfiltered.json())


def test_points_filters_media(db, author):
    """``media`` narrows the point set to events carrying that attachment type."""
    from app.models.media import Media

    plain = _make_geo(db, author=author, lat=40.0, lng=40.0)
    with_video = _make_geo(db, author=author, lat=41.0, lng=41.0)
    db.add(
        Media(event_id=with_video.id, role="source", storage_url="s3://x/v.mp4", media_type="video")
    )
    db.commit()

    def ids(query: str) -> set[str]:
        url = f"/api/v1/events/points?bbox={WORLD_BBOX}&{query}"
        return {row[0] for row in client.get(url).json()}

    media_ids = ids("media=video")
    assert str(with_video.id) in media_ids
    assert str(plain.id) not in media_ids

    # A junk media value is rejected (422), not silently treated as "no match".
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}&media=bogus").status_code == 422


def test_points_cache_key_builder_is_separator_safe():
    """Filter values carrying the legacy ``:`` separator must not collide.

    The previous key shape (``f"points:{conflict}:{tag}:..."``) folded
    ``conflict=["a:b"], tag=None`` and ``conflict=["a"], tag=["b"]`` onto
    the same string, so the second request silently served the first
    request's cached payload. The hashed builder serialises the tuple
    via ``orjson`` before the hash, so colon-bearing inputs land in
    distinct keys.
    """
    from app.routers.events.read import _build_points_cache_key

    colliding_a = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
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
        bbox=WORLD_BOUNDS,
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
        bbox=WORLD_BOUNDS,
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
        bbox=WORLD_BOUNDS,
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
        bbox=WORLD_BOUNDS,
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
        bbox=WORLD_BOUNDS,
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
    from app.routers.events.read import _build_points_cache_key

    buckets = ("conflict", "capture_source", "tag")
    forward = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
        **{bucket: ["alpha", "beta"]},
        **{other: None for other in buckets if other != bucket},
        event_date_from=None,
        event_date_to=None,
        submitted_from=None,
        submitted_to=None,
        author=None,
    )
    reverse = _build_points_cache_key(
        bbox=WORLD_BOUNDS,
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
    """Multiple ``?conflict=`` values match geos in ANY listed conflict.

    Same OR-within story as free tags. Conflict matching joins the
    ``conflicts`` referential, so a free tag named like a conflict can't
    poison the result.
    """
    conflict_a = Conflict(name=f"ca-{uuid.uuid4().hex[:8]}", ongoing=True, source="manual")
    conflict_b = Conflict(name=f"cb-{uuid.uuid4().hex[:8]}", ongoing=True, source="manual")
    free_same_name = Tag(name=conflict_a.name + "-free", category="free")
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
    """``?conflict=X&tag=Y`` returns the intersection.

    A geo needs at least one conflict in the conflict list AND at
    least one free tag in the tag list. Without the AND-across-buckets
    rule, the filter would degrade into a union and surface noise the
    analyst didn't ask for.
    """
    conflict = Conflict(name=f"conf-{uuid.uuid4().hex[:8]}", ongoing=True, source="manual")
    free = Tag(name=f"free-{uuid.uuid4().hex[:8]}", category="free")
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
    """``?tag=X`` (single value, no second occurrence) works.

    Clients may send a single tag. FastAPI parses that into ``["X"]``
    and the list-shaped filter must accept it.
    """
    geo = _make_geo(db, author=author, tags=[free_tag])
    _make_geo(db, author=author)

    response = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}&tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row[0] for row in response.json()}
    assert str(geo.id) in ids


# ── bbox validation (422 on malformed) ────────────────────────────────────
# An empty string is treated as "filter omitted" by the `if bbox:` guard, so it
# is not one of the malformed shapes below. The well-formed case is covered by
# `test_list_filters_by_bbox`.


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
