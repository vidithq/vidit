"""`GET /geolocations/possible-duplicates`, the submit-form duplicate probe."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.event import Event
from app.models.user import User
from tests.conftest import login_as
from tests.events._helpers import client


def _make_geo_with_source(
    db,
    *,
    author: User,
    lat: float,
    lng: float,
    source_url: str,
    event_date_value: date,
) -> Event:
    """Pins the source URL and event date, which ``_make_geo`` defaults away from the
    host / date legs."""
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
    """Anonymous callers get 401: the probe bypasses the bbox requirement of /points."""
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
            "lat": 48.50050,  # ~55 m north, inside 500 m
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
    """Proximity is a required leg: without it every geo sharing a host would match."""
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
    # Assert this specific row is absent rather than ``== []``: a dev-DB geolocation may
    # legitimately sit in the radius.
    ids = {hit["id"] for hit in response.json()}
    assert str(distant.id) not in ids, (
        "distant geo must not surface even with both match legs satisfied"
    )


def test_possible_duplicates_rejects_like_meta_characters_in_host(db, author):
    """The host whitelist ``[a-z0-9.-]+`` disarms LIKE metacharacters:
    ``https://%.com/x`` must not extract ``%.com`` and ILIKE-match every ``.com`` row.
    Regression guard for ``_HOST_SAFE_PATTERN``."""
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
            # A LIKE wildcard host: the whitelist drops the host leg, leaving a
            # non-matching date leg. Without it ``%.com`` would match ``twitter.com``.
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
    """No usable match leg returns empty, sparing the eager frontend call a round trip."""
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
    """A scheme-less mid-form paste still yields a host; the endpoint normalises instead
    of 422-ing."""
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
    """Closer candidates come first; the UI shows the likeliest duplicate on top."""
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
    # Assert ``near`` is present first so a dev-DB bleed (LIMIT 10) shows as a missing
    # row, not an ordering mismatch.
    present = {hit["id"] for hit in body}
    assert str(near.id) in present, f"near row missing from response: {body}"
    assert str(far.id) in present, f"far row missing from response: {body}"
    target_ids = [hit["id"] for hit in body if hit["id"] in {str(far.id), str(near.id)}]
    assert target_ids == [str(near.id), str(far.id)], f"expected near before far; got {target_ids}"
