"""Version history for a published event: snapshot, read, redact, media floor.

:func:`file_version` is the only way a version comes to be (caller:
``services/events.save_version``, the owner's edit of a published row). It
files the row's pre-edit state as an append-only ``event_versions`` entry and
bumps ``version_no``. Publication paths write no version: version 1 is the
published row itself.

:func:`referenced_media_urls` keeps a snapshot's proof images renderable.
Media rows are not versioned, so the shared intake asks here before dropping a
proof-media row: a row some snapshot displayed stays, object included.

Source media takes the other route: an event carries at most one ``source``
media (``uq_media_source_per_event``), so a swap deletes the replaced row. The
snapshot carries the media's whole render shape (:func:`build_snapshot`), only
the S3 object is held alive, and :func:`referenced_source_media` names those
objects for the sweeps.

:func:`redact_version` blanks a filed row's content, keeping its number. A
redacted snapshot contributes nothing to either floor above.

:func:`matches_current` refuses a version that would equal the live row. It
reads :data:`COMPARED_FIELDS` off the same snapshot the filing writes; the
caller builds that snapshot once and hands it to both.

Reads are paginated through ``services/pagination``.
"""

from __future__ import annotations

import copy
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
from app.models.tag import Tag
from app.models.user import User
from app.schemas.media import MediaRead
from app.services.sanitize import extract_image_srcs

# Version ceiling per event: a script re-posting the same edit would otherwise
# grow snapshot rows and pinned proof images without bound. Exempt: a save whose
# only change is archived copies (see :func:`file_version`).
MAX_VERSIONS_PER_EVENT = 100

# Below ``pagination.MAX_PAGE_SIZE`` on purpose: a page of 100 would serve every
# history whole and the cursor walk would never run.
HISTORY_PAGE_SIZE = 50

# Fields the no-change check reads, as :func:`build_snapshot` stores them. Three
# of its keys are absent on purpose: ``proof_media`` derives from the proof body;
# ``archives`` has a stored ``created_at`` a paste cannot state (callers compare
# through :func:`archived_pairs`); ``source_media`` names stored rows while an
# incoming swap has no id yet (callers compare the swap itself).
COMPARED_FIELDS: tuple[str, ...] = (
    "title",
    "source_url",
    "event_coords",
    "capture_source_coords",
    "event_date",
    "event_time",
    "source_posted_at",
    "is_graphic",
    "secondary_source_urls",
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
    return [{"id": str(t.id), "name": t.name, "category": t.category} for t in tags]


def conflict_entries(conflicts: Iterable[Conflict]) -> list[dict[str, str]]:
    """Conflicts as a snapshot stores them (see :func:`tag_entries`)."""
    return [{"id": str(c.id), "name": c.name} for c in conflicts]


def media_entry(media: Media) -> dict[str, Any]:
    """One media row as a snapshot stores it, serialised through ``MediaRead``.

    Stores the whole row, not a reference: a replaced source media row is
    deleted. ``mode="json"`` makes the UUID a string for JSONB.
    """
    return MediaRead.model_validate(media).model_dump(mode="json")


def archived_pairs(geo: Event) -> dict[str, str]:
    """Each archived link of the event with the snapshot URL it currently holds."""
    return {a.original_url: a.snapshot_url for a in geo.archives}


def build_snapshot(geo: Event) -> dict[str, Any]:
    """The event's current editable state, as the JSON one version stores.

    Exactly the field set :func:`services.events.save_version` writes: every
    field an edit can change is carried, so snapshots plus the live row are a
    complete history.

    ``source_media`` holds at most one entry (matching
    ``schemas/event.EventRead.media``) with the whole render shape, since a swap
    deletes the row; the S3 object stays (see :func:`referenced_source_media`).
    ``proof`` is deep-copied so it cannot alias the live row's JSONB.
    ``proof_media`` lists only images THIS version's proof body references,
    otherwise it would misreport the version and pin images forever.
    ``archives`` is sorted by link so a reshuffle does not read as an edit.
    """
    displayed = set(extract_image_srcs(geo.proof))
    return {
        "title": geo.title,
        "source_url": geo.source_url,
        "source_media": [media_entry(m) for m in geo.media if m.role == "source"],
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
            media_entry(m) for m in geo.media if m.role == "proof" and m.storage_url in displayed
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


def _ids(entries: Any) -> list[str]:
    """The ids of a snapshot's ``tags`` / ``conflicts`` fragment, sorted."""
    return sorted(str(entry["id"]) for entry in entries)


def matches_current(current: Mapping[str, Any], proposed: Mapping[str, Any]) -> bool:
    """True when every versioned field of ``proposed`` equals the stored one's.

    Both arguments are snapshots from :func:`build_snapshot`. Archived copies
    are the caller's own leg (:func:`archived_pairs`).

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
    geo.version_no = geo.version_no + 1
    return row


def _media_entries(fragment: Any) -> list[dict[str, Any]]:
    """One snapshot's ``proof_media`` / ``source_media`` value, defensively.

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


def media_fragment(snapshot: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    """That media fragment of one already-read snapshot (single-row :func:`_fragments`)."""
    return _media_entries(snapshot.get(key))


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
    """Every source media this event's readable snapshots render.

    Returns entries, not URLs: a swap deletes the row, so the S3 key (derivatives
    included) resolves from the snapshot alone. Sweeps ask here first.
    """
    return _fragments(db, event_id, "source_media")


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
    (``services/pagination.take_page``).

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
