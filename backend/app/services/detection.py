"""Persist machine detections — ``DetectedGeoloc`` DTOs become ``detected`` rows.

The caller (the archive backfill, later the bot) owns acquire → stitch →
detect; this turns the resulting DTOs into ``Geolocation`` rows owned by the
backfiller, with media through the evidence pipeline and idempotency on
``(detected_from_url, coordinate)``. The DTO never reaches the ORM — that
boundary is what keeps ``detect`` pure and reusable across the preview, the
archive backfill, and the bot.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import httpx
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.models.geolocation import STATE_DETECTED, Geolocation
from app.models.media import Media
from app.models.user import User
from app.services.sanitize import tiptap_doc_from_text
from app.services.storage import get_storage, sweep_keys, upload_detected_media
from app.services.tweet_ingest import (
    DetectedGeoloc,
    ParsedMedia,
    archive_media_fetcher,
    detect,
    read_tweets,
    record_from_syndication,
    stitch,
)

# How a caller hands the assemble step the bytes for one piece of media: maps a
# ``ParsedMedia`` to ``(bytes, content_type)``, or ``None`` to skip it (missing
# archive file, untrusted host, fetch failure). The archive backfill reads
# ``tweets_media/`` from disk; the bot (Phase B) fetches the X CDN.
MediaFetcher = Callable[[ParsedMedia], Awaitable[tuple[bytes, str] | None]]

# Coordinate-equality tolerance for idempotency — matches the dedup rounding in
# ``extract_coords`` so the same coordinate doesn't re-detect as a new pair.
_COORD_PLACES = 6


@dataclass
class AssembleOutcome:
    created: list[Geolocation] = field(default_factory=list)
    skipped: int = 0  # a live row already held the pair
    recreated: int = 0  # a soft-deleted (rejected) pair was re-detected


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


def _disposition(db: Session, dto: DetectedGeoloc) -> str:
    """Idempotency verdict for one detection: ``skip`` / ``create`` / ``recreate``.

    Looks at every row sharing ``detected_from_url`` (including soft-deleted)
    and matches the coordinate to ``_COORD_PLACES``. A live match (validated or
    detected) wins → ``skip``; only a soft-deleted match → ``recreate``; no
    match → ``create``.
    """
    rows = (
        db.query(Geolocation).filter(Geolocation.detected_from_url == dto.detected_from_url).all()
    )
    deleted_match = False
    for row in rows:
        point = cast(Point, to_shape(row.location))
        same = round(point.y, _COORD_PLACES) == round(dto.coordinate.lat, _COORD_PLACES) and round(
            point.x, _COORD_PLACES
        ) == round(dto.coordinate.lng, _COORD_PLACES)
        if not same:
            continue
        if row.deleted_at is None:
            return "skip"
        deleted_match = True
    return "recreate" if deleted_match else "create"


async def _persist_one(
    db: Session,
    *,
    owner: User,
    dto: DetectedGeoloc,
    fetch_media: MediaFetcher,
    is_demo: bool,
) -> Geolocation:
    geo = Geolocation(
        author_id=owner.id,
        title=dto.title,
        location=from_shape(Point(dto.coordinate.lng, dto.coordinate.lat), srid=4326),
        # No reliable footage origin from the text alone, so the originating
        # post is the honest source of record; it also surfaces as the distinct
        # ``detected_from_url`` provenance link. The owner can't yet edit
        # ``source_url`` (immutable), which is why it points at the real post,
        # not a guess.
        source_url=dto.detected_from_url,
        proof=tiptap_doc_from_text(dto.proof_text),
        event_date=dto.event_date,
        state=STATE_DETECTED,
        detected_from_url=dto.detected_from_url,
        is_demo=is_demo,
    )
    db.add(geo)
    db.flush()  # populate geo.id for media keys + the Media FK

    uploaded_keys: list[str] = []
    try:
        storage = get_storage()
        for parsed in dto.media:
            fetched = await fetch_media(parsed)
            if fetched is None:
                continue
            data, content_type = fetched
            result = await upload_detected_media(data, content_type, geo.id)
            db.add(
                Media(
                    geolocation_id=geo.id,
                    storage_url=result.url,
                    media_type=_media_type(content_type),
                    sha256=result.sha256,
                )
            )
            landed = storage.key_from_url(result.url)
            if landed is not None:
                uploaded_keys.append(landed)
                uploaded_keys.extend(result.derivative_keys)
        db.commit()
    except Exception:
        # Explicit rollback before the sweep so an autoflush in a downstream
        # handler can't resurrect the half-added Media rows.
        db.rollback()
        sweep_keys(uploaded_keys, context=f"detection assemble {dto.detected_from_url}")
        raise
    db.refresh(geo)
    return geo


async def assemble_detections(
    db: Session,
    *,
    owner: User,
    detections: list[DetectedGeoloc],
    fetch_media: MediaFetcher,
    is_demo: bool = False,
) -> AssembleOutcome:
    """Persist each detection as a ``detected`` ``Geolocation`` owned by ``owner``.

    ``owner`` is the backfiller — the account whose verified handle the archive
    belongs to; every row is attributed to it. Idempotent on
    ``(detected_from_url, coordinate)`` across states (see :func:`_disposition`).

    Each detection commits in its own transaction so one failure neither loses
    the others nor strands S3 objects (its media keys are swept on rollback). A
    detection may carry no media — a ``detected`` row can be media-incomplete
    until its owner completes it before validating (Phase B).
    """
    outcome = AssembleOutcome()
    for dto in detections:
        verdict = _disposition(db, dto)
        if verdict == "skip":
            outcome.skipped += 1
            continue
        geo = await _persist_one(db, owner=owner, dto=dto, fetch_media=fetch_media, is_demo=is_demo)
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
) -> AssembleOutcome:
    """Run a full archive backfill: acquire → stitch → detect → assemble.

    Reads ``owner``'s X export under ``archive_dir`` (``tweets.js`` +
    ``tweets_media/``), rebuilds self-threads, detects coordinates, and persists
    the detections as ``detected`` rows owned by ``owner`` — the account whose
    verified handle the archive belongs to. ``is_demo`` marks the rows wipeable
    (the dev/admin seed path passes it).
    """
    handle = owner.x_handle or owner.username
    records = read_tweets(archive_dir, handle=handle)
    detections = [d for thread in stitch(records) for d in detect(thread)]
    return await assemble_detections(
        db,
        owner=owner,
        detections=detections,
        fetch_media=archive_media_fetcher(archive_dir),
        is_demo=is_demo,
    )
