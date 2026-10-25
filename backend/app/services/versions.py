"""Version history of an event: snapshot, read, redact, media floor.

:func:`file_version` is the only way a version comes to be (callers:
``services/events.save_version``, which publishes or corrects, and the batch
publish ``services/events.complete_detections``). It files the row's pre-edit
state as an append-only ``event_versions`` entry and bumps ``version_no``. An
unpublished request or detection is version 0, so publishing files version 0
and the published row is version 1. A row created published (``POST /events``)
starts at version 1 with no version 0.

:func:`referenced_media_urls` keeps a snapshot's proof images renderable.
Media rows are not versioned, so the shared intake asks here before dropping a
proof-media row: a row some snapshot displayed stays, object included.

Source files take the other route: a source an edit drops or re-files goes
with its row. The snapshot carries each source's whole render shape
(:func:`build_snapshot`), only the stored object is held alive, and
:func:`referenced_source_media` names those objects for the sweeps.

:func:`redact_version` blanks a filed row's content, keeping its number. A
redacted snapshot contributes nothing to either floor above.

:func:`matches_current` refuses a version that would equal the live row. It
reads :data:`COMPARED_FIELDS` off the same snapshot the filing writes; the
caller builds that snapshot once and hands it to both.

Reads are paginated through ``services/pagination``.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any, cast

from geoalchemy2.shape import to_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session, joinedload

from app.models.conflict import Conflict
from app.models.event import Event, EventVersion
from app.models.media import Media
from app.models.source import Source
from app.models.tag import Tag
from app.models.user import User
from app.schemas.media import MediaRead
from app.services import notifications
from app.services.sanitize import extract_image_srcs

# Version ceiling per event: a script re-posting the same edit would otherwise
# grow snapshot rows and pinned proof images without bound. Exempt: a save whose
# only change is archived copies (see :func:`file_version`).
MAX_VERSIONS_PER_EVENT = 100

# Below ``pagination.MAX_PAGE_SIZE`` on purpose: a page of 100 would serve every
# history whole and the cursor walk would never run.
HISTORY_PAGE_SIZE = 50

# Fields the no-change check reads, as :func:`build_snapshot` stores them. Two of
# its keys are absent on purpose: ``proof_media`` derives from the proof body, and
# ``sources`` name stored files and archive stamps an incoming write cannot state
# (callers compare them through ``services/events/sources.comparable``).
COMPARED_FIELDS: tuple[str, ...] = (
    "title",
    "coords",
    "occurred_date",
    "occurred_time",
    "tags",
    "conflicts",
    "proof",
)


class VersionLimitError(Exception):
    """The event already carries :data:`MAX_VERSIONS_PER_EVENT` versions.

    Raised by :func:`file_version` for an edit, never for a save whose only
    change is archived copies. Maps to 409.
    """

    code = "version_limit"


def point_shape(value: Any) -> dict[str, float] | None:
    """One stored PostGIS point as the snapshot's wire shape, or ``None``.

    Same nesting as ``schemas/event.CoordsRead``.
    """
    if value is None:
        return None
    point = cast(Point, to_shape(value))
    return {"lat": point.y, "lng": point.x}


def tag_entries(tags: Iterable[Tag]) -> list[dict[str, str]]:
    """Tags as a snapshot stores them. The name stays readable after a rename or delete."""
    return [{"id": str(t.id), "name": t.name} for t in tags]


def conflict_entries(conflicts: Iterable[Conflict]) -> list[dict[str, str]]:
    """Conflicts as a snapshot stores them (see :func:`tag_entries`)."""
    return [{"id": str(c.id), "name": c.name} for c in conflicts]


def media_entry(media: Media) -> dict[str, Any]:
    """One media row as a snapshot stores it, serialised through ``MediaRead``.

    Stores the whole row, not a reference: a dropped source's row is deleted.
    ``mode="json"`` makes the UUID a string for JSONB.
    """
    return MediaRead.model_validate(media).model_dump(mode="json")


def source_entry(source: Source) -> dict[str, Any]:
    """One source as a snapshot stores it: the shape ``schemas/source.SourceRead`` serves,
    minus the id (a source is re-filed by its content, not its row)."""
    return {
        "title": source.title,
        "level": source.level,
        "kind": source.kind,
        "captured_at": source.captured_at.isoformat() if source.captured_at else None,
        "capture_position": point_shape(source.capture_position),
        "is_graphic": source.is_graphic,
        "links": [
            {
                "url": link.url,
                "posted_at": link.posted_at.isoformat() if link.posted_at else None,
                "snapshot_url": link.snapshot_url,
                "archived_at": link.archived_at.isoformat() if link.archived_at else None,
            }
            for link in source.links
        ],
        "tags": tag_entries(source.tags),
        "media": media_entry(source.media) if source.media is not None else None,
    }


def build_snapshot(geo: Event) -> dict[str, Any]:
    """The event's current editable state, as the JSON one version stores.

    Exactly the field set :func:`services.events.save_version` writes: every
    field an edit can change is carried, so snapshots plus the live row are a
    complete history.

    ``sources`` hold each source with its links, tags and file in the event's
    order (:func:`source_entry`); a dropped source's object stays (see
    :func:`referenced_source_media`). ``proof_media`` lists only images THIS
    version's proof body references, otherwise it would misreport the version
    and pin images forever.
    """
    displayed = set(extract_image_srcs(geo.proof))
    return {
        "title": geo.title,
        "coords": point_shape(geo.coords),
        "occurred_date": geo.occurred_date.isoformat() if geo.occurred_date is not None else None,
        "occurred_time": geo.occurred_time.isoformat() if geo.occurred_time is not None else None,
        "sources": [source_entry(source) for source in geo.sources],
        "tags": tag_entries(geo.tags),
        "conflicts": conflict_entries(geo.conflicts),
        "proof": geo.proof,
        "proof_media": [media_entry(m) for m in geo.media if m.storage_url in displayed],
    }


def _ids(entries: Any) -> list[str]:
    """The ids of a snapshot's ``tags`` / ``conflicts`` fragment, sorted."""
    return sorted(str(entry["id"]) for entry in entries)


