"""Persist machine detections — ``DetectedGeoloc`` DTOs become ``detected`` rows.

The caller (the archive backfill, later the bot) owns acquire → stitch →
detect; this turns the resulting DTOs into ``Event`` rows owned by the
backfiller, with media through the evidence pipeline and idempotency on
``(detected_from_url OR source_url, coordinate)``. The DTO never reaches the ORM — that
boundary is what keeps ``detect`` pure and reusable across the preview, the
archive backfill, and the bot.

A detection that matches a row the owner already holds resolves through
:func:`_row_disposition`: an open ``detected`` draft is overwritten in place
with the newer parse, and every other shape is left alone.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

import httpx
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.media import Media, MediaRole
from app.models.user import User
from app.services.events import build_source_link_rows, replace_source_links
from app.services.evidence_intake import collect_media_keys
from app.services.sanitize import tiptap_doc_from_text
from app.services.source_archive import reconcile_source_archive
from app.services.storage import (
    PreparedMedia,
    content_sha256,
    detected_media_key,
    get_storage,
    prepare_media,
    sweep_keys,
    upload_prepared_media,
    validate_bytes,
)
from app.services.tweet_ingest import (
    DetectedGeoloc,
    ParsedMedia,
    archive_media_fetcher,
    detect,
    read_tweets,
    record_from_syndication,
    stitch,
)

logger = logging.getLogger(__name__)

# How a caller hands the assemble step the bytes for one piece of media: maps a
# ``ParsedMedia`` to ``(bytes, content_type)``, or ``None`` to skip it (missing
# archive file, untrusted host, fetch failure). The archive backfill reads
# ``tweets_media/`` from disk; the bot fetches the X CDN.
MediaFetcher = Callable[[ParsedMedia], Awaitable[tuple[bytes, str] | None]]

# A media reference → its prepared bytes (or None to skip). Cached per thread so
# a multi-coordinate thread doesn't fetch / strip / derive identical media once
# per coordinate.
_MediaCache = dict[str, PreparedMedia | None]

# Coordinate-equality tolerance for idempotency — matches the dedup rounding in
# ``extract_coords`` so the same coordinate doesn't re-detect as a new pair.
_COORD_PLACES = 6


@dataclass
class AssembleOutcome:
    created: list[Event] = field(default_factory=list)
    updated: int = 0  # an open ``detected`` draft was overwritten with a newer parse
    skipped: int = 0  # a matched row the import must not touch, or one already up to date
    failed: int = 0  # a detection raised mid-persist and was skipped


# What a re-import may do with one detection.
Verdict = Literal["skip", "create", "upsert"]


def _media_type(content_type: str) -> str:
    return "video" if content_type.startswith("video/") else "image"


def preview_detection(url: str, *, client: httpx.Client | None = None) -> list[DetectedGeoloc]:
    """The detections a pasted tweet WOULD produce — no DB writes, no media fetch.

    Acquire (syndication) → stitch → detect over the single tweet at ``url``.
    The inspection window into the machine path: the ``DetectedGeoloc`` DTOs are
    returned as-is for the route to serialize. ``client`` is for tests.
    """
    record = record_from_syndication(url, client=client)
    return [d for thread in stitch([record]) for d in detect(thread)]


def _row_disposition(row: Event) -> Verdict:
    """What a re-import may do with one matched row. One branch per case.

    The whole matrix, in the order it is decided:

    1. An admin removal (``deleted_at``) stays removed. A re-import used to
       resurrect it, which handed anyone whose export still holds the post a
       way to undo a takedown.
    2. A withheld row (``hidden_at``) is frozen for its owner too, whatever its
       status: the rule ``routers/events/_common.resolve_live_event`` states
       for every analyst-facing verb, applied here as well.
    3. Published work (``geolocated``) is never touched by a machine.
    4. An open ``detected`` draft is machine-authored working state that no
       analyst-facing path can edit in place (every field write is welded to
       the ``geolocated`` promotion), so a newer parse overwrites it.
    5. A ``closed`` row was judged and thrown out. A rejected detection stays
       rejected so nobody rejects the same post twice, and a withdrawn request
       is not the import's to reopen.
    6. Anything else live (a ``requested`` event matched through its source
       URL) belongs to a human flow: leave it alone.
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


