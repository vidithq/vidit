"""The published-event, approval and notification helpers, the ``proof_*`` multipart
helpers, and the source helpers (``stage_file``, ``source_spec``, ``sources_field``) the
event forms take."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from app.models.event import (
    Event,
    EventGeolocator,
)
from app.models.user import User
from tests._fixtures import TINY_JPEG, client, make_event
from tests.conftest import login_as

# ``/events/points`` requires a ``bbox``; tests not about it pass the whole globe.
WORLD_BBOX = "-90,-180,90,180"


# Proof multipart pieces: an HTML body whose image references
# ``placeholder://<filename>`` plus the matching file part.


def proof_form_field(filename: str = "proof-1.jpg") -> str:
    return f'<p>Proof write-up.</p><img src="placeholder://{filename}">'


def proof_file_part(filename: str = "proof-1.jpg") -> tuple[str, tuple[str, bytes, str]]:
    return ("proof_files", (filename, TINY_JPEG, "image/jpeg"))


def stage_file(
    user: User,
    content: bytes = TINY_JPEG,
    filename: str = "footage.jpg",
    content_type: str = "image/jpeg",
) -> str:
    """``POST /uploads`` as ``user``: the id of the staged file a source names."""
    response = client.post(
        "/api/v1/uploads",
        headers=login_as(client, user),
        files={"file": (filename, content, content_type)},
    )
    assert response.status_code == 201, response.text
    [staged] = response.json()["items"]
    return staged["id"]


def source_spec(
    url: str | None = "https://example.com/source",
    *,
    level: str = "direct",
    kind: str | None = "smartphone",
    upload_id: str | None = None,
    media_id: str | None = None,
    posted_at: str | None = "2026-05-01T12:00",
    snapshot_url: str | None = None,
    links: list[dict[str, Any]] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """One ``SourceCreate`` as a form posts it; ``links`` replaces the one built from ``url``.
    ``kind=None`` leaves the kind out."""
    spec: dict[str, Any] = {
        "level": level,
        **({"kind": kind} if kind is not None else {}),
        "links": (
            links
            if links is not None
            else [{"url": url, "posted_at": posted_at, "snapshot_url": snapshot_url}]
            if url is not None
            else []
        ),
        **extra,
    }
    if upload_id is not None:
        spec["upload_id"] = upload_id
    if media_id is not None:
        spec["media_id"] = media_id
    return spec


def sources_field(*specs: dict[str, Any]) -> str:
    """The ``sources`` form field: a JSON array of :func:`source_spec` entries."""
    return json.dumps(list(specs))


def filed_source(user: User, url: str = "https://example.com/source", **kw: Any) -> str:
    """A ``sources`` field holding one direct source with a freshly staged file."""
    return sources_field(source_spec(url, upload_id=stage_file(user), **kw))


def published_geo(db, owner: User, **kw) -> Event:
    """A geolocated event ``owner`` holds the owner credit row of, as a published event does."""
    geo = make_event(db, author=owner, **kw)
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
