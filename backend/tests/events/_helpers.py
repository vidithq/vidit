"""Shared client + row factory for the geolocations test package.

``client`` is the single ``TestClient`` every test in this package drives; the
autouse fixture in ``conftest.py`` resets its cookies + the points cache between
tests. ``_make_geo`` is the geolocation-row factory used across the read /
write / review suites.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.main import app
from app.models.event import Event
from app.models.tag import Tag
from app.models.user import User

client = TestClient(app)


def _make_geo(
    db,
    *,
    author: User,
    lat: float = 48.5,
    lng: float = 34.5,
    title: str | None = None,
    event_date: date | None = None,
    source_posted_at: datetime | None = None,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    status: str | None = None,
    detected_from_url: str | None = None,
    source_url: str = "https://example.com/source",
    with_media: bool = False,
) -> Event:
    geo = Event(
        author_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        location=from_shape(Point(lng, lat), srid=4326),
        source_url=source_url,
        event_date=event_date or date(2026, 5, 1),
        source_posted_at=source_posted_at or datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
    )
    if status is not None:
        geo.status = status
    if detected_from_url is not None:
        geo.detected_from_url = detected_from_url
    if deleted:
        geo.deleted_at = datetime.now(UTC)
    if tags:
        geo.tags = tags
    db.add(geo)
    db.flush()
    if with_media:
        from app.models.media import Media

        db.add(Media(event_id=geo.id, storage_url="s3://x/m.jpg", media_type="image"))
    db.commit()
    db.refresh(geo)
    return geo
