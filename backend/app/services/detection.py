"""Persist machine detections: a ``Resolution``'s detections become ``detected`` rows.

:func:`persist_detections` is the one write path, and every entry runs it over
what ``tweet_ingest.resolve_threads`` handed back: the bot over the thread it
acquired, :func:`import_pasted_post` over the post an analyst pasted,
:func:`backfill_from_archive` over every stitched self-thread of an export. It
turns each ``Detection`` into an ``Event`` row owned by the importer, with media
through the evidence pipeline and idempotency on ``(the thread's post ids OR
source_url, coordinate)``. The ``Detection`` never reaches the ORM, which is
what keeps the engine pure.

A detection that matches a row the owner already holds resolves through
:func:`_row_disposition`: an open ``detected`` row is overwritten in place with
the newer parse, and every other shape is left alone.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

import httpx
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

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
    DUPLICATE_MEDIA,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    SOURCE_MISSING,
    Detection,
    ParsedMedia,
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

# How a caller hands the write path the bytes for one piece of media: maps a
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
class Outcome:
    """What one import pass did, row by row.

    The three verdicts carry event ids, in the order the engine produced them,
    so an entry that answers a single post (the paste, the bot's reply) can
    point its caller at the detection it landed on, and an entry that counts a whole
    export reads ``len()``. Ids rather than ORM rows: an export resolves
    thousands of detections in one pass, no caller reads a column off these, and
    holding the mapped objects for the whole pass would keep every one of them
    out of the session's weak identity map until the pass ends.
    """

    created: list[uuid.UUID] = field(default_factory=list)
    # An open detection overwritten with a newer parse.
    updated: list[uuid.UUID] = field(default_factory=list)
    # A matched row the import must not touch, or one already up to date.
    skipped: list[uuid.UUID] = field(default_factory=list)
    failed: int = 0  # a detection raised mid-persist and was skipped
    # What review has to answer on the rows this pass wrote, counted over the
    # created and updated rows alone: the engine's warnings and the write path's
    # both. A pass that wrote nothing reports none, since there is no detection to
    # go and look at. One home, so the bot's reply, the archive's outcome email
    # and the paste's response read the same numbers.
    warnings: dict[str, int] = field(default_factory=dict)
    # How many threads the engine refused under each code, as the resolution
    # counted them.
    refusals: dict[str, int] = field(default_factory=dict)

    @property
    def reason(self) -> str | None:
        """The one refusal to name back to the analyst, or ``None``.

        Set exactly when the pass wrote no row and refused for a single
        reason, which is every refusal a one-thread entry can have (the bot's
        failure reply, the paste's response). An export refusing several
        threads reads :attr:`refusals` instead, so the two never disagree.
        """
        if self.created or self.updated or self.skipped:
            return None
        return sole_refusal(self.refusals)


# What a re-import may do with one detection.
Verdict = Literal["skip", "create", "upsert"]


def _media_type(content_type: str) -> str:
    return "video" if content_type.startswith("video/") else "image"


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
    4. An open detection is machine-authored working state that no
       analyst-facing path can edit in place (every field write is welded to
       the ``geolocated`` promotion), so a newer parse overwrites it.
    5. A ``closed`` row was judged and thrown out, whichever state it left. A
       rejected detection stays rejected so nobody rejects the same post twice,
       a withdrawn request is not the import's to reopen, and a retraction
       (``closed`` off ``geolocated``) is published work its author took back,
       so rule 3 keeps holding after the retraction: no machine writes to a row
       a person published.
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


def _disposition(db: Session, owner: User, detection: Detection) -> tuple[Verdict, Event | None]:
    """Verdict for one detection, with the row it applies to when there is one.

    Scoped to ``owner``: a detection only dedups against the backfiller's own
    rows. Among those, looks at every row the detection's provenance or its
    ``source_url`` matches, whatever state that row is in, and matches the
    coordinate to ``_COORD_PLACES``. Each match is read by
    :func:`_row_disposition`; a single ``skip`` among them wins, since a row the
    import must not touch already holds the pair. No match at all creates.

    The provenance leg is the thread's post ids, not a URL and not the anchor
    alone. Not a URL, because one post spells the same URL several ways
    (``x.com`` or ``twitter.com``, the handle in any case, the handle-less
    ``/i/web/status/`` form). Not the anchor alone, because the entries anchor
    differently on one self-thread: an export stitches A→B→C whole and anchors on
    A, while a bot tag or a paste on C anchors on the head of what the
    acquisition read, B for a post carrying content of its own and higher for a
    bare tag that climbs, so one geolocation imported through two entries would
    land as two detections. The rows
    whose thread shares a post with the incoming one are the match, an array
    overlap, which holds whichever entry ran first. The anchor equality stays for
    the rows written before the array existed.

    The ``source_url`` leg catches the delete-and-repost duplicate: the analyst
    posts the same geolocation twice (a typo fix, an X repost), the bot is
    tagged on both, and the two provenance posts differ while the footage source
    and coordinate are identical. A source-less detection keeps the provenance-only
    match: NULL declares nothing, so it can't collide.

    That leg reads the history as well as the live column. The owner of a
    published row can correct its evidence anchor, and the version filed by that
    edit is what still carries the URL the row was imported under; matching the
    live column alone would let a re-import of a hand-submitted post that has
    since been corrected land as a fresh ``detected`` duplicate of the row it
    already produced. A redacted version's snapshot is blank, so it names no URL
    and matches nothing.

    A ``skip`` carries the row that earned it, so a caller answering one post
    can still name the row its detection landed on. Only ``create`` has no row.
    """
    legs = []
    if detection.detected_from_tweet_id is not None:
        legs.append(Event.detected_from_tweet_id == detection.detected_from_tweet_id)
    if detection.thread_tweet_ids:
        legs.append(Event.detected_thread_tweet_ids.overlap(list(detection.thread_tweet_ids)))
    if detection.source_url is not None:
        legs.append(Event.source_url == detection.source_url)
        legs.append(
            Event.id.in_(
                select(EventVersion.event_id).where(
                    EventVersion.snapshot["source_url"].astext == detection.source_url
                )
            )
        )
    if not legs:
        # No post id and no source: the detection declares nothing an existing
        # row could be recognised by, so it can only be new.
        return "create", None
    rows = (
        db.query(Event)
        .filter(
            Event.owner_id == owner.id,
            or_(*legs),
        )
        # Deterministic pick when several detections hold the pair: the oldest one.
        .order_by(Event.created_at, Event.id)
        .all()
    )
    open_row: Event | None = None
    for row in rows:
        # A ``detected`` row may legitimately carry no coordinate (the model
        # permits it), and can't match a coordinate-bearing detection anyway, so
        # skip it rather than let ``to_shape(None)`` raise and abort the whole
        # re-import for this owner.
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
    """Whether ``row`` sits on the detection's coordinate, to ``_COORD_PLACES``."""
    lat, lng = _projected(row)
    return round(lat, _COORD_PLACES) == round(detection.coordinate.lat, _COORD_PLACES) and round(
        lng, _COORD_PLACES
    ) == round(detection.coordinate.lng, _COORD_PLACES)


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


@dataclass(frozen=True)
class _DetectionMedia:
    """What one detection's media resolved to, and whether any of it went missing.

    ``complete`` is False when the post declares media the fetch could not
    turn into bytes: a source slot nothing filled, or a proof image that came
    back short. The create path stores ``items`` either way, since a detection
    persists media-incomplete rather than failing. The upsert reads
    ``complete``, because a short list there is indistinguishable from "the
    post lost its media" and would delete what the row already holds.
    """

    items: list[_ResolvedMedia]
    complete: bool


async def _resolve_media(
    detection: Detection, fetch_media: MediaFetcher, media_cache: _MediaCache
) -> _DetectionMedia:
    """The media a detection wants stored, in the order the row should hold it.

    The footage in the source slot, capped at one
    (``uq_media_source_per_event``): the first source media that fetches and
    prepares cleanly. Then the analyst's annotation (role=proof), several per
    event, no cap. Anything that fetches short or prepares badly drops out and
    the result is marked incomplete: a detection persists media-incomplete
    rather than failing, and a re-import reads the mark before it replaces
    anything.
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
    # A declared source whose every candidate came back short: the slot the post
    # asks for is empty, so the resolution is short of what the post carries.
    missing = bool(detection.source_media) and not source_filled
    for parsed in detection.proof_media:
        # Invariant: every proof row is referenced by the proof doc, and only
        # image nodes go into it, so a non-image proof media would be an
        # orphaned, unreadable blob. Skip it rather than persist bytes the read
        # can never surface. Not a miss: nothing could ever store it.
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


def _proof_doc(detection: Detection, proof_image_urls: list[str]) -> dict[str, Any]:
    """The row's proof document: the post's cleaned text, then its proof images.

    Proof images travel inside the proof JSON as image nodes (that is how the
    read surfaces them, unlike source media in ``media``), so the document and
    the ``role=proof`` rows are written from one place and cannot drift.
    """
    doc = tiptap_doc_from_text(detection.proof_text)
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
            # The declared footage source (the quoted tweet or an off-platform
            # link), distinct from the ``detected_from_url`` provenance link.
            # NULL when the tweet declared none: a detection is partial
            # by definition; the geolocate promotion requires the source.
            source_url=detection.source_url,
            proof=_proof_doc(detection, []),
            event_date=detection.event_date,
            source_posted_at=detection.source_posted_at,
            detected_post_at=detection.detected_post_at,
            status=STATUS_DETECTED,
            detected_at=datetime.now(UTC),
            detected_from_tweet_id=detection.detected_from_tweet_id,
            detected_from_url=detection.detected_from_url,
            # Provenance, written once: the thread the detection came from and the
            # entry that read it. A re-import through another entry moves
            # neither (see :func:`_apply_import_fields`).
            detected_thread_tweet_ids=list(detection.thread_tweet_ids) or None,
            detected_via=via,
        )
        # The mirrors the post also linked. Already normalized + capped by the
        # resolution, so no second pass here.
        geo.source_links = build_source_link_rows(detection.secondary_source_urls)
        db.add(geo)
        db.flush()  # populate geo.id for media keys + the Media FK

        proof_image_urls = await _store_media(db, geo, resolved, uploaded_keys)
        if proof_image_urls:
            geo.proof = _proof_doc(detection, proof_image_urls)  # reassign flags the JSONB dirty
        db.commit()
    except Exception:
        # Explicit rollback before the sweep so an autoflush in a downstream
        # handler can't resurrect the half-added Media rows.
        db.rollback()
        sweep_keys(uploaded_keys, context=f"detection persist {detection.detected_from_url}")
        raise
    # No post-commit refresh: a refresh failure here would misclassify an
    # already-durable row as failed. The geo's attributes lazy-load from the
    # still-open session on access.
    #
    # No source archival here: a detected row is unpublished working state and
    # Save Page Now is public and timestamped. The links are enqueued when the
    # analyst publishes the detection (``events.geolocate``).
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


def _apply_import_fields(db: Session, row: Event, detection: Detection) -> tuple[bool, bool]:
    """Write the scalar state the import owns onto ``row``.

    Returns ``(changed, source_url_changed)``. Every field is compared before it
    is assigned, so a re-import of an unchanged post dirties no attribute and
    SQLAlchemy emits no UPDATE, which is what keeps ``updated_at`` still.
    ``id``, ``owner_id``, ``created_at``, ``detected_at``, ``status`` and the
    four provenance columns (``detected_from_tweet_id``, ``detected_from_url``,
    ``detected_thread_tweet_ids``, ``detected_via``) are not the import's to
    move: the row keeps its identity, its place in the queue, the thread it was
    read from and the entry that first read it. A bot tag over a detection the
    archive created therefore updates the detection and still reads ``archive``,
    which is what happened.
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

    Media the fetch could not resolve leaves the row's media untouched. A CDN
    that answers nothing for a minute produces the same empty resolution as a
    post whose media is gone, and the two must not read alike: replacing on the
    short list would delete the stored rows and sweep their objects for a
    failure that clears on its own.
    """
    media_resolution = await _resolve_media(detection, fetch_media, media_cache)
    resolved = media_resolution.items
    # Re-read the row under a lock and re-run the matrix on it, the same guard
    # ``events.geolocate`` takes: the disposition was decided on an unlocked
    # read, and the owner may have published, rejected or been taken down
    # since. Nothing to do then, which reads as "the import left it alone".
    db.query(Event).filter(Event.id == row.id).populate_existing().with_for_update().one()
    if _row_disposition(row) != "upsert":
        db.rollback()  # drop the lock; a scan of unchanged rows must not hoard them
        return False
    stored = list(row.media)
    if stored and not media_resolution.complete:
        # Keep what the row holds: the fetch came back short of what the post
        # declares, so there is nothing here that could tell an outage from a
        # deletion. The other fields still update, and a pass that moves
        # nothing else counts the row skipped.
        logger.warning(
            "Keeping stored media on %s: the re-import resolved none of %s",
            row.id,
            detection.detected_from_url,
        )
        reuse_media = True
    else:
        reuse_media = _media_unchanged(stored, resolved)
        if reuse_media:
            # Defence for the one shape the equality above cannot see: proof
            # rows whose image nodes are missing from the document. Rewriting
            # the text around them would strand the rows, so replace instead.
            image_nodes = _proof_image_nodes(row.proof)
            reuse_media = len(image_nodes) == sum(1 for item in resolved if item.role == "proof")
    uploaded_keys: list[str] = []
    replaced_keys: list[str] = []
    try:
        changed, source_url_changed = _apply_import_fields(db, row, detection)
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
        doc = _proof_doc(detection, proof_image_urls)
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
        sweep_keys(uploaded_keys, context=f"detection upsert {detection.detected_from_url}")
        raise
    sweep_keys(replaced_keys, context=f"detection upsert {row.id} replaced media")
    return True


# How many ids one ``IN (...)`` list carries. An export writes thousands of rows
# in a pass, and a single bind list that long is what makes a planner give up on
# the index and what some drivers refuse outright. Chunking keeps the two
# post-pass queries flat in the number of rows the pass wrote.
_ID_CHUNK = 500


def _id_chunks(ids: list[uuid.UUID]) -> Iterator[list[uuid.UUID]]:
    for start in range(0, len(ids), _ID_CHUNK):
        yield ids[start : start + _ID_CHUNK]


def _rows_without_footage(db: Session, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """The rows carrying no ``role=source`` media.

    Read off the durable rows rather than off what the fetch resolved, so the
    warning says what the analyst will actually find on the detection.
    """
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

    Exact ``Media.sha256`` equality; perceptual near-duplicate matching is a
    separate feature. The pass's own rows are excluded from the comparison, so a
    thread's several coordinate detections, which share one media, never flag each
    other.
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
    # The pass's own rows are dropped in Python rather than through a ``NOT IN``
    # over every id it wrote: that exclusion list is the whole pass, which is the
    # bind list the chunking exists to avoid.
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

    ``Resolution.warnings`` counts every detection the engine read. The rows the
    pass wrote are the denominator the analyst can act on: a re-import that
    overwrote nothing leaves no detection to go and look at, so it must not report
    a source to pick or a coordinate to split.
    """
    counts: dict[str, int] = {}
    for _event_id, detection in persisted:
        for code in detection.warnings:
            counts[code] = counts.get(code, 0) + 1
    return counts


def _write_warnings(db: Session, persisted: list[tuple[uuid.UUID, Detection]]) -> dict[str, int]:
    """The warnings only the write path can raise, counted per row it wrote.

    The engine says what it could not settle from the post; these say what the
    row ended up with: no footage was stored from the declared source (a
    link-only source, a media-less or restricted source post, or a fetch that
    came back short), the source's post date came back unknown, and the row's
    media is already on Vidit. Review is the repair for all of them, so they
    read as warnings beside the engine's and are counted the same way.

    A footage-less row whose chase failed on an upstream that would not answer
    (``Detection.source_fetch_failed``, the retry schedule already spent) raises
    ``SOURCE_FETCH_FAILED`` instead: the footage may well exist, so importing the
    post again later is a repair, which it is not for a source that simply
    carries none.

    The footage and date warnings are dropped on a row whose detection already
    carries ``SOURCE_MISSING`` or ``SOURCE_AMBIGUOUS``: an empty source slot
    already says why there is neither footage nor date.
    """
    counts: dict[str, int] = {}
    if not persisted:
        return counts
    ids = [event_id for event_id, _detection in persisted]
    footage_less = _rows_without_footage(db, ids)
    duplicated = _rows_with_duplicate_media(db, ids)
    for event_id, detection in persisted:
        raised: list[str] = []
        if not set(detection.warnings) & {SOURCE_MISSING, SOURCE_AMBIGUOUS}:
            if event_id in footage_less:
                raised.append(
                    SOURCE_FETCH_FAILED if detection.source_fetch_failed else SOURCE_FOOTAGE_MISSING
                )
            if detection.source_posted_at is None:
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
    """Persist each of the resolution's detections as a ``detected`` ``Event``
    owned by ``owner``.

    The one write path, and every entry runs it over what
    ``tweet_ingest.resolve_threads`` handed back: the bot and the paste over the
    single thread they acquired, the archive over every stitched self-thread of
    an export. ``owner`` is the importer, the account whose verified handle the
    posts belong to; every row is attributed to it.

    ``via`` names the entry, and every row this pass creates is stamped with it
    (``events.detected_via``). An upsert leaves it where it was: it says which
    entry first read the post, not which one last touched the row.

    A detection is matched on its provenance (the thread's post ids) or its
    ``source_url``, plus the coordinate, across states, then dispatched by the
    disposition matrix (see :func:`_row_disposition`): an open detection
    takes the newer parse in place, every other match is left untouched, and only
    an unmatched detection creates a row. A second pass over the same export
    therefore writes nothing at all and counts as ``skipped``, not ``updated``,
    and so does the same thread arriving through another entry.

    Each detection commits in its own transaction so one failure neither loses the
    others nor strands S3 objects: a raise is caught, counted in
    ``outcome.failed``, rolled back, and the loop moves on. A detection may carry no
    media, since a ``detected`` row can be media-incomplete until its owner
    completes it before validating.

    The outcome carries the created, updated and skipped ids, the warnings
    review has to answer on the rows the pass wrote, and the resolution's one
    count per refusal code. A caller that resolved a single thread reads
    ``outcome.reason`` for the one code to name back.

    ``on_progress(done, total)`` fires after every handled detection (skips and
    failures included: the analyst-facing meaning is "position in the scan").
    The resolution is already complete, so the total is exact from the first
    call. Called between per-row transactions, so a callback that commits on the
    same session never splits one.
    """
    detections = resolution.detections
    outcome = Outcome(refusals=resolution.refusals)
    # The id of every row this pass wrote, with the detection it was written from,
    # so the write path's own warnings can be read off both at the end.
    persisted: list[tuple[uuid.UUID, Detection]] = []
    # Media cache scoped to the current thread: the engine emits a thread's
    # coordinate detections contiguously sharing one ``detected_from_url`` + media,
    # so resetting on a URL change bounds the cached bytes to one thread.
    cache_url: str | None = None
    media_cache: _MediaCache = {}
    total = len(detections)
    if on_progress is not None:
        # Announce the exact total up front (0 / N), so even a detection-less
        # archive stamps it and the caller's display leaves the estimate.
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
        # A ``detected`` row is public from the moment it lands, so ``/points``
        # must not keep serving a map without it for the cache's TTL. Once for
        # the whole pass, not per row: an export writes thousands, and the cache
        # is process-local and cheap to drop. Every human write invalidates the
        # same way (``services/events``, ``routers/admin``, ``routers/events``).
        points_cache.invalidate()
    return outcome


def linked_owner(db: Session, handle: str) -> User | None:
    """The live Vidit account whose ``x_handle`` is ``handle``, or ``None``.

    The one map from an X handle to the account a machine import may attribute
    to, read by the bot on each mention's author and by :func:`import_pasted_post`
    on the pasted post's author. Case-insensitive: ``users.x_handle`` is stored
    lowercase (``schemas/admin.normalize_x_handle``) and X spells a screen name
    however its owner typed it.

    An import never mints users: attribution requires an existing account whose
    handle was linked (invite-bound at registration, or the admin PATCH). A
    soft-deleted or deactivated account does not count, since its work is hidden
    or suspended, so new detections and billed replies must not land under it.
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
    """The pasted post is not the caller's own.

    Raised by :func:`import_pasted_post` when the caller has no linked
    ``x_handle`` or when the post's author is a different handle. Carries the
    stable ``code`` the router turns into its 400.
    """

    code = "not_your_post"


async def import_pasted_post(
    db: Session,
    *,
    owner: User,
    url: str,
    client: httpx.Client | None = None,
) -> Outcome:
    """The paste entry: acquire the post at ``url``, then resolve and persist.

    Own posts only, the bot's rule: the post's author must resolve to ``owner``
    through :func:`linked_owner`, the same map the bot reads on a mention's
    author, else :class:`NotYourPost`. Someone else's footage goes through the
    plain submit form with a ``source_url``. The handle is checked before the
    fetch when the account has none, so an unlinked caller never spends the
    shared syndication budget.

    The pasted post is read alone and its author checked before the rest of the
    acquisition runs: the parents leg (one hop, or the climb above a bare tag)
    and the chase each fetch posts the pasted URL only points at, so a linked
    account pasting a stranger's post would otherwise drive syndication reads of
    third-party posts on the shared budget.

    Raises what the acquisition raises (``InvalidTweetUrl`` on a URL that names
    no post, ``TweetNotAccessible`` when X serves nothing, ``TweetFetchFailed``
    / ``TweetUpstreamBusy`` on an unusable upstream). The optional ``client`` is
    for tests (an ``httpx.Client`` on a ``MockTransport``).
    """
    linked = owner.x_handle
    if linked is None:
        raise NotYourPost(
            "Link your X account to your Vidit profile first: the import only reads "
            "posts from the handle linked to your account."
        )
    # The acquisition is blocking network I/O; a thread keeps the event loop
    # serving siblings while X answers.
    post = await asyncio.to_thread(read_pasted_post, url, client=client)
    author = post.handle
    matched = linked_owner(db, author)
    # Compared by id, not by object identity: the caller's ``owner`` and the row
    # the handle maps to are the same account whether or not they are the same
    # instance, and an identity test would refuse a valid paste the day the two
    # arrive from different sessions or an expired one.
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
    """Run a full archive backfill: read → stitch → resolve → persist.

    Reads ``owner``'s X export under ``archive_dir`` (``tweets.js`` +
    ``tweets_media/``), rebuilds self-threads, resolves them all, then hands the
    resolution to :func:`persist_detections`, the same write path the bot and the
    paste run. Rows are owned by ``owner``, the account whose verified handle
    the archive belongs to, and a thread the engine refuses is counted in
    ``outcome.refusals`` under the same code the bot names back.

    ``chase`` runs the one chase step over each stitched thread, the same step
    the live acquisition runs over the thread it read. Off, the read is pure disk and a
    footage link is stored as a link, with no date and no media.

    Precondition: ``owner.x_handle`` is set. The handle is what every provenance
    permalink is written from and what the own-status exclusion compares a link
    against, so an import running under a Vidit username would fabricate links
    to an account that may belong to someone else. Every account carries a
    linked handle (bound at invite mint, admin-edited after), and the worker's
    owner gate answers a job whose owner somehow has none
    (``archive_jobs.process``); this raise is the backstop behind it.
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