def matches_current(current: Mapping[str, Any], proposed: Mapping[str, Any]) -> bool:
    """True when every versioned field of ``proposed`` equals the stored one's.

    Both arguments are snapshots from :func:`build_snapshot`. Sources are the
    caller's own leg (``services/events/sources.comparable``).

    Tags and conflicts compare as sets of ids, so ordering or a rename is not a
    change. Run it under the caller's lock before anything is staged, so a
    refused write files nothing.
    """
    for field in COMPARED_FIELDS:
        if field in ("tags", "conflicts"):
            if _ids(current[field]) != _ids(proposed[field]):
                return False
        elif current[field] != proposed[field]:
            return False
    return True


def file_version(
    db: Session,
    *,
    geo: Event,
    edited_by: User,
    note: str | None,
    snapshot: dict[str, Any] | None = None,
    enforce_ceiling: bool = True,
) -> EventVersion:
    """File the state the row carries and move it to the next version.

    ``snapshot`` is the pre-edit state a caller already built for
    :func:`matches_current`; omit it and the row is read here.

    ``enforce_ceiling=False`` is for a save whose only change is archived
    copies: otherwise a source that dies at the ceiling would be unarchivable.
    With it on, raises :class:`VersionLimitError` at
    :data:`MAX_VERSIONS_PER_EVENT` before anything is staged.

    The new version ends every approval of the superseded one
    (``models/approval.EventApproval`` is current only on the live version), so
    each analyst whose approval stood is asked to review it again
    (``re_approve_requested``).

    Staged, not committed: the caller commits it with its write. Call it before
    mutating any field, since the snapshot reads the live row.
    """
    if enforce_ceiling and geo.version_no >= MAX_VERSIONS_PER_EVENT:
        raise VersionLimitError(
            f"This event has reached {MAX_VERSIONS_PER_EVENT} versions and can no longer be edited."
        )
    row = EventVersion(
        event_id=geo.id,
        version_no=geo.version_no,
        edited_by_id=edited_by.id,
        note=note,
        snapshot=build_snapshot(geo) if snapshot is None else snapshot,
    )
    db.add(row)
    notifications.notify_re_approve_requested(
        db, event=geo, editor_id=edited_by.id, superseded_version=geo.version_no
    )
    geo.version_no = geo.version_no + 1
    return row


