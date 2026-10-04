"""The request lifecycle before fulfilment: open a request, correct it in place."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.models.event import STATUS_REQUESTED, DetectedVia, Event
from app.models.user import User
from app.services import source_archive
from app.services.evidence_intake import attach_evidence_and_commit, collect_media_keys
from app.services.permissions import ensure_owner
from app.services.storage import sweep_keys

from .coordinates import _optional_point
from .errors import EventStateError
from .rules import (
    _apply_source_removals,
    _plan_source_swap,
    _require_submission_media,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .source_links import (
    build_source_link_rows,
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
    replace_source_links,
)


@dataclass(frozen=True)
class ImportProvenance:
    """Where a machine-written row came from: the post, its thread, the entry.

    Lives here, not in ``services/detection``, which imports this package (a
    cycle otherwise).
    """

    tweet_id: int | None
    url: str
    thread_tweet_ids: list[int]
    via: DetectedVia
    # When the post the row was read from was posted; not ``event_date`` or
    # ``source_posted_at``.
    post_at: datetime | None


def stamp_provenance(row: Event, provenance: ImportProvenance) -> None:
    """Write the five import columns onto a machine-written ``row``.

    Shared by ``detection._persist_one`` and :func:`create_request`. Written
    once at creation and never moved (``detection._apply_import_fields``).
    """
    row.detected_from_tweet_id = provenance.tweet_id
    row.detected_from_url = provenance.url
    row.detected_thread_tweet_ids = provenance.thread_tweet_ids or None
    row.detected_via = provenance.via
    row.detected_post_at = provenance.post_at


async def create_request(
    db: Session,
    *,
    current_user: User,
    title: str,
    source_url: str,
    secondary_source_urls: list[str],
    proof_data: dict | None,
    lat: float | None = None,
    lng: float | None = None,
    capture_source_lat: float | None = None,
    capture_source_lng: float | None = None,
    event_date: date | None = None,
    event_time: time | None = None,
    source_posted_at: datetime | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    file: UploadFile,
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
    provenance: ImportProvenance | None = None,
) -> Event:
    """Create a ``requested`` event with its source media (an open call).

    ``owner_id`` and ``requested_by_id`` are both ``current_user``: the poster
    keeps edit rights until a fulfiller takes over and stays credited as
    requester.

    Coordinates (a guess) and the camera point are optional, both-or-neither.
    Tags are optional (:func:`geolocate` enforces the floor). One source file
    is required. The proof body may carry images (``proof_files`` resolve
    ``placeholder://`` srcs) but has no image floor.

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` are archived copies,
    on the same terms as :func:`create_with_evidence`.

    ``provenance`` is set only by a machine writer (``detection.open_request``)
    and stamps the import columns via :func:`stamp_provenance`, so a re-import
    recognises the row. ``source_posted_at`` is optional here (a chase may
    serve no date); the form keeps it required for people
    (``routers/events/write``).

    Raises :class:`InvalidCoordinatesError`, :class:`MediaRequiredError`,
    :class:`InvalidProofError`, :class:`TooManySourceLinksError`, or a shared
    file-validation error. Any failure rolls back and sweeps what landed.
    """
    guess_point = _optional_point(lat, lng, field="event_coords")
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, source_url)

    _require_submission_media(file is not None)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    geo = Event(
        owner_id=current_user.id,
        # Survives fulfilment, when ``owner_id`` transfers to the fulfiller.
        requested_by_id=current_user.id,
        title=title,
        event_coords=guess_point,
        capture_source_coords=capture_point,
        source_url=source_url,
        # ``proof`` lands via the intake below; the model default covers a blank request.
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        is_graphic=is_graphic,
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    if provenance is not None:
        stamp_provenance(geo, provenance)
    geo.tags = _resolve_tags(db, tag_ids)
    geo.conflicts = _resolve_conflicts(db, conflict_ids)
    geo.source_links = build_source_link_rows(secondary_links)

    db.add(geo)
    db.flush()

    # After the flush that mints the id, before the first upload.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=[file],
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context="event request create rollback",
    )

    db.refresh(geo)
    return geo


async def update_request(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    title: str,
    source_url: str,
    secondary_source_urls: list[str],
    proof_data: dict | None,
    lat: float | None = None,
    lng: float | None = None,
    capture_source_lat: float | None = None,
    capture_source_lng: float | None = None,
    event_date: date | None = None,
    event_time: time | None = None,
    source_posted_at: datetime | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    remove_media_ids: list,
    files: list[UploadFile],
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Correct an open request in place (owner-only, only while ``requested``).

    The form posts the whole state and this overwrites the row. **No version is
    filed**: a request is a question, not a vouched claim. ``updated_at`` moves;
    id, ``requested_at``, requester and provenance stay. Past fulfilment,
    :func:`save_version` does this and files a version.

    Fields follow :func:`create_request`: optional both-or-neither coordinates,
    no curated floor (:func:`geolocate` binds it), links normalized against the
    stored source URL, optional proof images. ``source_posted_at`` is optional
    (the bot may not read a date): None or empty keeps the stored value, as in
    :func:`save_version`, and nothing here clears it. ``is_graphic`` ratchets
    (see :func:`geolocate`).

    Source media moves on the ``remove_media_ids`` + ``files`` pair of
    :func:`geolocate`, under the same one-source cap, and one source must
    remain. Dropped media's S3 objects are swept after the commit (no version
    references them).

    The row is locked and the status re-checked, as in :func:`geolocate`,
    :func:`save_version` and :func:`close`, so a racing fulfilment or withdrawal
    gives the loser a 409.

    Raises :class:`EventStateError` (409) off ``requested``, the 403 of
    ``ensure_owner``, :class:`InvalidCoordinatesError` /
    :class:`InvalidProofError` / :class:`MediaRequiredError` /
    :class:`TooManySourceLinksError` (400), :class:`TooManyFilesError` (422),
    and the shared file-validation errors.
    """
    # ``populate_existing()`` makes the re-read real, not the router's stale object.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status != STATUS_REQUESTED:
        raise EventStateError("Only an open request can be edited")

    guess_point = _optional_point(lat, lng, field="event_coords")
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # Against the stored source URL, so a source moved down to the mirrors is not listed twice.
    stored_source_url = source_url.strip()
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, stored_source_url)

    # Before any S3 work, so a refused swap writes nothing.
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids, files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    _require_submission_media(swap.survivors > 0)

    # The collection assignments lazy-load, which would flush a half-edited row.
    with db.no_autoflush:
        geo.title = title
        geo.source_url = stored_source_url
        geo.event_coords = guess_point
        geo.capture_source_coords = capture_point
        geo.event_date = event_date
        geo.event_time = event_time
        # None means keep: an empty datetime input is indistinguishable from an
        # absent field, and assigning it would clear a stored instant.
        if source_posted_at is not None:
            geo.source_posted_at = source_posted_at
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = _resolve_tags(db, tag_ids)
        geo.conflicts = _resolve_conflicts(db, conflict_ids)

    replace_source_links(db, geo, secondary_links)

    # A dropped mirror takes its copy with it, and the archived source follows
    # the stored URL. Both run before the pastes so a re-paste lands in the freed slot.
    source_archive.drop_mirror_archives(db, event=geo, kept=secondary_links)
    source_archive.reconcile_source_archive(db, event=geo)
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # Collect the keys before the flush drops the rows. Deletes flush before the
    # replacement insert, or ``uq_media_source_per_event`` trips.
    removed_keys = collect_media_keys(swap.removed)
    _apply_source_removals(db, swap)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=files,
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} request edit rollback",
    )

    # Best-effort sweep; no version renders these objects.
    sweep_keys(removed_keys, context=f"event {geo.id} request edit media removal")
    db.refresh(geo)
    # No points-cache invalidation: the map serves located rows only.
    return geo
