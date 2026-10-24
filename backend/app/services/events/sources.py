"""An event's sources: the write a form's ``sources`` list drives, the publish floor, and the
comparable form the no-change check reads.

A write posts the event's whole list (``schemas/source.SourceCreate``). :func:`plan_sources`
checks it against the stored sources before anything is written, :func:`check_publish_floor`
holds a publication to its evidence, and :func:`apply_sources` writes it once the event row
exists. The file of a source is a staged upload (``services/uploads``) or a stored file: the
source's own is kept, another source's is copied by row onto the same stored object.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from geoalchemy2.elements import WKBElement
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.models.event import Event
from app.models.media import Media
from app.models.source import (
    EVIDENCE_LEVELS,
    MAX_LINKS_PER_SOURCE,
    MAX_SOURCES_PER_EVENT,
    Source,
    SourceLevel,
    SourceLink,
)
from app.models.tag import Tag
from app.models.upload import Upload
from app.models.user import User
from app.schemas.source import SourceCreate, SourceLinkCreate
from app.services import uploads, versions
from app.services.event_filters import visible_events
from app.services.evidence_intake import StoredObject, media_objects
from app.services.sanitize import safe_link_href
from app.services.source_archive import _normalised_target, same_snapshot, validate_snapshot

from .coordinates import _optional_point
from .errors import (
    InvalidSourceUrlError,
    SourceFileRequiredError,
    SourceLinkRequiredError,
    SourceMediaNotFoundError,
    SourceNotFoundError,
    SourceRequiredError,
    TooManySourceLinksError,
    TooManySourcesError,
)


@dataclass(frozen=True)
class PlannedSource:
    """One posted source, checked: what it becomes and where its file comes from."""

    spec: SourceCreate
    # Blanks and repeats dropped, snapshots checked.
    links: list[SourceLinkCreate]
    tags: list[Tag]
    capture_position: WKBElement | None
    # The stored source this one updates, or None to create one.
    stored: Source | None
    # Where the file comes from: kept in place, a staged upload, or a copy of a stored file.
    keeps_media: bool
    upload: Upload | None
    copy_of: Media | None

    @property
    def has_file(self) -> bool:
        return self.keeps_media or self.upload is not None or self.copy_of is not None

    @property
    def is_graphic(self) -> bool:
        """The posted flag, ratcheted: a stored source or the copied file's source keeps it."""
        return (
            self.spec.is_graphic
            or (self.stored is not None and self.stored.is_graphic)
            or (self.copy_of is not None and self.copy_of.source.is_graphic)
        )


def _clean_links(spec: SourceCreate) -> list[SourceLinkCreate]:
    """Strip each URL, drop blanks and repeats, check each snapshot; at least one link left.

    Raises :class:`InvalidSourceUrlError` for a URL that is not an ``http(s)`` link,
    :class:`TooManySourceLinksError` past :data:`MAX_LINKS_PER_SOURCE`,
    :class:`SourceLinkRequiredError` when none is left, and ``SnapshotRejected``.
    """
    cleaned: list[SourceLinkCreate] = []
    seen: set[str] = set()
    for link in spec.links:
        url = link.url.strip()
        if not url or url in seen:
            continue
        # Read surfaces render the URL as an outbound link.
        if safe_link_href(url) is None:
            raise InvalidSourceUrlError(f"A source URL must be an http(s) link: {url}")
        seen.add(url)
        snapshot = (link.snapshot_url or "").strip() or None
        if snapshot is not None:
            validate_snapshot(snapshot)
        cleaned.append(SourceLinkCreate(url=url, posted_at=link.posted_at, snapshot_url=snapshot))
    if len(cleaned) > MAX_LINKS_PER_SOURCE:
        raise TooManySourceLinksError(f"A source carries at most {MAX_LINKS_PER_SOURCE} URLs")
    if not cleaned:
        raise SourceLinkRequiredError("Every source needs a URL")
    return cleaned


