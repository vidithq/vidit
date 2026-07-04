"""`GET /geolocations/possible-duplicates` — the submit-form duplicate probe.

Host + date match legs, the distance window, LIKE-meta rejection in the host
filter, soft-delete exclusion, and distance ordering. Shared fixtures live in
`conftest.py`; `client` / `_make_geo` in `_helpers.py`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.event import Event
from app.models.user import User
from tests.conftest import login_as
from tests.events._helpers import client

# ── GET /geolocations/possible-duplicates ─────────────────────────────────


def _make_geo_with_source(
    db,
    *,
    author: User,
    lat: float,
    lng: float,
    source_url: str,
    event_date_value: date,
) -> Event:
    """Constructor wrapper that lets the duplicate-probe tests pin the
    source URL and event date. ``_make_geo`` defaults both to fixed
    values that don't exercise the host / date match legs."""
    geo = Event(
        owner_id=author.id,
        title=f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(lng, lat), srid=4326),
        source_url=source_url,
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=event_date_value,
        geolocated_at=datetime.now(UTC),
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
        "/api/v1/events/possible-duplicates",
        params={
            "lat": 48.5,
            "lng": 34.5,
            "source_url": "https://example.com/x",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
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
        "/api/v1/events/possible-duplicates",
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
        "/api/v1/events/possible-duplicates",
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
        "/api/v1/events/possible-duplicates",
        params={
            "lat": 48.50000,
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/99999",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
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
        "/api/v1/events/possible-duplicates",
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
            "source_posted_at": "2026-05-01T12:00",
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
        "/api/v1/events/possible-duplicates",
        params={
            "lat": 48.50050,
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/99999",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
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
        "/api/v1/events/possible-duplicates",
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
        "/api/v1/events/possible-duplicates",
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
        "/api/v1/events/possible-duplicates",
        params={
            "lat": 48.50000,
            "lng": 34.50000,
            "source_url": "https://t.me/somechannel/ccc",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
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