def _disposition(db: Session, owner: User, dto: DetectedGeoloc) -> tuple[Verdict, Event | None]:
    """Verdict for one detection, with the row it applies to when there is one.

    Scoped to ``owner``: a detection only dedups against the backfiller's own
    rows. (``detected_from_url`` embeds the handle, so it's already owner-unique
    in practice, but the explicit ``owner_id`` filter makes the invariant hold
    even under the ``x_handle``-vs-``username`` fallback.) Among those, looks at
    every row sharing ``detected_from_url`` (or, when the DTO declares one,
    ``source_url``) whatever state that row is in, and matches the coordinate to
    ``_COORD_PLACES``. Each match is read by :func:`_row_disposition`; a single
    ``skip`` among them wins, since a row the import must not touch already
    holds the pair. No match at all → ``create``.

    The ``source_url`` leg catches the delete-and-repost duplicate: the analyst
    posts the same geolocation twice (a typo fix, an X repost), the bot is
    tagged on both, and the two provenance URLs differ while the footage source
    and coordinate are identical. Source-less DTOs keep the provenance-only
    match — NULL declares nothing, so it can't collide.
    """
    match = Event.detected_from_url == dto.detected_from_url
    if dto.source_url is not None:
        match = or_(match, Event.source_url == dto.source_url)
    rows = (
        db.query(Event)
        .filter(
            Event.owner_id == owner.id,
            match,
        )
        # Deterministic pick when several drafts hold the pair: the oldest one.
        .order_by(Event.created_at, Event.id)
        .all()
    )
    draft: Event | None = None
    for row in rows:
        # A ``detected`` row may legitimately carry no coordinate (the model
        # permits it), and can't match a coordinate-bearing detection anyway, so
        # skip it rather than let ``to_shape(None)`` raise and abort the whole
        # re-import for this owner.
        if row.event_coords is None:
            continue
        if not _same_coordinate(row, dto):
            continue
        if _row_disposition(row) == "skip":
            return "skip", None
        if draft is None:
            draft = row
    if draft is None:
        return "create", None
    return "upsert", draft


def _same_coordinate(row: Event, dto: DetectedGeoloc) -> bool:
    """Whether ``row`` sits on the detection's coordinate, to ``_COORD_PLACES``."""
    lat, lng = _projected(row)
    return round(lat, _COORD_PLACES) == round(dto.coordinate.lat, _COORD_PLACES) and round(
        lng, _COORD_PLACES
    ) == round(dto.coordinate.lng, _COORD_PLACES)


