"""Version history for a published event: snapshot, read, and the media floor.

``services/events.revise`` is the only writer. Before an edit touches the live
row it calls :func:`snapshot`, which files the state the row carried up to that
moment as an append-only ``event_revisions`` entry; the live row then takes the
next ``revision_no``. History is therefore "the snapshots, then the current
row", and the publication paths (``create_with_evidence``, ``geolocate``,
``_publish_detection``) write no revision at all: version 1 is the published
row itself.

:func:`referenced_media_urls` is the floor that keeps a snapshot renderable.
Media files are not versioned, so the shared intake asks here before it drops a
proof-media row whose image the current proof body no longer references: a row
some snapshot points at stays, object included.

This module depends on the models alone, so ``evidence_intake`` can read the
floor without importing the event service that calls it.
"""

from __future__ import annotations

import copy
import json
import uuid
from typing import Any, cast

from geoalchemy2.shape import to_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session, joinedload

from app.models.event import Event, EventRevision
from app.models.user import User

# Largest history one read serves. An event accumulates a handful of versions
# over its life, so the whole list fits one response and there is no cursor;
# the cap is the defensive ceiling on a row that somehow grew pathological.
MAX_REVISIONS = 200


def _point(value: Any) -> dict[str, float] | None:
    """One stored PostGIS point as the snapshot's wire shape, or ``None``.

    Same nesting as ``schemas/event.CoordsRead``, so a snapshot renders through
    the components the live row renders through.
    """
    if value is None:
        return None
    point = cast(Point, to_shape(value))
    return {"lat": point.y, "lng": point.x}


def build_snapshot(geo: Event) -> dict[str, Any]:
    """The event's current editable state, as the JSON one revision stores.

    Exactly the field set :func:`services.events.revise` writes, which is what
    makes a snapshot plus the live row a complete history: a field an edit can
    change is a field a snapshot carries. The evidence anchor (``source_url``
    and the ``source`` media) is absent on purpose, since an edit cannot move
    it, and the live row is authoritative for it at every version.

    Tags and conflicts carry their names alongside their ids so a version stays
    readable after a referential row is renamed or deleted. Proof media carry
    enough to render the snapshot's images without a second read. ``proof`` is
    deep-copied so the stored document cannot alias the live row's JSONB.
    """
    return {
        "title": geo.title,
        "event_coords": _point(geo.event_coords),
        "capture_source_coords": _point(geo.capture_source_coords),
        "event_date": geo.event_date.isoformat() if geo.event_date is not None else None,
        "event_time": geo.event_time.isoformat() if geo.event_time is not None else None,
        "source_posted_at": (
            geo.source_posted_at.isoformat() if geo.source_posted_at is not None else None
        ),
        "is_graphic": geo.is_graphic,
        "secondary_source_urls": [link.url for link in geo.source_links],
        "tags": [{"id": str(t.id), "name": t.name, "category": t.category} for t in geo.tags],
        "conflicts": [{"id": str(c.id), "name": c.name} for c in geo.conflicts],
        "proof": copy.deepcopy(geo.proof),
        "proof_media": [
            {
                "id": str(m.id),
                "storage_url": m.storage_url,
                "media_type": m.media_type,
                "original_filename": m.original_filename,
            }
            for m in geo.media
            if m.role == "proof"
        ],
    }


def snapshot(db: Session, *, geo: Event, edited_by: User, note: str | None) -> EventRevision:
    """File the event's pre-edit state as its ``revision_no``-th version.

    Staged, not committed: the caller applies the edit and commits both in one
    transaction, so a failed edit leaves no orphan version behind. Call it
    before any field is mutated.
    """
    row = EventRevision(
        event_id=geo.id,
        revision_no=geo.revision_no,
        edited_by_id=edited_by.id,
        note=note,
        snapshot=build_snapshot(geo),
    )
    db.add(row)
    return row


def referenced_media_urls(db: Session, event_id: uuid.UUID) -> set[str]:
    """Every proof-image URL this event's snapshots point at.

    The one query behind the media floor: a ``media`` row whose URL is in this
    set survives its removal from the current proof body, so a past version
    still renders. Reads only the ``proof_media`` fragment of each snapshot, not
    the proof documents.
    """
    urls: set[str] = set()
    for (fragment,) in db.query(EventRevision.snapshot["proof_media"]).filter(
        EventRevision.event_id == event_id
    ):
        # The driver normally hands back decoded JSON; a text round-trip is
        # decoded here so the floor can never silently read as "nothing is
        # referenced", which would delete an image a version still shows.
        if isinstance(fragment, str):
            fragment = json.loads(fragment)
        if not isinstance(fragment, list):
            continue
        for entry in fragment:
            url = entry.get("storage_url") if isinstance(entry, dict) else None
            if isinstance(url, str):
                urls.add(url)
    return urls


def list_revisions(db: Session, event_id: uuid.UUID) -> list[EventRevision]:
    """The event's superseded versions, newest first.

    Newest first for the same reason every other list here is: the edit a reader
    is asking about is almost always the last one. The editor is eager-loaded,
    since the history renders one byline per row.
    """
    return (
        db.query(EventRevision)
        .options(joinedload(EventRevision.edited_by))
        .filter(EventRevision.event_id == event_id)
        .order_by(EventRevision.revision_no.desc())
        .limit(MAX_REVISIONS)
        .all()
    )