def _media_entries(fragment: Any) -> list[dict[str, Any]]:
    """One snapshot's media list, defensively.

    A redacted snapshot is ``{}`` and older versions may lack the key, so
    anything but a list of objects reads as no entries. A text round-trip is
    decoded so the media floor never reads "nothing referenced" and deletes a
    file a version still renders.
    """
    if isinstance(fragment, str):
        fragment = json.loads(fragment)
    if not isinstance(fragment, list):
        return []
    return [entry for entry in fragment if isinstance(entry, dict)]


def source_media_of(snapshot: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The files of one already-read snapshot's sources."""
    return [
        source["media"]
        for source in _media_entries(snapshot.get("sources"))
        if isinstance(source.get("media"), dict)
    ]


def _fragments(db: Session, event_id: uuid.UUID, key: str) -> list[dict[str, Any]]:
    """That fragment of every readable snapshot of one event, flattened.

    Redacted versions are skipped: nothing renders them, so a file only they
    named is free to delete.
    """
    entries: list[dict[str, Any]] = []
    for (fragment,) in (
        db.query(EventVersion.snapshot[key])
        .filter(EventVersion.event_id == event_id)
        .filter(EventVersion.redacted_at.is_(None))
    ):
        entries.extend(_media_entries(fragment))
    return entries


def referenced_media_urls(db: Session, event_id: uuid.UUID) -> set[str]:
    """Every proof-image URL this event's readable snapshots display.

    The proof-media floor: a ``media`` row whose URL is in this set survives its
    removal from the current proof body.
    """
    return {
        url
        for entry in _fragments(db, event_id, "proof_media")
        if isinstance(url := entry.get("storage_url"), str)
    }


def referenced_source_media(db: Session, event_id: uuid.UUID) -> list[dict[str, Any]]:
    """Every source file this event's readable snapshots render.

    Returns entries, not URLs: a dropped source deletes the row, so the storage key
    (derivatives included) resolves from the snapshot alone. Sweeps ask here first.
    """
    return [
        source["media"]
        for source in _fragments(db, event_id, "sources")
        if isinstance(source.get("media"), dict)
    ]


def count_versions(db: Session, event_id: uuid.UUID) -> int:
    """How many superseded versions the event carries, redacted rows included."""
    return db.query(EventVersion).filter(EventVersion.event_id == event_id).count()


def list_versions(
    db: Session,
    event_id: uuid.UUID,
    *,
    limit: int,
    cursor: int | None = None,
) -> list[EventVersion]:
    """One page of the event's superseded versions, newest first.

    Over-fetches by one row so the caller can detect a next page
    (``services/pagination.paged``).

    Ordered by ``version_no DESC``, the cursor key
    (``services/pagination.encode_ordinal_cursor``): unique per event and taken
    under the row lock, so it needs no tiebreaker and avoids ``created_at``
    clock skew between instances.
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
    """One version of one event by its number (the ``/vN`` address), or ``None``."""
    return (
        db.query(EventVersion)
        .options(joinedload(EventVersion.edited_by))
        .filter(EventVersion.event_id == event_id, EventVersion.version_no == version_no)
        .first()
    )


def redact_version(db: Session, *, version: EventVersion, actor_id: uuid.UUID) -> bool:
    """Blank one filed version's content, keeping its number and its byline.

    The snapshot and note go; ``version_no``, ``created_at`` and ``edited_by``
    stay, so ``/vN`` addressing never shifts.

    Staged, not committed: the caller owns the transaction and the sweep of
    images only this version displayed. Returns ``False`` if already redacted.
    """
    if version.redacted_at is not None:
        return False
    version.redacted_at = datetime.now(UTC)
    version.redacted_by_id = actor_id
    version.snapshot = {}
    version.note = None
    return True
