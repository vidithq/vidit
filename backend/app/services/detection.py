"""Persist machine detections — ``DetectedGeoloc`` DTOs become ``detected`` rows.

The caller (the archive backfill, later the bot) owns acquire → stitch →
detect; this turns the resulting DTOs into ``Event`` rows owned by the
backfiller, with media through the evidence pipeline and idempotency on
``(detected_from_url, coordinate)``. The DTO never reaches the ORM — that
boundary is what keeps ``detect`` pure and reusable across the preview, the
archive backfill, and the bot.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import httpx
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.models.event import STATUS_CLOSED, STATUS_DETECTED, Event
from app.models.media import Media
from app.models.user import User
from app.services.sanitize import tiptap_doc_from_text
from app.services.storage import (
    PreparedMedia,
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
    skipped: int = 0  # a live row already held the pair
    recreated: int = 0  # a soft-deleted (rejected) pair was re-detected
    failed: int = 0  # a detection raised mid-persist and was skipped


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


def _reimportable(row: Event) -> bool:
    """Whether a matched row no longer blocks a re-import.

    Two dismissal shapes exist: an admin soft-delete (``deleted_at``) and an
    owner reject (``closed`` with ``before_closed_status='detected'``). Both
    mean "this pair was judged and thrown out", so a fresh detection recreates
    rather than skips.
    """
    return row.deleted_at is not None or (
        row.status == STATUS_CLOSED and row.before_closed_status == STATUS_DETECTED
    )


def _disposition(db: Session, owner: User, dto: DetectedGeoloc) -> str:
    """Idempotency verdict for one detection: ``skip`` / ``create`` / ``recreate``.

    Scoped to ``owner``: a detection only dedups against the backfiller's own
    rows. (``detected_from_url`` embeds the handle, so it's already owner-unique
    in practice, but the explicit ``owner_id`` filter makes the invariant hold
    even under the ``x_handle``-vs-``username`` fallback.) Among those, looks at
    every row sharing ``detected_from_url`` (including dismissed ones) and
    matches the coordinate to ``_COORD_PLACES``. A live match (geolocated or
    detected) wins → ``skip``; only dismissed matches (soft-deleted, or closed
    off ``detected``, see :func:`_reimportable`) → ``recreate``; no match →
    ``create``.
    """
    rows = (
        db.query(Event)
        .filter(
            Event.owner_id == owner.id,
            Event.detected_from_url == dto.detected_from_url,
        )
        .all()
    )
    dismissed_match = False
    for row in rows:
        # A ``detected`` row may legitimately carry no coordinate (the model
        # permits it), and can't match a coordinate-bearing detection anyway, so
        # skip it rather than let ``to_shape(None)`` raise and abort the whole
        # re-import for this owner.
        if row.event_coords is None:
            continue
        point = cast(Point, to_shape(row.event_coords))
        same = round(point.y, _COORD_PLACES) == round(dto.coordinate.lat, _COORD_PLACES) and round(
            point.x, _COORD_PLACES
        ) == round(dto.coordinate.lng, _COORD_PLACES)
        if not same:
            continue
        if not _reimportable(row):
            return "skip"
        dismissed_match = True
    return "recreate" if dismissed_match else "create"


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


async def _persist_one(
    db: Session,
    *,
    owner: User,
    dto: DetectedGeoloc,
    fetch_media: MediaFetcher,
    is_demo: bool,
    media_cache: _MediaCache,
) -> Event:
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
            proof=tiptap_doc_from_text(dto.proof_text),
            event_date=dto.event_date,
            source_posted_at=dto.source_posted_at,
            detected_post_at=dto.detected_post_at,
            status=STATUS_DETECTED,
            detected_at=datetime.now(UTC),
            detected_from_url=dto.detected_from_url,
            is_demo=is_demo,
        )
        db.add(geo)
        db.flush()  # populate geo.id for media keys + the Media FK

        storage = get_storage()
        # The footage in the source slot, capped at one (``uq_media_source_per_event``):
        # take the first resolved source media that fetches + prepares cleanly.
        for parsed in dto.source_media:
            prepared = await _prepared_media(parsed, fetch_media, media_cache)
            if prepared is None:
                continue
            # Each event owns its own S3 objects (own key) so a per-event
            # hard-delete sweep can't orphan a sibling's media — the cache shares
            # the prepared bytes, not the keys.
            result = await upload_prepared_media(
                prepared, detected_media_key(geo.id, prepared.content_type)
            )
            db.add(
                Media(
                    event_id=geo.id,
                    role="source",
                    storage_url=result.url,
                    media_type=_media_type(prepared.content_type),
                    sha256=result.sha256,
                )
            )
            landed = storage.key_from_url(result.url)
            if landed is not None:
                uploaded_keys.append(landed)
                uploaded_keys.extend(result.derivative_keys)
            break
        # Proof media (the analyst's annotation): role=proof, several per event,
        # no source-slot cap. Proof images travel inside the proof JSON as image
        # nodes (that is how the read surfaces them, unlike source in ``media``),
        # so collect the uploaded image URLs and append them to the proof doc.
        proof_image_urls: list[str] = []
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
            media_type = _media_type(prepared.content_type)
            result = await upload_prepared_media(
                prepared, detected_media_key(geo.id, prepared.content_type)
            )
            db.add(
                Media(
                    event_id=geo.id,
                    role="proof",
                    storage_url=result.url,
                    media_type=media_type,
                    sha256=result.sha256,
                )
            )
            if media_type == "image":
                proof_image_urls.append(result.url)
            landed = storage.key_from_url(result.url)
            if landed is not None:
                uploaded_keys.append(landed)
                uploaded_keys.extend(result.derivative_keys)
        if proof_image_urls:
            doc = dict(geo.proof)
            content = list(doc.get("content", []))
            content.extend({"type": "image", "attrs": {"src": url}} for url in proof_image_urls)
            doc["content"] = content
            geo.proof = doc  # reassign so SQLAlchemy flags the JSONB column dirty
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
    return geo


async def assemble_detections(
    db: Session,
    *,
    owner: User,
    detections: list[DetectedGeoloc],
    fetch_media: MediaFetcher,
    is_demo: bool = False,
) -> AssembleOutcome:
    """Persist each detection as a ``detected`` ``Event`` owned by ``owner``.

    ``owner`` is the backfiller — the account whose verified handle the archive
    belongs to; every row is attributed to it. Idempotent on
    ``(detected_from_url, coordinate)`` across states (see :func:`_disposition`).

    Each detection commits in its own transaction so one failure neither loses
    the others nor strands S3 objects — a raise is caught, counted in
    ``outcome.failed``, rolled back, and the loop moves on. A detection may carry
    no media — a ``detected`` row can be media-incomplete until its owner
    completes it before validating.
    """
    outcome = AssembleOutcome()
    # Media cache scoped to the current thread: ``detect`` emits a thread's
    # coordinate DTOs contiguously sharing one ``detected_from_url`` + media, so
    # resetting on a URL change bounds the cached bytes to one thread.
    cache_url: str | None = None
    media_cache: _MediaCache = {}
    for dto in detections:
        if dto.detected_from_url != cache_url:
            cache_url, media_cache = dto.detected_from_url, {}
        verdict = _disposition(db, owner, dto)
        if verdict == "skip":
            outcome.skipped += 1
            continue
        try:
            geo = await _persist_one(
                db,
                owner=owner,
                dto=dto,
                fetch_media=fetch_media,
                is_demo=is_demo,
                media_cache=media_cache,
            )
        except Exception:
            logger.exception("Detection assemble failed for %s", dto.detected_from_url)
            db.rollback()
            outcome.failed += 1
            continue
        outcome.created.append(geo)
        if verdict == "recreate":
            outcome.recreated += 1
    return outcome


async def backfill_from_archive(
    db: Session,
    *,
    owner: User,
    archive_dir: Path,
    is_demo: bool = False,
    chase: bool = False,
) -> AssembleOutcome:
    """Run a full archive backfill: acquire → stitch → detect → assemble.

    Reads ``owner``'s X export under ``archive_dir`` (``tweets.js`` +
    ``tweets_media/``), rebuilds self-threads, detects coordinates, and persists
    the detections as ``detected`` rows owned by ``owner`` — the account whose
    verified handle the archive belongs to. ``is_demo`` marks the rows wipeable
    (the dev/admin seed path passes it).
    """
    handle = owner.x_handle or owner.username
    records = read_tweets(archive_dir, handle=handle, chase=chase)
    detections = [d for thread in stitch(records) for d in detect(thread)]
    return await assemble_detections(
        db,
        owner=owner,
        detections=detections,
        fetch_media=archive_media_fetcher(archive_dir),
        is_demo=is_demo,
    )
