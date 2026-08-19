"""Version history for a published event: snapshot, read, redact, media floor.

:func:`file_version` is how a new version comes to be, and the two writers that
change a published row call it: ``services/events.save_version`` (the owner's edit)
and ``services/source_archive.record_snapshot`` (an archived copy recorded on a
``geolocated`` row). Before the write touches the live row, the state it carried
up to that moment is filed as an append-only ``event_versions`` entry and the
live row takes the next ``version_no``. History is therefore "the snapshots,
then the current row", and the publication paths (``create_with_evidence``,
``geolocate``, ``_publish_detection``) write no version at all: version 1 is
the published row itself.

:func:`referenced_media_urls` is the floor that keeps a snapshot renderable.
Media files are not versioned, so the shared intake asks here before it drops a
proof-media row whose image the current proof body no longer references: a row
some snapshot displayed stays, object included. A snapshot carries the images
its own proof body referenced, nothing else, so an image no version ever
displayed is not held alive by the history.

:func:`redact_version` is the one write a filed row takes: an admin blanks its
content while the row and its number stay. A redacted snapshot contributes
nothing to the floor above, so an image only it pointed at becomes deletable.

Reads are paginated through the shared cursor vocabulary
(``services/pagination``), so a long history walks the same way every other
list does.
"""

from __future__ import annotations

import copy
import json
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, cast

from geoalchemy2.shape import to_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session, joinedload

from app.models.conflict import Conflict
from app.models.event import Event, EventVersion
from app.models.tag import Tag
from app.models.user import User
from app.services.sanitize import extract_image_srcs


def point_shape(value: Any) -> dict[str, float] | None:
    """One stored PostGIS point as the snapshot's wire shape, or ``None``.

    Same nesting as ``schemas/event.CoordsRead``, so a snapshot renders through
    the components the live row renders through.
    """
    if value is None:
        return None
    point = cast(Point, to_shape(value))
    return {"lat": point.y, "lng": point.x}


def tag_entries(tags: Iterable[Tag]) -> list[dict[str, str]]:
    """Tags as a snapshot stores them: the id, plus the name and category.

    The name travels beside the id so a version stays readable after the
    referential row is renamed or deleted.
    """
    return [{"id": str(t.id), "name": t.name, "category": t.category} for t in tags]


def conflict_entries(conflicts: Iterable[Conflict]) -> list[dict[str, str]]:
    """Conflicts as a snapshot stores them, for the reason :func:`tag_entries` does."""
    return [{"id": str(c.id), "name": c.name} for c in conflicts]


def build_snapshot(geo: Event) -> dict[str, Any]:
    """The event's current editable state, as the JSON one version stores.

    Exactly the field set :func:`services.events.save_version` writes, which is what
    makes a snapshot plus the live row a complete history: a field an edit can
    change is a field a snapshot carries. The evidence anchor (``source_url``
    and the ``source`` media) is absent on purpose, since an edit cannot move
    it, and the live row is authoritative for it at every version.

    Tags and conflicts carry their names alongside their ids so a version stays
    readable after a referential row is renamed or deleted. ``proof`` is
    deep-copied so the stored document cannot alias the live row's JSONB.

    ``proof_media`` carries the images THIS version's proof body references,
    not every ``proof`` row the event holds: a row kept alive for an older
    version is not part of this one, and claiming it here would both misreport
    the version and pin the image forever.

    ``archives`` carries the archived copies the event held at this version, so
    ``/vN`` renders the copies as they stood rather than today's. Sorted by the
    link they cover, since the relationship has no order of its own and a stored
    list that reshuffles between versions would read as an edit.
    """
    displayed = set(extract_image_srcs(geo.proof))
    return {
        "title": geo.title,
        "event_coords": point_shape(geo.event_coords),
        "capture_source_coords": point_shape(geo.capture_source_coords),
        "event_date": geo.event_date.isoformat() if geo.event_date is not None else None,
        "event_time": geo.event_time.isoformat() if geo.event_time is not None else None,
        "source_posted_at": (
            geo.source_posted_at.isoformat() if geo.source_posted_at is not None else None
        ),
        "is_graphic": geo.is_graphic,
        "secondary_source_urls": [link.url for link in geo.source_links],
        "tags": tag_entries(geo.tags),
        "conflicts": conflict_entries(geo.conflicts),
        "proof": copy.deepcopy(geo.proof),
        "proof_media": [
            {
                "id": str(m.id),
                "storage_url": m.storage_url,
                "media_type": m.media_type,
                "original_filename": m.original_filename,
            }
            for m in geo.media
            if m.role == "proof" and m.storage_url in displayed
        ],
        "archives": [
            {
                "original_url": a.original_url,
                "origin": a.origin,
                "snapshot_url": a.snapshot_url,
                "provider": a.provider,
                "created_at": a.created_at.isoformat(),
            }
            for a in sorted(geo.archives, key=lambda a: a.original_url)
        ],
    }