async def _prepared_media(
    parsed: ParsedMedia, fetch_media: MediaFetcher, cache: _MediaCache
) -> PreparedMedia | None:
    """Fetch + validate + strip/derive one media, memoised in ``cache``.

    Returns the prepared bytes, or ``None`` to skip (missing file, invalid
    type/size, or undecodable image) — a detection persists media-incomplete
    rather than failing. The strip + derivative work is the expensive part; the
    cache amortises it across a thread's coordinate rows, which share media.
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
            # ValueError is the unusable-media surface: validate_bytes (bad
            # type / size) + EvidenceProcessingError (undecodable image) both
            # subclass it. A broader catch would swallow real bugs as a silent
            # media skip across a whole archive.
            logger.warning("Skipping unusable detection media %s", parsed.remote_url)
            prepared = None
    cache[parsed.remote_url] = prepared
    return prepared


@dataclass(frozen=True)
class _ResolvedMedia:
    """One piece of a detection's media, fetched and prepared, not yet stored.

    Resolving before touching the row is what lets the upsert answer "are these
    the bytes already on the event?" without uploading anything: ``sha256`` is
    the same digest :func:`storage.upload_prepared_media` would persist on the
    ``Media`` row, so the comparison is a string compare.
    """

    role: MediaRole
    prepared: PreparedMedia
    sha256: str


async def _resolve_media(
    dto: DetectedGeoloc, fetch_media: MediaFetcher, media_cache: _MediaCache
) -> list[_ResolvedMedia]:
    """The media a detection wants stored, in the order the row should hold it.

    The footage in the source slot, capped at one
    (``uq_media_source_per_event``): the first source media that fetches and
    prepares cleanly. Then the analyst's annotation (role=proof), several per
    event, no cap. Anything that fetches short or prepares badly drops out: a
    detection persists media-incomplete rather than failing.
    """
    resolved: list[_ResolvedMedia] = []
    for parsed in dto.source_media:
        prepared = await _prepared_media(parsed, fetch_media, media_cache)
        if prepared is None:
            continue
        resolved.append(_ResolvedMedia("source", prepared, content_sha256(prepared.cleaned)))
        break
    for parsed in dto.proof_media:
        # Invariant: every proof row is referenced by the proof doc, and only
        # image nodes go into it, so a non-image proof media would be an
        # orphaned, unreadable blob. Skip it rather than persist bytes the read
        # can never surface.
        if parsed.kind != "image":
            continue
        prepared = await _prepared_media(parsed, fetch_media, media_cache)
        if prepared is None:
            continue
        resolved.append(_ResolvedMedia("proof", prepared, content_sha256(prepared.cleaned)))
    return resolved


async def _store_media(
    db: Session, geo: Event, resolved: list[_ResolvedMedia], uploaded_keys: list[str]
) -> list[str]:
    """Upload ``resolved`` and add the ``Media`` rows; returns the proof image URLs.

    Appends every landed key to ``uploaded_keys`` so a caller whose transaction
    fails can sweep what it stranded.
    """
    storage = get_storage()
    proof_image_urls: list[str] = []
    for item in resolved:
        # Each event owns its own S3 objects (own key) so a per-event
        # hard-delete sweep can't orphan a sibling's media: the cache shares
        # the prepared bytes, not the keys.
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


def _proof_doc(dto: DetectedGeoloc, proof_image_urls: list[str]) -> dict[str, Any]:
    """The row's proof document: the post's cleaned text, then its proof images.

    Proof images travel inside the proof JSON as image nodes (that is how the
    read surfaces them, unlike source media in ``media``), so the document and
    the ``role=proof`` rows are written from one place and cannot drift.
    """
    doc = tiptap_doc_from_text(dto.proof_text)
    if proof_image_urls:
        content = list(doc.get("content", []))
        content.extend({"type": "image", "attrs": {"src": url}} for url in proof_image_urls)
        doc["content"] = content
    return doc


def _proof_image_nodes(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """The image nodes a stored proof document carries, in document order."""
    return [
        node
        for node in doc.get("content", [])
        if isinstance(node, dict) and node.get("type") == "image"
    ]


async def _persist_one(
    db: Session,
    *,
    owner: User,
    dto: DetectedGeoloc,
    fetch_media: MediaFetcher,
    media_cache: _MediaCache,
) -> Event:
    resolved = await _resolve_media(dto, fetch_media, media_cache)
    uploaded_keys: list[str] = []
    try:
        geo = Event(
            owner_id=owner.id,
            title=dto.title,
            event_coords=from_shape(Point(dto.coordinate.lng, dto.coordinate.lat), srid=4326),
            # The declared footage source (the quoted tweet or an off-platform
            # link), distinct from the ``detected_from_url`` provenance link.
            # NULL when the tweet declared none: a ``detected`` draft is partial
            # by definition; the geolocate promotion requires the source.
            source_url=dto.source_url,
            proof=_proof_doc(dto, []),
            event_date=dto.event_date,
            source_posted_at=dto.source_posted_at,
            detected_post_at=dto.detected_post_at,
            status=STATUS_DETECTED,
            detected_at=datetime.now(UTC),
            detected_from_url=dto.detected_from_url,
        )
        # The mirrors the post also linked. Already normalized + capped by the
        # resolution, so no second pass here.
        geo.source_links = build_source_link_rows(dto.secondary_source_urls)
        db.add(geo)
        db.flush()  # populate geo.id for media keys + the Media FK

        proof_image_urls = await _store_media(db, geo, resolved, uploaded_keys)
        if proof_image_urls:
            geo.proof = _proof_doc(dto, proof_image_urls)  # reassign flags the JSONB dirty
        db.commit()
    except Exception:
        # Explicit rollback before the sweep so an autoflush in a downstream
        # handler can't resurrect the half-added Media rows.
        db.rollback()
        sweep_keys(uploaded_keys, context=f"detection assemble {dto.detected_from_url}")
        raise
    # No post-commit refresh: a refresh failure here would misclassify an
    # already-durable row as failed. The geo's attributes lazy-load from the
    # still-open session on access.
    #
    # No source archival here: a detected row is unpublished working state and
    # Save Page Now is public and timestamped. The links are enqueued when the
    # analyst publishes the draft (``events.geolocate``).
    return geo


def _media_unchanged(stored: list[Media], resolved: list[_ResolvedMedia]) -> bool:
    """Whether the row already holds exactly the media the detection resolved to.

    Compared by ``(role, sha256)`` as a multiset: the S3 keys carry a fresh
    ``uuid4`` per upload, so identity is the content, never the URL. A row
    predating the ``sha256`` column compares unequal and is replaced, which is
    the safe direction.
    """
    if len(stored) != len(resolved):
        return False
    return sorted((m.role, m.sha256 or "") for m in stored) == sorted(
        (item.role, item.sha256) for item in resolved
    )


def _apply_import_fields(db: Session, row: Event, dto: DetectedGeoloc) -> tuple[bool, bool]:
    """Write the scalar state the import owns onto ``row``.

    Returns ``(changed, source_url_changed)``. Every field is compared before it
    is assigned, so a re-import of an unchanged post dirties no attribute and
    SQLAlchemy emits no UPDATE, which is what keeps ``updated_at`` still.
    ``id``, ``owner_id``, ``created_at``, ``detected_at``, ``status`` and
    ``detected_from_url`` are not the import's to move: the row keeps its
    identity, its place in the queue and the provenance it was filed under.
    """
    changed = False
    if _projected(row) != (dto.coordinate.lat, dto.coordinate.lng):
        row.event_coords = from_shape(Point(dto.coordinate.lng, dto.coordinate.lat), srid=4326)
        changed = True
    for name, value in (
        ("title", dto.title),
        ("event_date", dto.event_date),
        ("source_posted_at", dto.source_posted_at),
        ("detected_post_at", dto.detected_post_at),
    ):
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    source_url_changed = row.source_url != dto.source_url
    if source_url_changed:
        row.source_url = dto.source_url
        changed = True
    if [link.url for link in row.source_links] != dto.secondary_source_urls:
        replace_source_links(db, row, dto.secondary_source_urls)
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
    dto: DetectedGeoloc,
    fetch_media: MediaFetcher,
    media_cache: _MediaCache,
) -> bool:
    """Overwrite an open draft's import-owned state; ``True`` when anything moved.

    What the import owns it rewrites: the title, the coordinate, the event
    date, the source URL and its mirrors, both post instants, the proof
    document and the media. What the row is keeps: its id, its owner, when it
    was created and detected, the post it was detected from, and the archived
    copies an analyst recorded against links it still carries
    (:func:`source_archive.reconcile_source_archive` re-files or drops only the
    copy filed as the source when the source URL moves).

    Commit-then-sweep, the discipline every delete path follows
    (:func:`storage.sweep_keys`): media the upsert replaced is dropped from S3
    only once the transaction that dropped its rows has landed, and media the
    upsert uploaded is swept when that transaction fails instead.
    """
    resolved = await _resolve_media(dto, fetch_media, media_cache)
    # Re-read the row under a lock and re-run the matrix on it, the same guard
    # ``events.geolocate`` takes: the disposition was decided on an unlocked
    # read, and the owner may have published, rejected or been taken down
    # since. Nothing to do then, which reads as "the import left it alone".
    db.query(Event).filter(Event.id == row.id).populate_existing().with_for_update().one()
    if _row_disposition(row) != "upsert":
        db.rollback()  # drop the lock; a scan of unchanged rows must not hoard them
        return False
    stored = list(row.media)
    reuse_media = _media_unchanged(stored, resolved)
    if reuse_media:
        # Defence for the one shape the equality above cannot see: proof rows
        # whose image nodes are missing from the document. Rewriting the text
        # around them would strand the rows, so replace instead.
        image_nodes = _proof_image_nodes(row.proof)
        reuse_media = len(image_nodes) == sum(1 for item in resolved if item.role == "proof")
    uploaded_keys: list[str] = []
    replaced_keys: list[str] = []
    try:
        changed, source_url_changed = _apply_import_fields(db, row, dto)
        if source_url_changed:
            # Before the new proof lands, matching ``events.geolocate``: the
            # reconcile reads the links the row carries at that moment.
            reconcile_source_archive(db, event=row)
        if reuse_media:
            proof_image_urls = [str(node["attrs"]["src"]) for node in _proof_image_nodes(row.proof)]
        else:
            replaced_keys = collect_media_keys(stored)
            for media in stored:
                db.delete(media)
            # Flush the deletes first: SQLAlchemy emits a mapper's inserts ahead
            # of its deletes, and a replacement source media would collide on
            # ``uq_media_source_per_event`` mid-flush.
            db.flush()
            proof_image_urls = await _store_media(db, row, resolved, uploaded_keys)
            changed = True
        doc = _proof_doc(dto, proof_image_urls)
        if row.proof != doc:
            row.proof = doc
            changed = True
        if not changed:
            # Nothing dirtied, so nothing to commit: the row keeps its
            # ``updated_at`` and the bucket keeps its objects. Roll back anyway,
            # to drop the row lock the re-read took; a re-import of an unchanged
            # export would otherwise hold one per row for the whole scan.
            db.rollback()
            return False
        db.commit()
    except Exception:
        db.rollback()
        sweep_keys(uploaded_keys, context=f"detection upsert {dto.detected_from_url}")
        raise
    sweep_keys(replaced_keys, context=f"detection upsert {row.id} replaced media")
    return True


async def assemble_detections(
    db: Session,
    *,
    owner: User,
    detections: list[DetectedGeoloc],
    fetch_media: MediaFetcher,
    on_progress: Callable[[int, int], None] | None = None,
) -> AssembleOutcome:
    """Persist each detection as a ``detected`` ``Event`` owned by ``owner``.

    ``owner`` is the backfiller — the account whose verified handle the archive
    belongs to; every row is attributed to it. Matched on
    ``(detected_from_url OR source_url, coordinate)`` across states, then
    dispatched by the disposition matrix (see :func:`_row_disposition`): an
    open ``detected`` draft takes the newer parse in place, every other match
    is left untouched, and only an unmatched detection creates a row. A second
    pass over the same export therefore writes nothing at all and counts as
    ``skipped``, not ``updated``.

    Each detection commits in its own transaction so one failure neither loses
    the others nor strands S3 objects — a raise is caught, counted in
    ``outcome.failed``, rolled back, and the loop moves on. A detection may carry
    no media — a ``detected`` row can be media-incomplete until its owner
    completes it before validating.

    ``on_progress(done, total)`` fires after every handled detection (skips
    and failures included: the analyst-facing meaning is "position in the
    scan"). Called between per-row transactions, so a callback that commits
    on the same session never splits one.
    """
    outcome = AssembleOutcome()
    # Media cache scoped to the current thread: ``detect`` emits a thread's
    # coordinate DTOs contiguously sharing one ``detected_from_url`` + media, so
    # resetting on a URL change bounds the cached bytes to one thread.
    cache_url: str | None = None
    media_cache: _MediaCache = {}
    total = len(detections)
    if on_progress is not None:
        # Announce the exact total up front (0 / N), so even a zero-detection
        # archive stamps it and the caller's display leaves the estimate.
        on_progress(0, total)
    for index, dto in enumerate(detections, start=1):
        if dto.detected_from_url != cache_url:
            cache_url, media_cache = dto.detected_from_url, {}
        verdict, matched = _disposition(db, owner, dto)
        if verdict == "skip":
            outcome.skipped += 1
        elif matched is not None:  # ``upsert``: the verdict carries its row
            try:
                changed = await _upsert_one(
                    db,
                    row=matched,
                    dto=dto,
                    fetch_media=fetch_media,
                    media_cache=media_cache,
                )
            except Exception:
                logger.exception("Detection upsert failed for %s", dto.detected_from_url)
                db.rollback()
                outcome.failed += 1
            else:
                if changed:
                    outcome.updated += 1
                else:
                    outcome.skipped += 1
        else:
            try:
                geo = await _persist_one(
                    db,
                    owner=owner,
                    dto=dto,
                    fetch_media=fetch_media,
                    media_cache=media_cache,
                )
            except Exception:
                logger.exception("Detection assemble failed for %s", dto.detected_from_url)
                db.rollback()
                outcome.failed += 1
            else:
                outcome.created.append(geo)
        if on_progress is not None:
            on_progress(index, total)
    return outcome


async def backfill_from_archive(
    db: Session,
    *,
    owner: User,
    archive_dir: Path,
    chase: bool = False,
    on_progress: Callable[[int, int], None] | None = None,
) -> AssembleOutcome:
    """Run a full archive backfill: acquire → stitch → detect → assemble.

    Reads ``owner``'s X export under ``archive_dir`` (``tweets.js`` +
    ``tweets_media/``), rebuilds self-threads, detects coordinates, and persists
    the detections as ``detected`` rows owned by ``owner``, the account whose
    verified handle the archive belongs to.
    """
    handle = owner.x_handle or owner.username
    records = read_tweets(archive_dir, handle=handle, chase=chase)
    detections = [d for thread in stitch(records) for d in detect(thread)]
    return await assemble_detections(
        db,
        owner=owner,
        on_progress=on_progress,
        detections=detections,
        fetch_media=archive_media_fetcher(archive_dir),
    )
