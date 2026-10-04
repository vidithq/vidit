"""The correction of a published event, filed as a version."""

from __future__ import annotations

from datetime import date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_GEOLOCATED, Event
from app.models.user import User
from app.services import source_archive, versions
from app.services.evidence_intake import attach_evidence_and_commit
from app.services.permissions import ensure_owner

from .coordinates import _optional_point, validate_coordinates
from .errors import EventStateError, NothingChangedError, SourceUrlRequiredError
from .rules import (
    _apply_source_removals,
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


async def save_version(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str | None = None,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None,
    source_posted_at: datetime | None,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    remove_media_ids: list | None = None,
    files: list[UploadFile] | None = None,
    proof_files: list[UploadFile],
    note: str | None = None,
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
    detected_from_snapshot_url: str | None = None,
) -> Event:
    """Correct a published event, filing the superseded state as a version.

    Owner-only, and only on a ``geolocated`` row (before publication there is
    no vouched version to supersede). The pre-edit state is snapshotted into
    ``event_versions`` at the current ``version_no``, the edit is applied, and
    the row takes the next number, in one transaction under the row lock
    :func:`close` and :func:`geolocate` take.

    **The evidence anchor is editable and versioned.** ``source_url`` and the
    ``source`` media are filed like any other field
    (``services/versions.build_snapshot``), so ``/vN`` shows what the claim
    rested on then. Media moves on the ``remove_media_ids`` + ``files`` pair of
    :func:`geolocate` under the same one-source cap. ``source_url`` is optional:
    omitted or empty keeps the stored value, and whitespace-only is refused
    (``ck_events_source_url_status``). Title, both coordinate sets, event date
    and hour, source post time, the graphic flag, tags, conflicts, the proof
    body and its images, and the secondary links are editable and versioned too.

    **The superseded source media keeps its S3 object**, so the version stays
    renderable. It is swept by the event's deletion
    (``evidence_intake.collect_event_media_keys``) or by redaction of the last
    version naming it (``evidence_intake.orphaned_source_media``).

    ``source_posted_at`` is optional (a detection may publish with it NULL):
    ``None`` keeps the stored instant and only a parsed value replaces it.

    ``is_graphic`` ratchets as on :func:`geolocate`.

    ``source_snapshot_url``, ``detected_from_snapshot_url`` (the one link no
    write here can move) and ``secondary_snapshot_urls`` are archived copies.
    They are staged after the superseded version is filed, so the new version
    carries them. ``reconcile_source_archive`` re-files or drops the copy of a
    replaced source URL, and ``source_archive.drop_mirror_archives`` drops the
    copy of a dropped mirror.

    The evidence floor is re-checked against the post-edit state: a ``source``
    media, a proof image in the final proof body, a conflict, and a
    ``capture_source`` tag. An image the new body drops is deleted only if no
    readable version displays it (``services/versions.referenced_media_urls``).

    **A version has to change something.** Incoming state is compared with the
    live row on ``services/versions.COMPARED_FIELDS`` plus the archived copies;
    an edit that moves none raises :class:`NothingChangedError` before the
    version is filed or any upload runs. A source-media swap counts as a change
    by construction (the incoming file has no id or URL until it lands).

    **A save that only archives is exempt from the version ceiling**
    (``MAX_VERSIONS_PER_EVENT``), so a source that dies at the ceiling can
    still be archived.

    Raises :class:`EventStateError` (409) off ``geolocated``, the 403 of
    ``ensure_owner``, :class:`NothingChangedError` (409),
    ``services/versions.VersionLimitError`` (409) at the ceiling,
    :class:`InvalidCoordinatesError` / :class:`InvalidProofError` /
    :class:`ProofImageRequiredError` / :class:`MediaRequiredError` /
    :class:`TagRequirementsError` / :class:`SourceUrlRequiredError` /
    :class:`TooManySourceLinksError` (400), :class:`TooManyFilesError` (422),
    and the shared file-validation errors.
    """
    # Same lock as ``geolocate`` and ``close``: concurrent edits take their
    # ``version_no`` in a defined order. ``populate_existing()`` makes the
    # re-read real, since the router already loaded this row.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status != STATUS_GEOLOCATED:
        raise EventStateError("Only a geolocated event can be edited")

    files = files or []
    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # The router hands an empty form value over as absent, so a blank keeps the stored source.
    if source_url is not None and not source_url.strip():
        raise SourceUrlRequiredError("A source URL is required on a published event")
    effective_source_url = geo.source_url if source_url is None else source_url.strip()
    # Against the stored source URL, so a swapped source is not listed twice.
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, effective_source_url)

    # Before any S3 work, so a refused swap files no version.
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids or [], files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # The floor against the post-edit state (surviving media), before any S3 work.
    _require_submission_media(swap.survivors > 0)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    # An edit that moves nothing is refused: a version spends a number in a
    # public address space (``/events/{id}/vN``) and must record a real change.
    # The note is not compared.
    proposed = {
        "title": title,
        "source_url": effective_source_url,
        "event_coords": {"lat": lat, "lng": lng},
        "capture_source_coords": versions.point_shape(capture_point),
        "event_date": event_date.isoformat() if event_date is not None else None,
        "event_time": event_time.isoformat() if event_time is not None else None,
        # ``None`` keeps the stored value.
        "source_posted_at": (
            source_posted_at.isoformat()
            if source_posted_at is not None
            else (geo.source_posted_at.isoformat() if geo.source_posted_at is not None else None)
        ),
        # Ratcheted as in the write below.
        "is_graphic": geo.is_graphic or is_graphic,
        "secondary_source_urls": secondary_links,
        "tags": versions.tag_entries(effective_tags),
        "conflicts": versions.conflict_entries(effective_conflicts),
        "proof": proof_data if proof_data is not None else geo.proof,
    }
    # Archived copies are their own leg: a paste is a change only where it
    # differs from the link's stored copy, for links the post-edit row keeps.
    # ``same_snapshot`` is the writer's own fold, so a trailing slash is not a change.
    stored_copies = versions.archived_pairs(geo)
    pasted_copies = {
        link: mirror_snapshots[link] for link in secondary_links if link in mirror_snapshots
    }
    if source_snapshot_url and effective_source_url is not None:
        pasted_copies[effective_source_url] = source_snapshot_url
    if detected_from_snapshot_url and geo.detected_from_url is not None:
        pasted_copies[geo.detected_from_url] = detected_from_snapshot_url
    copies_move = any(
        not source_archive.same_snapshot(stored_copies.get(link), snapshot)
        for link, snapshot in pasted_copies.items()
    )
    # Built once: serves the no-change check and the filed snapshot.
    current_snapshot = versions.build_snapshot(geo)
    # The incoming file has no id or URL yet, so the swap itself is the verdict.
    media_move = bool(swap.removed or files)
    fields_move = media_move or not versions.matches_current(current_snapshot, proposed)
    if not fields_move and not copies_move:
        raise NothingChangedError(f"Nothing changed since version {geo.version_no}.")

    # File the superseded version BEFORE any field moves (the snapshot reads the
    # live collections). It also protects that version's images from the
    # intake's proof diff. The ceiling spares a save that only archives.
    versions.file_version(
        db,
        geo=geo,
        edited_by=current_user,
        note=note,
        snapshot=current_snapshot,
        enforce_ceiling=fields_move,
    )

    # The collection assignments lazy-load, which would flush a half-edited row.
    with db.no_autoflush:
        geo.title = title
        if source_url is not None:
            geo.source_url = effective_source_url
        geo.event_coords = from_shape(Point(lng, lat), srid=4326)
        geo.capture_source_coords = capture_point
        geo.event_date = event_date
        geo.event_time = event_time
        # None means keep: an empty datetime input is indistinguishable from an
        # absent field, and assigning it would clear a stored instant.
        if source_posted_at is not None:
            geo.source_posted_at = source_posted_at
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts

    replace_source_links(db, geo, secondary_links)

    # After ``file_version`` (the filed version keeps its copies) and before the pastes.
    source_archive.drop_mirror_archives(db, event=geo, kept=secondary_links)

    # The archived source follows the stored source URL, as in ``geolocate``.
    source_archive.reconcile_source_archive(db, event=geo)

    # After ``file_version``, so the copies land in the new version.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    if detected_from_snapshot_url:
        source_archive.stage_detected_from_snapshot(
            db, event=geo, snapshot_url=detected_from_snapshot_url
        )
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # No S3 sweep: the version filed above renders that media.
    _apply_source_removals(db, swap)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=files,
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} save_version rollback",
    )

    db.refresh(geo)
    # Coordinates may have moved.
    points_cache.invalidate()
    return geo
