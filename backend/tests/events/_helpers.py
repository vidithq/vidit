"""Shared ``client``, the ``_make_geo`` row factory, the published-event, approval and
notification helpers, and the ``proof_*`` multipart helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.main import app
from app.models.approval import EventApproval
from app.models.conflict import Conflict
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
)
from app.models.notification import NotificationDelivery
from app.models.tag import Tag
from app.models.user import User
from app.services.events import build_source_link_rows
from tests._fixtures import TINY_JPEG, fake_sha256
from tests.conftest import login_as

client = TestClient(app)


def delete_user(db, user_id: uuid.UUID) -> None:
    """Delete a fixture user the way an erasure does: their own approvals first, which
    ``ck_event_approvals_reviewer`` would refuse to keep without a reviewer. Does not commit."""
    db.query(EventApproval).filter(
        EventApproval.reviewer_id == user_id, EventApproval.organization_id.is_(None)
    ).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    # A sent delivery outlives its notification for the daily cap: reap the orphans so one
    # test's sends do not count against the next test's cap.
    db.query(NotificationDelivery).filter(NotificationDelivery.notification_id.is_(None)).delete(
        synchronize_session=False
    )


# ``/events/points`` requires a ``bbox``; tests not about it pass the whole globe.
WORLD_BBOX = "-90,-180,90,180"


def _make_geo(
    db,
    *,
    author: User,
    # ``None`` models a detection without a subject point (``ck_events_coords_status``).
    lat: float | None = 48.5,
    lng: float | None = 34.5,
    title: str | None = None,
    # ``None`` takes the model's empty-body default, which fails the proof-image floor.
    proof: str | None = None,
    occurred_date: date | None = None,
    source_posted_at: datetime | None = None,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    conflicts: list[Conflict] | None = None,
    status: str | None = None,
    detected_from_url: str | None = None,
    # ``None`` models a source-less detection; only valid with status ``detected``
    # (``ck_events_source_url_status``).
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
        coords=(
            from_shape(Point(lng, lat), srid=4326) if lat is not None and lng is not None else None
        ),
        source_url=source_url,
        occurred_date=occurred_date or date(2026, 5, 1),
        source_posted_at=source_posted_at or datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        is_graphic=is_graphic,
    )
    if status is not None:
        geo.status = status
    if proof is not None:
        geo.proof = proof
    # Stamp what the lifecycle CHECKs require, as every write path does.
    effective_status = status or STATUS_GEOLOCATED
    if effective_status == STATUS_GEOLOCATED:
        geo.geolocated_at = now
    elif effective_status == STATUS_DETECTED:
        geo.detected_at = now
    elif effective_status == STATUS_REQUESTED:
        geo.requested_at = now
    elif effective_status == STATUS_CLOSED:
        geo.closed_at = now
        # Bare literal: the column is typed ``BeforeClosedStatus``, the constant ``EventStatus``.
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
            Media(
                sha256=fake_sha256(),
                event_id=geo.id,
                role="source",
                storage_url="s3://x/m.jpg",
                kind="image",
            )
        )
    db.commit()
    db.refresh(geo)
    return geo


# Proof multipart pieces: an HTML body whose image references
# ``placeholder://<filename>`` plus the matching file part.


def proof_form_field(filename: str = "proof-1.jpg") -> str:
    return f'<p>Proof write-up.</p><img src="placeholder://{filename}">'


def proof_file_part(filename: str = "proof-1.jpg") -> tuple[str, tuple[str, bytes, str]]:
    return ("proof_files", (filename, TINY_JPEG, "image/jpeg"))


def published_geo(db, owner: User, **kw) -> Event:
    """A geolocated event ``owner`` holds the owner credit row of, as a published event does."""
    geo = _make_geo(db, author=owner, **kw)
    db.add(
        EventGeolocator(
            event_id=geo.id, user_id=owner.id, state="active", joined_at=datetime.now(UTC)
        )
    )
    db.commit()
    return geo


def approve(geo: Event, user: User, version_no: int = 1, **body):
    """``POST /events/{id}/approvals`` as ``user``; ``body`` adds ``note`` or ``organization``."""
    return client.post(
        f"/api/v1/events/{geo.id}/approvals",
        json={"version_no": version_no, **body},
        headers=login_as(client, user),
    )


def notifications_of(user: User) -> list[dict]:
    login_as(client, user)
    response = client.get("/api/v1/notifications")
    assert response.status_code == 200, response.text
    return response.json()
