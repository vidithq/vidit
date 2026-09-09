"""The two create verbs: a direct geolocation, and an open request.

:func:`create_with_evidence` births a ``geolocated`` row against the whole
evidence floor; :func:`create_request` births a ``requested`` one against the
source-media floor alone, since the geolocate transition owns the rest.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_REQUESTED, Event
from app.models.user import User
from app.services import source_archive
from app.services.evidence_intake import attach_evidence_and_commit

from .coordinates import _optional_point, validate_coordinates
from .rules import (
    _credit_geolocator,
    _require_proof_image,
    _require_submission_floor,
    _require_submission_media,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .source_links import (
    build_source_link_rows,
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
)


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None = None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    file: UploadFile,
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Create a ``geolocated`` event row + its evidence (a direct geolocate).

    The router has already turned raw multipart fields into clean Python
    types; this deals only with business rules and IO. The row is born
    ``geolocated`` (the model's ``status`` server_default), stamped
    ``geolocated_at``, and the creator lands in ``event_geolocators`` (the
    durable credit the owner column alone doesn't carry).

    The full evidence floor applies: subject coordinates, exactly ONE source
    file, at least one proof image in the proof body (a ``placeholder://`` src
    resolved from ``proof_files``, see ``evidence_intake``), a conflict, and
    the curated ``capture_source`` tag. ``capture_source_lat`` / ``lng``
    (the camera point) are optional, both-or-neither.

    ``source_snapshot_url`` is the archived copy of ``source_url`` the analyst
    made while filling the form, and ``secondary_snapshot_urls`` carries the
    same per mirror, aligned with ``secondary_source_urls``: optional, checked
    by ``services/source_archive`` and stored as the event's archived copies in
    this same transaction, so a rejected paste (:class:`SnapshotRejected`,
    raised before any upload) creates no event.

    Failure modes (:class:`EvidenceIntakeError` subclasses, event rules
    here, shared file/media rules from ``evidence_intake``):

    * Out-of-range lat/lng (:class:`InvalidCoordinatesError`)
    * No source file (:class:`MediaRequiredError`)
    * Tiptap proof fails sanitisation (:class:`InvalidProofError`)
    * No proof image (:class:`ProofImageRequiredError`)
    * Missing required conflict / `capture_source` tag
      (:class:`TagRequirementsError`)
    * More secondary source links than the cap
      (:class:`TooManySourceLinksError`)
    * File type/size rejected, a proof placeholder/file mismatch, or the
      uploader raises (``InvalidFileError`` / ``ProofFilesMismatchError`` /
      ``EvidenceProcessingFailedError``)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed before it. Returns the persisted ``Event``,
    refreshed from the row.
    """
    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    # Paired off the raw list, before normalization renumbers it.
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, source_url)

    # Every event needs its footage: exactly one source file.
    _require_submission_media(file is not None)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # The rest of the floor, checked before any upload: a missing tag or an
    # image-less proof 400s without paying an S3 round-trip.
    _require_proof_image(proof_data)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    geo = Event(
        owner_id=current_user.id,
        title=title,
        event_coords=from_shape(Point(lng, lat), srid=4326),
        capture_source_coords=capture_point,
        source_url=source_url,
        # ``proof`` lands via the intake below (placeholders rewritten); the
        # model default keeps the column NOT NULL until then.
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        is_graphic=is_graphic,
        geolocated_at=datetime.now(UTC),
    )
    geo.tags = effective_tags
    geo.conflicts = effective_conflicts
    geo.source_links = build_source_link_rows(secondary_links)

    db.add(geo)
    db.flush()
    # Durable credit: the creator vouched this location. ``owner_id`` is already
    # on the row above; ``_credit_geolocator`` re-asserts it and adds the credit
    # row so the owner-among-geolocators invariant lives in one place.
    _credit_geolocator(db, geo, current_user)

    # The copies the analyst archived while filling the form, the source's and
    # the mirrors'. The rows need the event's id, so they are staged after the
    # flush, and still before the first upload: a rejected paste costs no S3
    # round-trip.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=[file],
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context="event create rollback",
    )

    db.refresh(geo)
    points_cache.invalidate()
    return geo


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
    source_posted_at: datetime,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    file: UploadFile,
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Create a ``requested`` event row + its source media (an open call).

    The router has already parsed the multipart form and rejected blank
    ``title`` / ``source_url`` and malformed JSON; this owns the business
    rules + IO. The row is born ``requested``, stamped ``requested_at``, with
    ``owner_id = requested_by_id = current_user`` so the poster keeps edit
    rights until a fulfiller takes over, and stays credited as the requester
    after.

    Coordinates are OPTIONAL (an approximate guess is allowed on a request,
    both-or-neither), as is the camera point. Tags are optional too: the
    geolocate transition enforces the curated floor. One source file is
    required: a request is an "unfinished geolocation", so the poster's
    evidence must be on the row from the start. The proof body MAY carry images
    (a request can be work started but not finished): they ride in
    ``proof_files`` and resolve against ``placeholder://`` srcs exactly like the
    geolocate path. Unlike a geolocation there is no proof-image floor, so a
    blank request stays imageless.

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` are the archived
    copies of the declared links, on the same terms as
    :func:`create_with_evidence`: the poster archives them while filling the one
    form that posts either shape, so the pastes are kept whichever button they
    press.

    Failure modes: :class:`InvalidCoordinatesError` on a bad / half-typed
    guess, :class:`MediaRequiredError` with no file,
    :class:`InvalidProofError` on an unsanitisable proof,
    :class:`TooManySourceLinksError` past the secondary-link cap, plus the
    shared file-validation errors. Any failure rolls back and sweeps whatever
    landed.
    """
    guess_point = _optional_point(lat, lng, field="event_coords")
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, source_url)

    _require_submission_media(file is not None)

    # Allow optional inline proof images: the intake resolves ``placeholder://``
    # srcs from ``proof_files`` like the geolocate path. No ``_require_proof_image``
    # floor here, a request may be imageless.
    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    geo = Event(
        owner_id=current_user.id,
        # Preserved across fulfilment so the merge doesn't erase who opened the
        # request; ``owner_id`` transfers to the fulfiller, ``requested_by_id``
        # stays put.
        requested_by_id=current_user.id,
        title=title,
        event_coords=guess_point,
        capture_source_coords=capture_point,
        source_url=source_url,
        # ``proof`` lands via the intake below (placeholders rewritten) when
        # present; the model's empty-doc default keeps the column NOT NULL for a
        # blank request.
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        is_graphic=is_graphic,
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    geo.tags = _resolve_tags(db, tag_ids)
    geo.conflicts = _resolve_conflicts(db, conflict_ids)
    geo.source_links = build_source_link_rows(secondary_links)

    db.add(geo)
    db.flush()

    # Same placement as the direct create: after the flush that mints the id,
    # before the first upload.
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
