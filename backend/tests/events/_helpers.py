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
from app.models.conflict import Conflict
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.tag import Tag
from app.models.user import User
from app.services.events import build_source_link_rows
from tests._fixtures import TINY_JPEG

client = TestClient(app)

# ``/events/points`` requires a ``bbox``: the map serves a viewport, not the
# catalog. Tests that are about something else pass the whole globe so their
# assertions read the way they did when the parameter was optional.
WORLD_BBOX = "-90,-180,90,180"


def _make_geo(
    db,
    *,
    author: User,
    # ``lat=None`` (or ``lng=None``) models a row without a subject point: a
    # detection may carry none (``ck_events_coords_status``), and the
    # detections queue's readiness filter turns on exactly that.
    lat: float | None = 48.5,
    lng: float | None = 34.5,
    title: str | None = None,
    # The proof body. Left ``None``, the row takes the model's empty-doc
    # default, which carries no image and so fails the proof-image floor.
    proof: dict[str, Any] | None = None,
    event_date: date | None = None,
    source_posted_at: datetime | None = None,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    conflicts: list[Conflict] | None = None,
    status: str | None = None,
    detected_from_url: str | None = None,
    # None models a source-less machine detection; only valid with status
    # ``detected`` (``ck_events_source_url_status``).
    source_url: str | None = "https://example.com/source",
    secondary_source_urls: list[str] | None = None,
    with_media: bool = False,
    is_graphic: bool = False,
    hidden: bool = False,
) -> Event:
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=(
            from_shape(Point(lng, lat), srid=4326) if lat is not None and lng is not None else None
        ),
        source_url=source_url,
        event_date=event_date or date(2026, 5, 1),
        source_posted_at=source_posted_at or datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        is_graphic=is_graphic,
    )
    if status is not None:
        geo.status = status
    if proof is not None:
        geo.proof = proof
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
    if hidden:
        geo.hidden_at = datetime.now(UTC)
    if tags:
        geo.tags = tags
    if conflicts:
        geo.conflicts = conflicts
    if secondary_source_urls:
        geo.source_links = build_source_link_rows(secondary_source_urls)
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
