"""The generalized promotion to ``geolocated``.

One write folds request fulfilment and detection submit: the form posts the
whole state, the row is locked, the evidence floor is checked before any S3
work, and the caller lands in ``event_geolocators``.
"""

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

    The one generalized "give this event a vouched location" write, folding
    request fulfilment and detection submit into a single step. The form posts
    the whole state (title, coordinates, source URL, event date + time, source
    post time, the graphic-content flag, proof + its images, tags, and the
    source media: ``files`` added, ``remove_media_ids`` dropped), and on
    success the row becomes ``geolocated``, stamped ``geolocated_at``, with the
    caller credited in ``event_geolocators``. From there it is corrected through
    :func:`save_version`, which files each superseded version, the evidence
    anchor (``source_url`` and the source media) included. What publication
    fixes is ``detected_from_url``, the provenance anchor, which along with
    ``status`` carries no form field.

    ``is_graphic`` is the one field the form cannot lower: it ratchets, so a
    posted false leaves an already-flagged event flagged. Clearing it is
    admin-only, through ``PATCH /admin/events/{id}/moderation``.

    Concurrency: the row is re-fetched ``with_for_update()`` FIRST, then the
    status re-checked: two racing geolocates serialize on the row lock and
    the loser sees the 409, restoring the pre-merge fulfilment lock (see
    migration ``n0i2d4e6f8a0`` for the historic pattern). The
    ``uq_media_source_per_event`` index is the DB-level backstop.

    Permissions differ by the source state:

    * ``detected``: a machine detection, owner-only: ``current_user`` must be its
      ``owner_id`` (403 otherwise). It stays the owner.
    * ``requested``: an open call anyone may answer: ``owner_id`` (the
      edit-rights owner) transfers to ``current_user``, the fulfiller.
      ``requested_by_id`` is left as the original poster, so the merge preserves
      who asked.

    The field updates, media removals, new uploads, the owner transfer, and the
    state flip commit in a single transaction; a failed upload rolls everything
    back and sweeps the keys that landed (the removals revert with the txn, so
    their S3 stays). The removed media's S3 objects are swept after the commit
    succeeds. Removed-row deletes are flushed BEFORE the replacement source
    insert so the one-source partial unique index isn't tripped mid-flush.

    The evidence floor a direct create meets is enforced here, before any S3
    work, since a request / machine detection is born incomplete: a non-blank
    source URL (a detection may be born without one), exactly one
    source media (kept or new), at least one proof image in the final proof
    body, a conflict, and the curated ``capture_source`` tag.

    The secondary source links replace whatever the row held, wholesale, on a
    requested fulfilment as well as an owner's detected submit. They are
    mirrors, not the evidence origin, so a fulfiller correcting them is an
    edit, not a rewrite of the requester's claim.

    ``source_snapshot_url`` is the archived copy of the stored source URL and
    ``secondary_snapshot_urls`` carries one per submitted mirror, the same
    fields the submit form carries: optional, checked by
    ``services/source_archive``, and stored in this transaction. Whether or not
    the form carries one, ``reconcile_source_archive`` runs, so an edit that
    changes the source URL never leaves a copy of the old one filed as the
    event's archived source (see that function for the drop-or-re-file rule).

    Raises :class:`EventStateError` (409) off ``requested`` / ``detected``,
    :class:`InvalidCoordinatesError` / :class:`InvalidProofError` (400) on bad
    values, :class:`SourceUrlRequiredError` / :class:`MediaRequiredError` /
    :class:`ProofImageRequiredError` / :class:`TooManySourceLinksError` /
    :class:`TagRequirementsError` (400) when the floor is unmet,
    :class:`TooManyFilesError` (422) past the one-source cap, or a
    file-validation error. Returns the refreshed ``geolocated`` row.
    """
    # Fulfilment lock FIRST: serialize on the row, then re-check the status
    # under the lock so a concurrent geolocate can't double-fulfil.
    # ``populate_existing()`` is load-bearing: the router already loaded this
    # row into the session identity map, so without it the locked SELECT reuses
    # that stale Python object and the loser reads a pre-lock ``status``,
    # double-fulfilling despite holding the lock.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    if geo.status not in (STATUS_REQUESTED, STATUS_DETECTED):
        raise EventStateError("Only requested or detected events can be geolocated")
    # A machine detection is owner-only; an open request is answerable by anyone
    # (they become the owner below). ``ensure_owner`` raises 403 on mismatch.
    if geo.status == STATUS_DETECTED:
        ensure_owner(geo, current_user)
    # A requested event's ``source_url`` is the requester's evidence anchor; a
    # fulfiller (anyone may answer an open request) must not rewrite it. Only the
    # owner's own detected submit may change it. Captured before ``status`` flips.
    keep_requester_source_url = geo.status == STATUS_REQUESTED

    # The source floor at promotion: a ``geolocated`` row always carries its
    # footage source. A detection may be born source-less, so the form
    # value (required but possibly blank) must be a real URL here; a requested
    # fulfilment keeps the requester's value, non-NULL by
    # ``ck_events_source_url_status``, checked all the same.
    effective_source_url = geo.source_url if keep_requester_source_url else source_url
    if effective_source_url is None or not effective_source_url.strip():
        raise SourceUrlRequiredError("A source URL is required to geolocate an event")

    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # Normalized against the source URL that will actually be stored, so a
    # fulfiller who repeats the requester's anchor among the mirrors has it
    # dropped rather than stored twice.
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, effective_source_url)

    # Source accounting counts what survives the geolocate: kept existing +
    # new uploads must land on exactly one. The same read
    # :func:`save_version` runs, since one source-media rule serves both writes.
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids, files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # Evidence floor, checked up front (before any S3 upload) against the
    # post-geolocate state: one source survives, the final proof body carries
    # an image, and the conflict + curated tag are set.
    _require_submission_media(swap.survivors > 0)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    # Suppress autoflush across the transition: the ``geo.tags`` assignment
    # lazy-loads the current tags, which would flush the half-mutated row
    # before every stamp is set. The flush happens below, once every field is
    # consistent.
    with db.no_autoflush:
        geo.title = title
        geo.event_coords = from_shape(Point(lng, lat), srid=4326)
        geo.capture_source_coords = capture_point
        if not keep_requester_source_url:
            geo.source_url = source_url.strip()
        geo.event_date = event_date
        geo.event_time = event_time
        geo.source_posted_at = source_posted_at
        # A ratchet, unlike every other field here: the form raises the flag
        # and never lowers it, so a false value against an already-flagged
        # event leaves it set. Clearing is admin-only, through ``PATCH
        # /admin/events/{id}/moderation``, which audits the unmark. An author
        # who mis-flags their own event asks an admin to undo it.
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    # Fulfilling an open request hands edit-rights to the fulfiller (the original
    # poster stays on ``requested_by_id``) and records durable credit. Both go
    # through ``_credit_geolocator`` so the owner-among-geolocators invariant is
    # written in one place. Idempotent by PK; a first geolocate has no prior row.
    _credit_geolocator(db, geo, current_user)

    # The submitted mirrors replace the stored ones wholesale (see the
    # docstring: they carry none of ``source_url``'s requester protection).
    replace_source_links(db, geo, secondary_links)

    # Drop the source media flagged for removal: snapshot their S3 keys first,
    # since the rows go with the flush. Nothing versioned points at them (a row
    # publishing here is at version 1, with no snapshot behind it), so the
    # objects are swept once the commit lands.
    removed_keys = collect_media_keys(swap.removed)
    _apply_source_removals(db, swap)

    # The archived source follows the source URL this write stores: a copy of a
    # URL that is no longer the source is re-filed or dropped, and the paste the
    # form carried fills the slot. The mirrors' copies file against the links
    # ``replace_source_links`` just wrote, so a snapshot posted beside a mirror
    # this write dropped is dropped with it. All of it runs before the upload,
    # so a rejected paste costs no S3 round-trip, and inside this transaction,
    # so a failure takes it back with everything else.
    source_archive.reconcile_source_archive(db, event=geo)
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # Upload new files + commit everything atomically; rollback-sweeps the new
    # uploads on failure. Empty ``files`` still commits the field + removal edits.
    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=files,
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} geolocate rollback",
    )

    # Committed; sweep the removed media's S3 objects (best-effort).
    sweep_keys(removed_keys, context=f"event {geo.id} geolocate media removal")
    db.refresh(geo)
    points_cache.invalidate()
    return geo
