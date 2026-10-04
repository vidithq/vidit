"""The promotion to ``geolocated``: fulfil a request or vouch a detection."""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_REQUESTED, Event
from app.models.user import User
from app.services import source_archive
from app.services.evidence_intake import attach_evidence_and_commit, collect_media_keys
from app.services.permissions import ensure_owner
from app.services.storage import sweep_keys

from .coordinates import _optional_point, validate_coordinates
from .errors import EventStateError, SourceUrlRequiredError
from .rules import (
    _apply_source_removals,
    _credit_geolocator,
    _plan_source_swap,
    _require_proof_image,
    _require_submission_floor,
    _require_submission_media,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .source_links import (
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
    replace_source_links,
)


async def geolocate(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    remove_media_ids: list,
    files: list[UploadFile],
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Transition a ``requested`` or ``detected`` event to ``geolocated``.

    Folds request fulfilment and detection submit into one step. The form posts
    the whole state (including source media: ``files`` added,
    ``remove_media_ids`` dropped). The row is stamped ``geolocated_at`` and the
    caller is credited in ``event_geolocators``. Later edits go through
    :func:`save_version`. ``detected_from_url`` and ``status`` carry no form field.

    ``is_graphic`` ratchets: a posted false leaves an already-flagged event
    flagged. Clearing is admin-only (``PATCH /admin/events/{id}/moderation``).

    The row is re-fetched ``with_for_update()`` first and the status re-checked,
    so two racing geolocates serialize and the loser sees the 409.
    ``uq_media_source_per_event`` is the DB backstop.

    * ``detected``: owner-only (403 otherwise); the owner stays.
    * ``requested``: anyone may answer. ``owner_id`` transfers to
      ``current_user`` and ``requested_by_id`` keeps the original poster.

    Field updates, removals, uploads, the owner transfer and the state flip
    commit in one transaction. A failed upload rolls back and sweeps the new
    keys; the removed media's S3 objects are swept after the commit. Removed
    rows are flushed before the replacement source insert.

    The evidence floor of a direct create is enforced here before any S3 work:
    a non-blank source URL, exactly one source media (kept or new), a proof
    image in the final proof body, a conflict, and a ``capture_source`` tag.

    Secondary links replace the row's wholesale, for a fulfiller too (they are
    mirrors, not the requester's evidence origin).

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` are archived copies
    checked by ``services/source_archive`` and stored in this transaction.
    ``reconcile_source_archive`` always runs, so an edit that changes the source
    URL never leaves the old URL's copy filed.

    Raises :class:`EventStateError` (409) off ``requested`` / ``detected``,
    :class:`InvalidCoordinatesError` / :class:`InvalidProofError` (400) on bad
    values, :class:`SourceUrlRequiredError` / :class:`MediaRequiredError` /
    :class:`ProofImageRequiredError` / :class:`TooManySourceLinksError` /
    :class:`TagRequirementsError` (400) when the floor is unmet,
    :class:`TooManyFilesError` (422) past the one-source cap, or a
    file-validation error.
    """
    # ``populate_existing()`` is load-bearing: the router already loaded this
    # row, so without it the locked SELECT reuses the stale object and the
    # loser reads a pre-lock ``status`` and double-fulfils.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    if geo.status not in (STATUS_REQUESTED, STATUS_DETECTED):
        raise EventStateError("Only requested or detected events can be geolocated")
    if geo.status == STATUS_DETECTED:
        ensure_owner(geo, current_user)
    # A requested event's ``source_url`` is the requester's evidence anchor; a
    # fulfiller must not rewrite it. Captured before ``status`` flips.
    keep_requester_source_url = geo.status == STATUS_REQUESTED

    # A ``geolocated`` row always has a source URL, and a detection may lack one.
    effective_source_url = geo.source_url if keep_requester_source_url else source_url
    if effective_source_url is None or not effective_source_url.strip():
        raise SourceUrlRequiredError("A source URL is required to geolocate an event")

    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # Against the stored source URL, so a repeated anchor is dropped.
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, effective_source_url)

    # Kept plus new uploads must land on exactly one (same rule as :func:`save_version`).
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids, files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # Evidence floor against the post-geolocate state, before any S3 upload.
    _require_submission_media(swap.survivors > 0)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    # The ``geo.tags`` assignment lazy-loads, which would flush a half-mutated row.
    with db.no_autoflush:
        geo.title = title
        geo.event_coords = from_shape(Point(lng, lat), srid=4326)
        geo.capture_source_coords = capture_point
        if not keep_requester_source_url:
            geo.source_url = source_url.strip()
        geo.event_date = event_date
        geo.event_time = event_time
        geo.source_posted_at = source_posted_at
        # Ratchet: the form raises the flag and never lowers it (see docstring).
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    # Hands edit-rights to the fulfiller of a request and records the credit.
    _credit_geolocator(db, geo, current_user)

    replace_source_links(db, geo, secondary_links)

    # Collect the S3 keys first, since the rows go with the flush. No version
    # snapshot references them (this row is at version 1), so they are swept
    # after the commit.
    removed_keys = collect_media_keys(swap.removed)
    _apply_source_removals(db, swap)

    # The archived source follows the stored source URL, and mirror copies file
    # against the links just written (a dropped mirror's copy drops with it).
    # Runs before the upload so a rejected paste costs no S3 round-trip.
    source_archive.reconcile_source_archive(db, event=geo)
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # Empty ``files`` still commits the field and removal edits.
    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=files,
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} geolocate rollback",
    )

    # Best-effort sweep of the removed media.
    sweep_keys(removed_keys, context=f"event {geo.id} geolocate media removal")
    db.refresh(geo)
    points_cache.invalidate()
    return geo
