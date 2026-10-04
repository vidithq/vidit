"""Persist machine detections: a ``Resolution``'s detections become ``detected`` rows.

:func:`persist_detections` is the one write path for every entry (the bot,
:func:`import_pasted_post`, :func:`backfill_from_archive`) over what
``tweet_ingest.resolve_threads`` returns. Each ``Detection`` becomes an ``Event`` owned by the
importer, with media through the evidence pipeline and idempotency on ``(the thread's post ids
OR source_url, coordinate)``. The ``Detection`` never reaches the ORM, which keeps the engine
pure.

:func:`open_request` is the second write path: a ``RequestDraft`` becomes a ``requested`` row
through ``events.create_request``. Only the bot's request branch calls it.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, Protocol, cast

import httpx
from fastapi import UploadFile
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.cache import points_cache
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    DetectedVia,
    Event,
    EventVersion,
)
from app.models.media import Media, MediaRole
from app.models.user import User
from app.services.events import (
    ImportProvenance,
    build_source_link_rows,
    create_request,
    replace_source_links,
    stamp_provenance,
)
from app.services.evidence_intake import EvidenceIntakeError, collect_media_keys
from app.services.sanitize import tiptap_doc_from_text
from app.services.source_archive import reconcile_source_archive
from app.services.storage import (
    PreparedMedia,
    content_sha256,
    detected_media_key,
    get_storage,
    prepare_media,
    safe_storage_extension,
    sweep_keys,
    upload_prepared_media,
    validate_bytes,
)
from app.services.tweet_ingest import (
    DUPLICATE_MEDIA,
    FOOTAGE_UNUSABLE,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    SOURCE_MISSING,
    Detection,
    ParsedMedia,
    RequestDraft,
    Resolution,
    acquire_from_post,
    archive_media_fetcher,
    chase_thread,
    fetch_cdn_media,
    read_pasted_post,
    read_tweets,
    resolve_threads,
    sole_refusal,
    stitch,
)

logger = logging.getLogger(__name__)

# Hands the write path the bytes for one media: ``(bytes, content_type)``, or ``None`` to skip
# (missing archive file, untrusted host, fetch failure).
MediaFetcher = Callable[[ParsedMedia], Awaitable[tuple[bytes, str] | None]]

# Media reference to prepared bytes (``None`` skips), cached per thread so a multi-coordinate
# thread prepares identical media once.
_MediaCache = dict[str, PreparedMedia | None]

# Coordinate-equality tolerance, matching the dedup rounding in ``extract_coords``.
_COORD_PLACES = 6


@dataclass
class Outcome:
    """What one import pass did, row by row.

    Verdicts carry event ids in engine order, not ORM rows: an export resolves thousands of
    detections, and holding the mapped objects would pin them out of the weak identity map.
    """

    created: list[uuid.UUID] = field(default_factory=list)
    updated: list[uuid.UUID] = field(default_factory=list)
    # A matched row the import must not touch, or one already up to date.
    skipped: list[uuid.UUID] = field(default_factory=list)
    failed: int = 0  # a detection raised mid-persist and was skipped
    # Review warnings on the rows written (created and updated only), from the engine and the
    # write path. One home, so the bot reply, archive email and paste response agree.
    warnings: dict[str, int] = field(default_factory=dict)
    # Threads the engine refused, per code.
    refusals: dict[str, int] = field(default_factory=dict)

    @property
    def reason(self) -> str | None:
        """The one refusal to name back to the analyst, or ``None``.

        Set exactly when the pass wrote no row and refused for a single reason. An export
        refusing several threads reads :attr:`refusals`.
        """
        if self.created or self.updated or self.skipped:
            return None
        return sole_refusal(self.refusals)


Verdict = Literal["skip", "create", "upsert"]


def _media_type(content_type: str) -> str:
    return "video" if content_type.startswith("video/") else "image"


def _row_disposition(row: Event) -> Verdict:
    """What a re-import may do with one matched row.

    1. An admin removal (``deleted_at``) stays removed, so a re-import cannot undo a takedown.
    2. A withheld row (``hidden_at``) is frozen for its owner too
       (``routers/events/_common.resolve_live_event``).
    3. Published work (``geolocated``) is never touched by a machine.
    4. An open detection is machine-authored and no analyst path edits it in place, so a newer
       parse overwrites it.
    5. A ``closed`` row (rejected, withdrawn or retracted) is not the import's to reopen.
    6. Anything else live (a ``requested`` event matched through its source URL) belongs to a
       human flow.
    """
    if row.deleted_at is not None:
        return "skip"
    if row.hidden_at is not None:
        return "skip"
    if row.status == STATUS_GEOLOCATED:
        return "skip"
    if row.status == STATUS_DETECTED:
        return "upsert"
    return "skip"


def _match_legs(
    *, tweet_id: int | None, thread_tweet_ids: Sequence[int], source_url: str | None
) -> list[ColumnElement[bool]]:
    """The OR legs a row is recognised by (provenance, then source).

    Shared by :func:`_disposition` and :func:`_existing_row_for`. Empty when the work declares
    no post id, thread or source.
    """
    legs: list[ColumnElement[bool]] = []
    if tweet_id is not None:
        legs.append(Event.detected_from_tweet_id == tweet_id)
    if thread_tweet_ids:
        legs.append(Event.detected_thread_tweet_ids.overlap(list(thread_tweet_ids)))
    if source_url is not None:
        legs.append(Event.source_url == source_url)
        legs.append(
            Event.id.in_(
                select(EventVersion.event_id).where(
                    EventVersion.snapshot["source_url"].astext == source_url
                )
            )
        )
    return legs


def _disposition(db: Session, owner: User, detection: Detection) -> tuple[Verdict, Event | None]:
    """Verdict for one detection, with the row it applies to (only ``create`` has none).

    Scoped to ``owner``. Matches every row the detection's provenance or ``source_url`` hits,
    in any state, on the coordinate to ``_COORD_PLACES``. Each match is read by
    :func:`_row_disposition`, and a single ``skip`` wins. No match creates.

    The provenance leg is the thread's post ids, not a URL (one post spells its URL several
    ways) and not the anchor alone (entries anchor differently on one self-thread, so one
    geolocation through two entries would land twice). It is an array overlap, which holds
    whichever entry ran first. The anchor equality stays for rows written before the array.

    The ``source_url`` leg catches delete-and-repost duplicates (same footage and coordinate,
    different provenance posts). A source-less detection matches on provenance only. The leg
    reads version history too, since correcting an evidence anchor files a version that still
    carries the imported URL. A redacted snapshot is blank and matches nothing.
    """
    legs = _match_legs(
        tweet_id=detection.detected_from_tweet_id,
        thread_tweet_ids=detection.thread_tweet_ids,
        source_url=detection.source_url,
    )
    if not legs:
        # Nothing to recognise an existing row by: it can only be new.
        return "create", None
    rows = (
        db.query(Event)
        .filter(
            Event.owner_id == owner.id,
            or_(*legs),
        )
        # Deterministic pick: the oldest.
        .order_by(Event.created_at, Event.id)
        .all()
    )
    open_row: Event | None = None
    for row in rows:
        # A ``detected`` row may have no coordinate; skip it rather than let
        # ``to_shape(None)`` abort the whole re-import.
        if row.event_coords is None:
            continue
        if not _same_coordinate(row, detection):
            continue
        if _row_disposition(row) == "skip":
            return "skip", row
        if open_row is None:
            open_row = row
    if open_row is None:
        return "create", None
    return "upsert", open_row


def _same_coordinate(row: Event, detection: Detection) -> bool:
    lat, lng = _projected(row)
    return round(lat, _COORD_PLACES) == round(detection.coordinate.lat, _COORD_PLACES) and round(
        lng, _COORD_PLACES
    ) == round(detection.coordinate.lng, _COORD_PLACES)


async def _prepared_media(
    parsed: ParsedMedia, fetch_media: MediaFetcher, cache: _MediaCache
) -> PreparedMedia | None:
    """Fetch, validate and prepare one media, memoised in ``cache``; ``None`` skips it.

    Unusable media (missing file, bad type or size, undecodable) skips rather than failing the
    detection.
    """
    if parsed.remote_url in cache:
        return cache[parsed.remote_url]
    prepared: PreparedMedia | None = None
    fetched = await fetch_media(parsed)
    if fetched is not None:
        data, content_type = fetched
        try:
            validate_bytes(data, content_type)
            prepared = await asyncio.to_thread(prepare_media, data, content_type)
        except ValueError:
            # validate_bytes and EvidenceProcessingError both subclass ValueError; a broader
            # catch would hide real bugs as silent media skips.
            logger.warning("Skipping unusable detection media %s", parsed.remote_url)
            prepared = None
    cache[parsed.remote_url] = prepared
    return prepared


@dataclass(frozen=True)
class _ResolvedMedia:
    """One media fetched and prepared, not yet stored.

    ``sha256`` matches what :func:`storage.upload_prepared_media` persists, so the upsert
    compares bytes without uploading.
    """

    role: MediaRole
    prepared: PreparedMedia
    sha256: str


@dataclass(frozen=True)
class _DetectionMedia:
    """A detection's resolved media; ``complete`` is False when declared media failed to fetch.

    The create path stores ``items`` regardless. The upsert reads ``complete``, because a short
    list is indistinguishable from "the post lost its media" and would delete what the row holds.
    """

    items: list[_ResolvedMedia]
    complete: bool


async def _resolve_media(
    detection: Detection, fetch_media: MediaFetcher, media_cache: _MediaCache
) -> _DetectionMedia:
    """The media a detection wants stored, in row order, marked incomplete if any went missing.

    Source slot first: the first source media that prepares cleanly (cap one,
    ``uq_media_source_per_event``). Then proof images, no cap. A re-import reads the incomplete
    mark before replacing anything.
    """
    resolved: list[_ResolvedMedia] = []
    source_filled = False
    for parsed in detection.source_media:
        prepared = await _prepared_media(parsed, fetch_media, media_cache)
        if prepared is None:
            continue
        resolved.append(_ResolvedMedia("source", prepared, content_sha256(prepared.cleaned)))
        source_filled = True
        break
    # A declared source whose every candidate failed leaves the slot empty.
    missing = bool(detection.source_media) and not source_filled
    for parsed in detection.proof_media:
        # The proof doc holds image nodes only, so a non-image proof media would be an
        # unreadable orphan. Not a miss: nothing could ever store it.
        if parsed.kind != "image":
            continue
        prepared = await _prepared_media(parsed, fetch_media, media_cache)
        if prepared is None:
            missing = True
            continue
        resolved.append(_ResolvedMedia("proof", prepared, content_sha256(prepared.cleaned)))
    return _DetectionMedia(resolved, not missing)


async def _store_media(
    db: Session, geo: Event, resolved: list[_ResolvedMedia], uploaded_keys: list[str]
) -> list[str]:
    """Upload ``resolved`` and add the ``Media`` rows; returns the proof image URLs.

    Appends landed keys to ``uploaded_keys`` so a failed transaction can sweep them.
    """
    storage = get_storage()
    proof_image_urls: list[str] = []
    for item in resolved:
        # Each event owns its S3 objects so a hard-delete sweep can't orphan a sibling's media.
        result = await upload_prepared_media(
            item.prepared, detected_media_key(geo.id, item.prepared.content_type)
        )
        media_type = _media_type(item.prepared.content_type)
        db.add(
            Media(
                event_id=geo.id,
                role=item.role,
                storage_url=result.url,
                media_type=media_type,
                sha256=result.sha256,
            )
        )
        if item.role == "proof" and media_type == "image":
            proof_image_urls.append(result.url)
        landed = storage.key_from_url(result.url)
        if landed is not None:
            uploaded_keys.append(landed)
            uploaded_keys.extend(result.derivative_keys)
    return proof_image_urls


def _proof_doc(detection: Detection, proof_image_urls: list[str]) -> dict[str, Any]:
    """The row's proof document: cleaned post text, then proof images as image nodes.

    One writer for the document and the ``role=proof`` rows, so they cannot drift.
    """
    doc = tiptap_doc_from_text(detection.proof_text)
    if proof_image_urls:
        content = list(doc.get("content", []))
        content.extend({"type": "image", "attrs": {"src": url}} for url in proof_image_urls)
        doc["content"] = content
    return doc


def _proof_image_nodes(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        node
        for node in doc.get("content", [])
        if isinstance(node, dict) and node.get("type") == "image"
    ]


async def _persist_one(
    db: Session,
    *,
    owner: User,
    detection: Detection,
    via: DetectedVia,
    fetch_media: MediaFetcher,
    media_cache: _MediaCache,
) -> Event:
    resolved = (await _resolve_media(detection, fetch_media, media_cache)).items
    uploaded_keys: list[str] = []
    try:
        geo = Event(
            owner_id=owner.id,
            title=detection.title,
            event_coords=from_shape(
                Point(detection.coordinate.lng, detection.coordinate.lat), srid=4326
            ),
            # The declared footage source, distinct from the ``detected_from_url`` provenance.
            # NULL when none declared: the geolocate promotion requires it.
            source_url=detection.source_url,
            proof=_proof_doc(detection, []),
            event_date=detection.event_date,
            source_posted_at=detection.source_posted_at,
            status=STATUS_DETECTED,
            detected_at=datetime.now(UTC),
        )
        # Provenance, written once through the home both write paths read (see
        # :func:`_apply_import_fields`).
        stamp_provenance(
            geo,
            ImportProvenance(
                tweet_id=detection.detected_from_tweet_id,
                url=detection.detected_from_url,
                thread_tweet_ids=list(detection.thread_tweet_ids),
                via=via,
                post_at=detection.detected_post_at,
            ),
        )
        # Already normalized and capped by the resolution.
        geo.source_links = build_source_link_rows(detection.secondary_source_urls)
        db.add(geo)
        db.flush()  # populate geo.id for media keys + the Media FK

        proof_image_urls = await _store_media(db, geo, resolved, uploaded_keys)
        if proof_image_urls:
            geo.proof = _proof_doc(detection, proof_image_urls)  # reassign flags the JSONB dirty
        db.commit()
    except Exception:
        # Roll back before the sweep so an autoflush can't resurrect the half-added Media rows.
        db.rollback()
        sweep_keys(uploaded_keys, context=f"detection persist {detection.detected_from_url}")
        raise
    # No post-commit refresh: a failure would misclassify a durable row as failed.
    # No source archival: a detected row is unpublished and Save Page Now is public. Links are
    # enqueued on publish (``events.geolocate``).
    return geo


def _media_unchanged(stored: list[Media], resolved: list[_ResolvedMedia]) -> bool:
    """Whether the row holds exactly the media the detection resolved to.

    Compared by ``(role, sha256)`` as a multiset, since S3 keys carry a fresh ``uuid4`` per
    upload. A row predating ``sha256`` compares unequal and is replaced (the safe direction).
    """
    if len(stored) != len(resolved):
        return False
    return sorted((m.role, m.sha256 or "") for m in stored) == sorted(
        (item.role, item.sha256) for item in resolved
    )


def _apply_import_fields(db: Session, row: Event, detection: Detection) -> tuple[bool, bool]:
    """Write the scalar state the import owns onto ``row``; returns ``(changed, source_url_changed)``.

    Each field is compared before assignment, so an unchanged re-import emits no UPDATE and
    ``updated_at`` stays still. ``id``, ``owner_id``, ``created_at``, ``detected_at``,
    ``status`` and the four provenance columns are not the import's to move (a bot tag over an
    archive detection still reads ``archive``).
    """
    changed = False
    if _projected(row) != (detection.coordinate.lat, detection.coordinate.lng):
        row.event_coords = from_shape(
            Point(detection.coordinate.lng, detection.coordinate.lat), srid=4326
        )
        changed = True
    for name, value in (
        ("title", detection.title),
        ("event_date", detection.event_date),
        ("source_posted_at", detection.source_posted_at),
        ("detected_post_at", detection.detected_post_at),
    ):
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    source_url_changed = row.source_url != detection.source_url
    if source_url_changed:
        row.source_url = detection.source_url
        changed = True
    if [link.url for link in row.source_links] != detection.secondary_source_urls:
        replace_source_links(db, row, detection.secondary_source_urls)
        changed = True
    return changed, source_url_changed


def _projected(row: Event) -> tuple[float, float]:
    """``(lat, lng)`` for a stored point, the shape a detection carries."""
    point = cast(Point, to_shape(row.event_coords))
    return point.y, point.x


async def _upsert_one(
    db: Session,
    *,
    row: Event,
    detection: Detection,
    fetch_media: MediaFetcher,
    media_cache: _MediaCache,
) -> bool:
    """Overwrite an open detection's import-owned state; ``True`` when anything moved.

    Rewrites title, coordinate, event date, source URL and mirrors, both post instants, proof
    document and media. Keeps id, owner, created and detected times, provenance, and archived
    copies an analyst recorded (:func:`source_archive.reconcile_source_archive` re-files or
    drops only the source copy when the source URL moves).

    Commit-then-sweep (:func:`storage.sweep_keys`): replaced media leaves S3 only after the
    transaction lands, and fresh uploads are swept if it fails.

    Media the fetch could not resolve leaves stored media untouched: a CDN outage looks like a
    post whose media is gone, and replacing would delete rows for a failure that clears itself.
    """
    media_resolution = await _resolve_media(detection, fetch_media, media_cache)
    resolved = media_resolution.items
    # Re-read under a lock and re-run the matrix, as ``events.geolocate`` does: the owner may
    # have published, rejected or been taken down since the unlocked read.
    db.query(Event).filter(Event.id == row.id).populate_existing().with_for_update().one()
    if _row_disposition(row) != "upsert":
        db.rollback()  # drop the lock; a scan of unchanged rows must not hoard them
        return False
    stored = list(row.media)
    if stored and not media_resolution.complete:
        # The fetch came back short, so an outage is indistinguishable from a deletion: keep
        # the stored media.
        logger.warning(
            "Keeping stored media on %s: the re-import resolved none of %s",
            row.id,
            detection.detected_from_url,
        )
        reuse_media = True
    else:
        reuse_media = _media_unchanged(stored, resolved)
        if reuse_media:
            # Proof rows whose image nodes are missing from the document: replace them rather
            # than strand them.
            image_nodes = _proof_image_nodes(row.proof)
            reuse_media = len(image_nodes) == sum(1 for item in resolved if item.role == "proof")
    uploaded_keys: list[str] = []
    replaced_keys: list[str] = []
    try:
        changed, source_url_changed = _apply_import_fields(db, row, detection)
        if source_url_changed:
            # Before the new proof lands, matching ``events.geolocate``.
            reconcile_source_archive(db, event=row)
        if reuse_media:
            proof_image_urls = [str(node["attrs"]["src"]) for node in _proof_image_nodes(row.proof)]
        else:
            replaced_keys = collect_media_keys(stored)
            for media in stored:
                db.delete(media)
            # Flush deletes first: inserts run before deletes, and a replacement source media
            # would collide on ``uq_media_source_per_event``.
            db.flush()
            proof_image_urls = await _store_media(db, row, resolved, uploaded_keys)
            changed = True
        doc = _proof_doc(detection, proof_image_urls)
        if row.proof != doc:
            row.proof = doc
            changed = True
        if not changed:
            # Nothing dirtied. Roll back to drop the row lock the re-read took.
            db.rollback()
            return False
        db.commit()
    except Exception:
        db.rollback()
        sweep_keys(uploaded_keys, context=f"detection upsert {detection.detected_from_url}")
        raise
    sweep_keys(replaced_keys, context=f"detection upsert {row.id} replaced media")
    return True


# Ids per ``IN (...)`` list: a bind list of thousands defeats the planner's index use and some
# drivers refuse it.
_ID_CHUNK = 500


def _id_chunks(ids: list[uuid.UUID]) -> Iterator[list[uuid.UUID]]:
    for start in range(0, len(ids), _ID_CHUNK):
        yield ids[start : start + _ID_CHUNK]


def _rows_without_footage(db: Session, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """The rows carrying no ``role=source`` media, read off the durable rows."""
    stored: set[uuid.UUID] = set()
    for chunk in _id_chunks(ids):
        stored.update(
            event_id
            for (event_id,) in db.query(Media.event_id).filter(
                Media.event_id.in_(chunk), Media.role == "source"
            )
        )
    return set(ids) - stored


def _rows_with_duplicate_media(db: Session, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """The rows whose media already exists on an event outside this pass.

    Exact ``Media.sha256`` equality. The pass's own rows are excluded so a thread's coordinate
    detections, which share one media, never flag each other.
    """
    mine: list[tuple[uuid.UUID, str]] = []
    for chunk in _id_chunks(ids):
        mine.extend(
            (event_id, sha)
            for event_id, sha in db.query(Media.event_id, Media.sha256).filter(
                Media.event_id.in_(chunk), Media.sha256.isnot(None)
            )
            if sha is not None  # narrowing: the filter above already excludes NULL
        )
    if not mine:
        return set()
    own = set(ids)
    shas = sorted({sha for _event_id, sha in mine})
    # Drop the pass's own rows in Python: a ``NOT IN`` over every id is the bind list the
    # chunking avoids.
    elsewhere: set[str] = set()
    for start in range(0, len(shas), _ID_CHUNK):
        for sha, event_id in db.query(Media.sha256, Media.event_id).filter(
            Media.sha256.in_(shas[start : start + _ID_CHUNK])
        ):
            if event_id not in own:
                elsewhere.add(sha)
    return {event_id for event_id, sha in mine if sha in elsewhere}


def _engine_warnings(persisted: list[tuple[uuid.UUID, Detection]]) -> dict[str, int]:
    """The engine's warnings, counted over the detections that produced a row.

    A re-import that overwrote nothing must not report a source to pick or a coordinate to split.
    """
    counts: dict[str, int] = {}
    for _event_id, detection in persisted:
        for code in detection.warnings:
            counts[code] = counts.get(code, 0) + 1
    return counts


class _WarningSubject(Protocol):
    """What :func:`_write_warnings` reads off the engine work behind one row."""

    @property
    def warnings(self) -> list[str]: ...

    @property
    def source_posted_at(self) -> datetime | None: ...

    @property
    def source_fetch_failed(self) -> bool: ...


def _write_warnings(
    db: Session, persisted: Sequence[tuple[uuid.UUID, _WarningSubject]]
) -> dict[str, int]:
    """The warnings only the write path can raise, counted per row it wrote.

    No footage stored from the declared source (``SOURCE_FETCH_FAILED`` when the upstream would
    not answer, else ``SOURCE_FOOTAGE_MISSING``), source post date unknown, and media already on
    Vidit. The footage and date warnings are dropped on a row whose engine work carries
    ``SOURCE_MISSING`` or ``SOURCE_AMBIGUOUS``. Both write paths read it; a request row is never
    footage-less, so the footage legs are reachable only through ``Detection``.
    """
    counts: dict[str, int] = {}
    if not persisted:
        return counts
    ids = [event_id for event_id, _subject in persisted]
    footage_less = _rows_without_footage(db, ids)
    duplicated = _rows_with_duplicate_media(db, ids)
    for event_id, subject in persisted:
        raised: list[str] = []
        if not set(subject.warnings) & {SOURCE_MISSING, SOURCE_AMBIGUOUS}:
            if event_id in footage_less:
                raised.append(
                    SOURCE_FETCH_FAILED if subject.source_fetch_failed else SOURCE_FOOTAGE_MISSING
                )
            if subject.source_posted_at is None:
                raised.append(SOURCE_DATE_UNKNOWN)
        if event_id in duplicated:
            raised.append(DUPLICATE_MEDIA)
        for code in raised:
            counts[code] = counts.get(code, 0) + 1
    return counts


async def persist_detections(
    db: Session,
    *,
    owner: User,
    resolution: Resolution,
    via: DetectedVia,
    fetch_media: MediaFetcher,
    on_progress: Callable[[int, int], None] | None = None,
) -> Outcome:
    """Persist each of the resolution's detections as a ``detected`` ``Event`` owned by ``owner``.

    The one write path for every entry (bot, paste, archive). ``owner`` is the importer, the
    account whose verified handle the posts belong to. ``via`` stamps every created row
    (``events.detected_via``); an upsert leaves it alone.

    A detection is matched on its provenance (the thread's post ids) or its ``source_url``,
    plus the coordinate, across states, then dispatched by :func:`_row_disposition`. A second
    pass over the same export writes nothing and counts as ``skipped``.

    Each detection commits in its own transaction: a raise is caught, counted in
    ``outcome.failed``, rolled back, and the loop moves on, so one failure neither loses the
    others nor strands S3 objects. A detection may carry no media.

    ``on_progress(done, total)`` fires after every handled detection (skips and failures
    included), between per-row transactions, so a callback that commits on the same session
    never splits one.
    """
    detections = resolution.detections
    outcome = Outcome(refusals=resolution.refusals)
    # Every row written, with its detection, for the write-path warnings.
    persisted: list[tuple[uuid.UUID, Detection]] = []
    # Cache scoped to the current thread: a thread's detections are contiguous and share media.
    cache_url: str | None = None
    media_cache: _MediaCache = {}
    total = len(detections)
    if on_progress is not None:
        # Announce the exact total up front (0 / N).
        on_progress(0, total)
    for index, detection in enumerate(detections, start=1):
        if detection.detected_from_url != cache_url:
            cache_url, media_cache = detection.detected_from_url, {}
        verdict, matched = _disposition(db, owner, detection)
        if verdict == "skip":
            if matched is not None:  # always: a skip names the row it protects
                outcome.skipped.append(matched.id)
        elif matched is not None:  # ``upsert``: the verdict carries its row
            try:
                changed = await _upsert_one(
                    db,
                    row=matched,
                    detection=detection,
                    fetch_media=fetch_media,
                    media_cache=media_cache,
                )
            except Exception:
                logger.exception("Detection upsert failed for %s", detection.detected_from_url)
                db.rollback()
                outcome.failed += 1
            else:
                if changed:
                    outcome.updated.append(matched.id)
                    persisted.append((matched.id, detection))
                else:
                    outcome.skipped.append(matched.id)
        else:
            try:
                geo = await _persist_one(
                    db,
                    owner=owner,
                    detection=detection,
                    via=via,
                    fetch_media=fetch_media,
                    media_cache=media_cache,
                )
            except Exception:
                logger.exception("Detection persist failed for %s", detection.detected_from_url)
                db.rollback()
                outcome.failed += 1
            else:
                outcome.created.append(geo.id)
                persisted.append((geo.id, detection))
        if on_progress is not None:
            on_progress(index, total)
    for counts in (_engine_warnings(persisted), _write_warnings(db, persisted)):
        for code, count in counts.items():
            outcome.warnings[code] = outcome.warnings.get(code, 0) + count
    if outcome.created or outcome.updated:
        # A ``detected`` row is public on landing, so drop the ``/points`` cache, once per pass.
        points_cache.invalidate()
    return outcome


def _existing_row_for(db: Session, owner: User, draft: RequestDraft) -> Event | None:
    """The row ``owner`` already holds for the draft's post or source, oldest first.

    Same legs as detections (:func:`_match_legs`) minus the coordinate. Soft-deleted rows are
    excluded, unlike :func:`_row_disposition`: nothing is written onto the match, so a takedown
    must not also fence the owner off from mirroring that footage again.
    """
    legs = _match_legs(
        tweet_id=draft.detected_from_tweet_id,
        thread_tweet_ids=draft.thread_tweet_ids,
        source_url=draft.source_url,
    )
    return (
        db.query(Event)
        .filter(Event.owner_id == owner.id, Event.deleted_at.is_(None), or_(*legs))
        .order_by(Event.created_at, Event.id)
        .first()
    )


@dataclass
class RequestOutcome:
    """A row written, a row already held, or neither.

    At most one of ``created`` / ``existing`` is set. ``refusal`` is a ``REFUSAL_MESSAGES`` code
    when neither is and the machine can say why. ``warnings`` use ``WARNING_MESSAGES``.
    """

    created: uuid.UUID | None = None
    existing: uuid.UUID | None = None
    refusal: str | None = None
    warnings: list[str] = field(default_factory=list)


async def open_request(
    db: Session,
    *,
    owner: User,
    draft: RequestDraft,
    fetch_media: MediaFetcher,
) -> RequestOutcome | None:
    """Write one :class:`RequestDraft` as a ``requested`` row owned by ``owner``.

    The bot's request branch is the one caller. The row is born through
    ``events.create_request`` like a person's request, plus provenance (``detected_via='bot'``)
    so a second mention recognises it. The footage is the draft's ordered candidates; the first
    that fetches fills the source slot, passed as an ``UploadFile`` so the evidence intake
    validates it like an upload.

    A coordinate-less re-tag lands on the existing row through :func:`_existing_row_for` and
    moves nothing. A coordinate-bearing tag on the same source takes the detections' path and
    lands a ``detected`` row beside the open request (:func:`_row_disposition` leaves a
    ``requested`` row alone).

    Warnings come entirely from :func:`_write_warnings`. The engine adds none, and the footage
    warnings never apply since the slot is filled by construction.

    ``None`` means nothing was written and there is nothing to name (no candidate fetched, or
    the write raised): the caller degrades to the refusal reply, and a re-tag retries. An intake
    that refused the file returns ``refusal=FOOTAGE_UNUSABLE`` instead.

    The map cache is not invalidated: a ``requested`` row has no coordinate.
    """
    existing = _existing_row_for(db, owner, draft)
    if existing is not None:
        return RequestOutcome(existing=existing.id)
    fetched: tuple[bytes, str] | None = None
    for candidate in draft.footage_candidates:
        fetched = await fetch_media(candidate)
        if fetched is not None:
            break
    if fetched is None:
        logger.warning(
            "No footage fetched for the request drafted from %s; refusing instead",
            draft.detected_from_url,
        )
        return None
    data, content_type = fetched
    upload = UploadFile(
        file=BytesIO(data),
        filename=f"footage{safe_storage_extension(content_type)}",
        headers=Headers({"content-type": content_type}),
    )
    try:
        row = await create_request(
            db,
            current_user=owner,
            title=draft.title,
            source_url=draft.source_url,
            secondary_source_urls=draft.secondary_source_urls,
            proof_data=tiptap_doc_from_text(draft.proof_text),
            event_date=draft.event_date,
            source_posted_at=draft.source_posted_at,
            tag_ids=[],
            conflict_ids=[],
            file=upload,
            proof_files=[],
            provenance=ImportProvenance(
                tweet_id=draft.detected_from_tweet_id,
                url=draft.detected_from_url,
                thread_tweet_ids=list(draft.thread_tweet_ids),
                via="bot",
                post_at=draft.detected_post_at,
            ),
        )
    except EvidenceIntakeError:
        # Roll back what ``create_request`` staged (event row, source links) so it does not
        # ride the caller's ledger commit.
        logger.warning(
            "The request drafted from %s was refused by the evidence intake",
            draft.detected_from_url,
            exc_info=True,
        )
        db.rollback()
        return RequestOutcome(refusal=FOOTAGE_UNUSABLE)
    except Exception:
        # Transient storage or database failure: log, roll back, and let the caller degrade to
        # the refusal reply (a re-tag retries).
        logger.exception("The request drafted from %s failed to write", draft.detected_from_url)
        db.rollback()
        return None
    # The engine drafts a request with no warnings, so the write path is the whole answer.
    warnings = list(_write_warnings(db, [(row.id, draft)]))
    return RequestOutcome(created=row.id, warnings=warnings)


def linked_owner(db: Session, handle: str) -> User | None:
    """The live Vidit account whose ``x_handle`` is ``handle`` (case-insensitive), or ``None``.

    ``users.x_handle`` is stored lowercase. An import never mints users, and a soft-deleted or
    deactivated account does not count: its work is hidden or suspended.
    """
    return (
        db.query(User)
        .filter(
            User.x_handle == handle.lower(),
            User.deleted_at.is_(None),
            User.is_active.is_(True),
        )
        .first()
    )


class NotYourPost(RuntimeError):
    """The pasted post is not the caller's own; ``code`` is what the router turns into its 400."""

    code = "not_your_post"


async def import_pasted_post(
    db: Session,
    *,
    owner: User,
    url: str,
    client: httpx.Client | None = None,
) -> Outcome:
    """Acquire the post at ``url``, then resolve and persist (the paste entry).

    Own posts only: the author must resolve to ``owner`` through :func:`linked_owner`, else
    :class:`NotYourPost`. The post is read alone and its author checked before the rest of the
    acquisition (parents leg, chase), so a linked account pasting a stranger's post cannot drive
    syndication reads of third-party posts on the shared budget. An unlinked caller is refused
    before any fetch.

    Raises what the acquisition raises (``InvalidTweetUrl``, ``TweetNotAccessible``,
    ``TweetFetchFailed``, ``TweetUpstreamBusy``). ``client`` is for tests.
    """
    linked = owner.x_handle
    if linked is None:
        raise NotYourPost(
            "Link your X account to your Vidit profile first: the import only reads "
            "posts from the handle linked to your account."
        )
    # Blocking network I/O: run it in a thread.
    post = await asyncio.to_thread(read_pasted_post, url, client=client)
    author = post.handle
    matched = linked_owner(db, author)
    # Compare by id: ``owner`` and the matched row can be different instances of one account.
    if matched is None or matched.id != owner.id:
        raise NotYourPost(
            f"That post is by @{author}. The import only reads posts from @{linked}, "
            "the X account linked to your Vidit profile."
        )
    acquired = await asyncio.to_thread(acquire_from_post, post, client=client)
    return await persist_detections(
        db,
        owner=owner,
        resolution=resolve_threads([acquired.records]),
        via="paste",
        fetch_media=fetch_cdn_media,
    )


async def backfill_from_archive(
    db: Session,
    *,
    owner: User,
    archive_dir: Path,
    chase: bool = False,
    on_progress: Callable[[int, int], None] | None = None,
) -> Outcome:
    """Read, stitch, resolve and persist an X export under ``archive_dir``.

    ``chase`` runs the chase step over each stitched thread. Off, the read is pure disk and a
    footage link is stored as a link, with no date and no media.

    Requires ``owner.x_handle``: every provenance permalink and the own-status exclusion are
    written from it (``archive_jobs.process`` gates the worker; this raise is the backstop).
    """
    handle = owner.x_handle
    if handle is None:
        raise ValueError("the archive owner has no linked x_handle")
    threads = stitch(read_tweets(archive_dir, handle=handle))
    if chase:
        threads = [chase_thread(thread) for thread in threads]
    return await persist_detections(
        db,
        owner=owner,
        resolution=resolve_threads(threads),
        via="archive",
        fetch_media=archive_media_fetcher(archive_dir),
        on_progress=on_progress,
    )
