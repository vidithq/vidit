"""The request lifecycle before fulfilment: open a request, correct it in place.

:func:`create_request` births a ``requested`` row, for a person on the form or
for the bot, which stamps its :class:`ImportProvenance` through
:func:`stamp_provenance`. :func:`update_request` is the owner's in-place
correction while the row is still ``requested``. Fulfilment is
``geolocation.geolocate``.
"""

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

    The five provenance columns an import stamps, carried as one argument so a
    write verb takes them together or not at all. It lives in
    ``services/events/request`` rather than in ``services/detection``, the
    import code, because ``services/detection`` imports the ``services/events``
    package, and the reverse would be a cycle.
    """

    tweet_id: int | None
    url: str
    thread_tweet_ids: list[int]
    via: DetectedVia
    # When the analyst posted the post the row was read from. Part of the
    # provenance, not of the event: ``event_date`` and ``source_posted_at`` say
    # when the event happened and when the source posted it.
    post_at: datetime | None


def stamp_provenance(row: Event, provenance: ImportProvenance) -> None:
    """Write the five import columns onto a machine-written ``row``.

    The one home, read by both write paths: ``detection._persist_one`` for a
    detection and :func:`create_request` for a request the bot opened. Stamping
    them in one call is what keeps a column from being set on one path and left
    NULL on the other. Written once at creation and never moved, so a re-import
    through another entry leaves the thread the row was read from and the entry
    that first read it alone (``detection._apply_import_fields``).
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

    ``provenance`` is set only by a machine writer (``detection.open_request``,
    the bot's request branch) and stamps the five import columns through
    :func:`stamp_provenance`, so a machine-opened request is recognised by the
    same re-import match as a detection. A human request carries none of them.
    ``source_posted_at`` is likewise optional here, since a chase may serve no
    date; the form keeps it required for people (``routers/events/write``).

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
    if provenance is not None:
        stamp_provenance(geo, provenance)
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
    """Correct an open request, in place. Owner-only, and only while ``requested``.

    The write the owner of a request holds, whether they opened it on the form
    or the bot opened it for them: the form posts the whole state and this
    overwrites the row with it. **No version is filed.** A version supersedes a
    vouched claim, and a request is a question rather than a claim, so there is
    nothing to supersede; ``updated_at`` moves and the row keeps its id, its
    ``requested_at``, its requester and its provenance columns. Past fulfilment
    the same correction goes through :func:`save_version`, which does file one.

    Every field :func:`create_request` writes is editable on the same rules: the
    coordinate guess and the camera point stay optional and both-or-neither, the
    curated floor stays unenforced (:func:`geolocate` is where it binds), the
    secondary links are normalized against the source URL this write stores, and
    the proof body may carry images or none. ``source_posted_at`` is optional
    here, unlike on the human create form: the bot opens a request whose source
    date it could not read, so an owner correcting that row edits it without
    inventing an instant. Omitted or empty keeps what the row holds, NULL
    included, the rule :func:`save_version` follows; only a value replaces it,
    and nothing on this path clears a stored instant. ``is_graphic`` ratchets as
    it does on every other write, and only
    ``PATCH /admin/events/{id}/moderation`` clears it.

    The source media moves on the ``remove_media_ids`` + ``files`` pair
    :func:`geolocate` takes, under the same one-source cap, and the row must
    still carry its footage afterwards: a request without evidence asks nothing.
    Nothing versioned points at the dropped media (a request is at version 1,
    with no snapshot behind it), so its S3 objects are swept once the commit
    lands.

    Concurrency: the row is re-fetched ``with_for_update()`` FIRST, then the
    status re-checked under the lock, the discipline :func:`geolocate`,
    :func:`save_version` and :func:`close` share. A fulfilment or a withdrawal
    racing this edit therefore serializes with it, and the loser of the race sees
    the 409 rather than writing into a row that has left ``requested``.

    Raises :class:`EventStateError` (409) off ``requested``, the 403 of
    ``ensure_owner`` for anyone but the owner, :class:`InvalidCoordinatesError` /
    :class:`InvalidProofError` / :class:`MediaRequiredError` /
    :class:`TooManySourceLinksError` (400) on a bad value or an unmet floor,
    :class:`TooManyFilesError` (422) past the one-source cap, and the shared
    file-validation errors. Returns the refreshed row.
    """
    # Lock first, re-read under it, then decide: the router already loaded this
    # row into the session identity map, so ``populate_existing()`` is what makes
    # the re-read real rather than a replay of the stale Python object.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status != STATUS_REQUESTED:
        raise EventStateError("Only an open request can be edited")

    guess_point = _optional_point(lat, lng, field="event_coords")
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # Normalized against the source URL this write stores, so an owner who moves
    # the old source down to the mirrors keeps one link in one place.
    stored_source_url = source_url.strip()
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, stored_source_url)

    # The same read, the same cap and the same floor the two published writes
    # run, taken before any S3 work so a refused swap writes nothing.
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids, files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    _require_submission_media(swap.survivors > 0)

    # Suppress autoflush across the edit, as the two published writes do: the
    # collection assignments lazy-load the current sets, which would flush a
    # half-edited row.
    with db.no_autoflush:
        geo.title = title
        geo.source_url = stored_source_url
        geo.event_coords = guess_point
        geo.capture_source_coords = capture_point
        geo.event_date = event_date
        geo.event_time = event_time
        # None means keep, the rule :func:`save_version` holds to: the form
        # posts the whole state and an empty datetime input arrives
        # indistinguishable from an absent field, so assigning unconditionally
        # cleared the instant of a request that carried one on an edit that
        # never touched it.
        if source_posted_at is not None:
            geo.source_posted_at = source_posted_at
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = _resolve_tags(db, tag_ids)
        geo.conflicts = _resolve_conflicts(db, conflict_ids)

    replace_source_links(db, geo, secondary_links)

    # A mirror this edit dropped takes its stored copy with it, and the archived
    # source follows the URL this write stores: a copy of a link the row no
    # longer declares archives nothing the record shows. Both run before the
    # pastes below, so a re-paste lands in the slot the reconciliation freed.
    source_archive.drop_mirror_archives(db, event=geo, kept=secondary_links)
    source_archive.reconcile_source_archive(db, event=geo)
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # Snapshot the dropped media's keys before the rows go with the flush, and
    # flush the deletes ahead of the replacement insert (delete-then-insert, or
    # ``uq_media_source_per_event`` trips mid-flush).
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

    # Committed; sweep the replaced media's objects (best-effort). No version
    # renders them, so nothing is left pointing at what goes.
    sweep_keys(removed_keys, context=f"event {geo.id} request edit media removal")
    db.refresh(geo)
    # No points-cache invalidation: the map serves located rows alone, so a
    # request's guess never entered the cache this write could stale.
    return geo
