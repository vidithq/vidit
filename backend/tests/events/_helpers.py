"""Shared client + row factory for the events test package.

``client`` is the single ``TestClient`` every test in this package drives; the
autouse fixture in ``conftest.py`` resets its cookies + the points cache between
tests. ``_make_geo`` is the event-row factory used across the read /
write / lifecycle suites, and the ``proof_*`` helpers build the minimal
placeholder-proof multipart pieces the geolocate floor requires.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from typing import Any

from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.main import app
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.tag import Tag
from app.models.user import User
from tests._fixtures import TINY_JPEG

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
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(lng, lat), srid=4326),
        source_url=source_url,
        event_date=event_date or date(2026, 5, 1),
        source_posted_at=source_posted_at or datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
    )
    if status is not None:
        geo.status = status
    # Stamp per the lifecycle CHECKs (a geolocated row without geolocated_at,
    # or a closed one without closed_at + before_closed_status, is rejected by
    # Postgres), mirroring what every write path stamps.
    effective_status = status or STATUS_GEOLOCATED
    if effective_status == STATUS_GEOLOCATED:
        geo.geolocated_at = now
    elif effective_status == STATUS_DETECTED:
        geo.detected_at = now
    elif effective_status == STATUS_REQUESTED:
        geo.requested_at = now
    elif effective_status == STATUS_CLOSED:
        geo.closed_at = now
        # Bare literal, not STATUS_REQUESTED: the column's type is the narrower
        # ``BeforeClosedStatus`` and the constant is typed as ``EventStatus``.
        geo.before_closed_status = "requested"
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

        db.add(
            Media(event_id=geo.id, role="source", storage_url="s3://x/m.jpg", media_type="image")
        )
    db.commit()
    db.refresh(geo)
    return geo


# ── Placeholder-proof multipart pieces ────────────────────────────────────
# The geolocate floor requires at least one proof image in the proof body;
# tests thread these through the multipart form: a Tiptap doc whose image
# node references ``placeholder://<filename>`` plus the matching file part.


def proof_doc_with_placeholder(filename: str = "proof-1.jpg") -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Proof write-up."}],
            },
            {"type": "image", "attrs": {"src": f"placeholder://{filename}"}},
        ],
    }


def proof_form_field(filename: str = "proof-1.jpg") -> str:
    return json.dumps(proof_doc_with_placeholder(filename))


def proof_file_part(filename: str = "proof-1.jpg") -> tuple[str, tuple[str, bytes, str]]:
    return ("proof_files", (filename, TINY_JPEG, "image/jpeg"))