def plan_sources(
    db: Session, *, geo: Event | None, specs: list[SourceCreate], uploader: User
) -> list[PlannedSource]:
    """Check a posted source list before anything is written.

    ``geo`` is the event the list replaces the sources of (None on a create). Locks the
    uploads it names (:func:`services.uploads.take_uploads`).

    Raises :class:`TooManySourcesError`, :class:`SourceNotFoundError` (an ``id`` that is not
    one of ``geo``'s sources, or repeats), :class:`SourceMediaNotFoundError` (a ``media_id``
    that names no file of a readable source), the link errors of :func:`_clean_links`,
    ``InvalidCoordinatesError``, and the upload errors.
    """
    if len(specs) > MAX_SOURCES_PER_EVENT:
        raise TooManySourcesError(f"An event holds at most {MAX_SOURCES_PER_EVENT} sources")
    stored_by_id = {source.id: source for source in geo.sources} if geo is not None else {}
    seen_ids: set[uuid.UUID] = set()
    for spec in specs:
        if spec.id is None:
            continue
        if spec.id not in stored_by_id or spec.id in seen_ids:
            raise SourceNotFoundError(f"No source {spec.id} on this event")
        seen_ids.add(spec.id)

    staged = uploads.take_uploads(
        db, uploader=uploader, upload_ids=[s.upload_id for s in specs if s.upload_id]
    )
    files = _readable_files(db, [s.media_id for s in specs if s.media_id], geo=geo)
    tag_ids = {tag_id for spec in specs for tag_id in spec.tag_ids}
    tags_by_id = (
        {tag.id: tag for tag in db.query(Tag).filter(Tag.id.in_(tag_ids))} if tag_ids else {}
    )

    planned: list[PlannedSource] = []
    for spec in specs:
        stored = stored_by_id.get(spec.id) if spec.id is not None else None
        keeps_media = False
        copy_of: Media | None = None
        if spec.media_id is not None:
            media = files[spec.media_id]
            keeps_media = stored is not None and media.source_id == stored.id
            copy_of = None if keeps_media else media
        position = spec.capture_position
        planned.append(
            PlannedSource(
                spec=spec,
                links=_clean_links(spec),
                tags=[tags_by_id[t] for t in dict.fromkeys(spec.tag_ids) if t in tags_by_id],
                capture_position=_optional_point(
                    position.lat if position else None,
                    position.lng if position else None,
                    field="capture_position",
                ),
                stored=stored,
                keeps_media=keeps_media,
                upload=staged.get(spec.upload_id) if spec.upload_id else None,
                copy_of=copy_of,
            )
        )
    return planned


def _readable_files(
    db: Session, media_ids: list[uuid.UUID], *, geo: Event | None
) -> dict[uuid.UUID, Media]:
    """The source files the ids name: this event's, or a live, unwithheld event's."""
    if not media_ids:
        return {}
    rows = (
        db.query(Media)
        .join(Source, Source.id == Media.source_id)
        .join(Event, Event.id == Source.event_id)
        .options(joinedload(Media.source))
        .filter(Media.id.in_(media_ids))
        .filter(
            or_(
                *([Event.id == geo.id] if geo is not None else []),
                and_(*visible_events()),
            )
        )
        .all()
    )
    found = {row.id: row for row in rows}
    missing = set(media_ids) - set(found)
    if missing:
        raise SourceMediaNotFoundError(
            "A source names a file that does not exist: " + ", ".join(sorted(map(str, missing)))
        )
    return found


def check_publish_floor(sources: Iterable[tuple[SourceLevel, bool]]) -> None:
    """Hold an event to its evidence: a ``direct`` or ``indirect`` source with a file.

    Each item is ``(level, has_file)``. Every source names its kind by construction (the
    column is required, ``unknown`` included), so the floor has no kind leg. Raises
    :class:`SourceRequiredError` or :class:`SourceFileRequiredError`.
    """
    evidence = [has_file for level, has_file in sources if level in EVIDENCE_LEVELS]
    if not evidence:
        raise SourceRequiredError("A direct or indirect source is required")
    if not any(evidence):
        raise SourceFileRequiredError("A direct or indirect source needs its file")


def planned_floor(planned: list[PlannedSource]) -> list[tuple[SourceLevel, bool]]:
    return [(p.spec.level, p.has_file) for p in planned]


def stored_floor(sources: Iterable[Source]) -> list[tuple[SourceLevel, bool]]:
    return [(s.level, s.media is not None) for s in sources]


def _link_rows(source: Source, links: list[SourceLinkCreate]) -> list[SourceLink]:
    """The new link rows; a re-posted copy keeps the ``archived_at`` it was recorded at."""
    stored = {link.url: link for link in source.links}
    now = datetime.now(UTC)
    rows: list[SourceLink] = []
    for link in links:
        previous = stored.get(link.url)
        archived_at: datetime | None = None
        if link.snapshot_url is not None:
            unchanged = previous is not None and same_snapshot(
                previous.snapshot_url, link.snapshot_url
            )
            archived_at = previous.archived_at if unchanged and previous else now
        rows.append(
            SourceLink(
                url=link.url,
                posted_at=link.posted_at,
                snapshot_url=link.snapshot_url,
                archived_at=archived_at,
            )
        )
    return rows