def file_version(db: Session, *, geo: Event, edited_by: User, note: str | None) -> EventVersion:
    """File the state the row carries and move it to the next version.

    The one place a version comes to be: the snapshot is taken at the row's
    current ``version_no`` and the row is bumped past it, so the two halves
    cannot drift apart between the writers that produce versions.

    Staged, not committed: the caller applies its write and commits both in one
    transaction, so a failed write leaves no orphan version behind. Call it
    before any field is mutated, since the snapshot reads the live row.
    """
    row = EventVersion(
        event_id=geo.id,
        version_no=geo.version_no,
        edited_by_id=edited_by.id,
        note=note,
        snapshot=build_snapshot(geo),
    )
    db.add(row)
    geo.version_no = geo.version_no + 1
    return row


def referenced_media_urls(db: Session, event_id: uuid.UUID) -> set[str]:
    """Every proof-image URL this event's readable snapshots display.

    The one query behind the media floor: a ``media`` row whose URL is in this
    set survives its removal from the current proof body, so a past version
    still renders. Reads only the ``proof_media`` fragment of each snapshot, not
    the proof documents.

    Redacted versions are skipped. Their content is gone by design, so nothing
    renders them and an image they alone pointed at is free to be deleted.
    """
    urls: set[str] = set()
    for (fragment,) in (
        db.query(EventVersion.snapshot["proof_media"])
        .filter(EventVersion.event_id == event_id)
        .filter(EventVersion.redacted_at.is_(None))
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


def count_versions(db: Session, event_id: uuid.UUID) -> int:
    """How many superseded versions the event carries, redacted rows included.

    A redacted version keeps its number and its place in the list, so it counts
    here exactly as any other: the total says how many versions preceded the
    live row, which is a fact redaction does not change.
    """
    return db.query(EventVersion).filter(EventVersion.event_id == event_id).count()


def list_versions(
    db: Session,
    event_id: uuid.UUID,
    *,
    limit: int,
    cursor: int | None = None,
) -> list[EventVersion]:
    """One page of the event's superseded versions, newest first.

    Over-fetches by one row, so the caller can tell whether a next page exists
    (``services/pagination.take_page``) without a second query.

    Ordered by ``version_no DESC``, which is also what the cursor keys on
    (``services/pagination.encode_ordinal_cursor``). The number is unique per
    event and taken under the event's row lock, so it totally orders the history
    on its own: no tiebreaker column, and no dependence on ``created_at``, which
    the application clock sets and which therefore skews between instances. The
    editor is eager-loaded, since the history renders one byline per row.
    """
    query = (
        db.query(EventVersion)
        .options(joinedload(EventVersion.edited_by))
        .filter(EventVersion.event_id == event_id)
    )
    if cursor is not None:
        query = query.filter(EventVersion.version_no < cursor)
    return query.order_by(EventVersion.version_no.desc()).limit(limit + 1).all()


def get_version(db: Session, *, event_id: uuid.UUID, version_no: int) -> EventVersion | None:
    """One version of one event by its number, or ``None``.

    Reads on the unique ``(event_id, version_no)`` pair, which is the address
    ``/vN`` names.
    """
    return (
        db.query(EventVersion)
        .options(joinedload(EventVersion.edited_by))
        .filter(EventVersion.event_id == event_id, EventVersion.version_no == version_no)
        .first()
    )


def redact_version(db: Session, *, version: EventVersion, actor_id: uuid.UUID) -> bool:
    """Blank one filed version's content, keeping its number and its byline.

    The snapshot and the editor's note go; ``version_no``, ``created_at`` and
    ``edited_by`` stay, so the history still shows that a version existed, who
    superseded it and when, and ``/vN`` addressing never shifts.

    Staged, not committed: the caller owns the transaction, which is also where
    the images this version alone displayed are swept. Idempotent, and says so:
    returns ``True`` when this call redacted the row, ``False`` when it was
    already redacted and nothing changed.
    """
    if version.redacted_at is not None:
        return False
    version.redacted_at = datetime.now(UTC)
    version.redacted_by_id = actor_id
    version.snapshot = {}
    version.note = None
    return True