def apply_sources(db: Session, geo: Event, planned: list[PlannedSource]) -> list[StoredObject]:
    """Write the planned list onto ``geo`` (already flushed) and return the files it dropped.

    Stored sources the list leaves out are deleted; the others are updated in place and new
    ones created. A taken upload becomes the source's ``media`` row and its staged row goes; a
    copied file becomes a new ``media`` row on the same stored object.

    Two flushes: the replaced files and links go first, since ``uq_media_source_id`` and
    ``uq_source_links_source_url`` would trip on an insert ahead of its delete. The dropped
    objects are the caller's to sweep after the commit (``evidence_intake.sweep_unreferenced``).
    """
    kept = {p.stored.id for p in planned if p.stored is not None}
    removed: list[StoredObject] = []
    links_by_source: dict[int, list[SourceLink]] = {}
    with db.no_autoflush:
        for source in list(geo.sources):
            if source.id not in kept:
                if source.media is not None:
                    removed += media_objects([source.media])
                geo.sources.remove(source)
        for index, p in enumerate(planned):
            if p.stored is None:
                continue
            links_by_source[index] = _link_rows(p.stored, p.links)
            p.stored.links.clear()
            if p.stored.media is not None and not p.keeps_media:
                removed += media_objects([p.stored.media])
                p.stored.media = None
    db.flush()

    now = datetime.now(UTC)
    with db.no_autoflush:
        for index, p in enumerate(planned):
            source = p.stored
            if source is None:
                # Spaced a microsecond apart so equal sources keep the posted order.
                source = Source(event=geo, created_at=now + timedelta(microseconds=index))
                db.add(source)
                links_by_source[index] = _link_rows(source, p.links)
            source.title = p.spec.title
            source.level = p.spec.level
            source.kind = p.spec.kind
            source.captured_at = p.spec.captured_at
            source.capture_position = p.capture_position
            source.is_graphic = p.is_graphic
            source.links = links_by_source[index]
            source.tags = p.tags
            if p.upload is not None:
                source.media = Media(
                    storage_url=uploads.storage_url_of(p.upload),
                    kind=p.upload.kind,
                    sha256=p.upload.sha256,
                    original_filename=p.upload.original_filename,
                )
                db.delete(p.upload)
            elif p.copy_of is not None:
                source.media = Media(
                    storage_url=p.copy_of.storage_url,
                    kind=p.copy_of.kind,
                    sha256=p.copy_of.sha256,
                    original_filename=p.copy_of.original_filename,
                )
    db.flush()
    db.expire(geo, ["sources"])
    return removed


def _instant(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value is not None else None


def _comparable_link(
    url: str, posted_at: datetime | None, snapshot: str | None, *, archives: bool
) -> list[Any]:
    entry: list[Any] = [url, _instant(posted_at)]
    if archives:
        entry.append(_normalised_target(snapshot) if snapshot else None)
    return entry


def comparable(sources: Iterable[Source] | Iterable[PlannedSource], *, archives: bool) -> list[str]:
    """A source list as an order-free value the no-change check compares.

    Stored sources and a planned list fold to the same shape: the editable fields, the links
    (with their snapshot when ``archives``) and tag ids, and the file as the stored URL it names
    (an upload has none yet, so it always reads as a change).
    """
    entries: list[str] = []
    for item in sources:
        if isinstance(item, PlannedSource):
            spec = item.spec
            if item.keeps_media and item.stored is not None and item.stored.media is not None:
                file: str | None = item.stored.media.storage_url
            elif item.copy_of is not None:
                file = item.copy_of.storage_url
            elif item.upload is not None:
                file = f"upload:{item.upload.id}"
            else:
                file = None
            position = spec.capture_position
            value = {
                "title": spec.title,
                "level": spec.level,
                "kind": spec.kind,
                "captured_at": _instant(spec.captured_at),
                "capture_position": [position.lat, position.lng] if position else None,
                "is_graphic": item.is_graphic,
                "links": sorted(
                    _comparable_link(link.url, link.posted_at, link.snapshot_url, archives=archives)
                    for link in item.links
                ),
                "tags": sorted(str(tag.id) for tag in item.tags),
                "file": file,
            }
        else:
            point = versions.point_shape(item.capture_position)
            value = {
                "title": item.title,
                "level": item.level,
                "kind": item.kind,
                "captured_at": _instant(item.captured_at),
                "capture_position": [point["lat"], point["lng"]] if point else None,
                "is_graphic": item.is_graphic,
                "links": sorted(
                    _comparable_link(link.url, link.posted_at, link.snapshot_url, archives=archives)
                    for link in item.links
                ),
                "tags": sorted(str(tag.id) for tag in item.tags),
                "file": item.media.storage_url if item.media is not None else None,
            }
        entries.append(json.dumps(value, sort_keys=True, default=str))
    return sorted(entries)
