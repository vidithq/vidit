"""The request lifecycle before fulfilment: open a request, correct it in place."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.event import STATUS_REQUESTED, DetectedVia, Event, EventDetection
from app.models.user import User
from app.services.event_filters import lock_event
from app.services.permissions import ensure_owner

from .coordinates import _optional_point
from .errors import EventStateError
from .form import EventForm, commit_form, prepare_form, write_form


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
    # When the post the row was read from was posted; not ``occurred_date`` or a source
    # link's ``posted_at``.
    post_at: datetime | None


def stamp_provenance(row: Event, provenance: ImportProvenance) -> None:
    """Attach the ``event_detections`` row to a machine-written ``row``: written once at
    creation and never moved (``detection._apply_import_fields``)."""
    row.detection = EventDetection(
        via=provenance.via,
        from_url=provenance.url,
        from_post_id=provenance.tweet_id,
        thread_post_ids=provenance.thread_tweet_ids or None,
        post_at=provenance.post_at,
    )


async def submit_request(
    db: Session,
    *,
    current_user: User,
    form: EventForm,
    lat: float | None = None,
    lng: float | None = None,
    provenance: ImportProvenance | None = None,
) -> Event:
    """Create a ``requested`` event with its sources (an open call).

    The poster is owner and requester: they keep edit rights until a fulfiller takes over. Only
    the source floor applies; :func:`save_version` enforces the rest at the publish.
    ``provenance``, set by a machine writer, lets a re-import recognise the row.
    """
    guess_point = _optional_point(lat, lng, field="coords")
    prepared = prepare_form(db, form, geo=None, uploader=current_user, publication=False)

    geo = Event(
        owner_id=current_user.id,
        # Survives fulfilment, when ``owner_id`` transfers to the fulfiller.
        requested_by_id=current_user.id,
        # ``proof`` lands via the intake below; the model default covers a blank request.
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    if provenance is not None:
        stamp_provenance(geo, provenance)
    write_form(db, geo, form, prepared, guess_point)
    db.add(geo)
    db.flush()
    return await commit_form(db, geo, form, prepared, sweep_context="event request create rollback")


async def update_request(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    form: EventForm,
    lat: float | None = None,
    lng: float | None = None,
) -> Event:
    """Correct an open request in place (owner-only, only while ``requested``); no version is
    filed.

    The row is locked and the status re-checked, as in :func:`save_version` and
    :func:`close`, so a racing publish or withdrawal gives the loser a 409.
    """
    geo = lock_event(db, geo.id)
    ensure_owner(geo, current_user)
    if geo.status != STATUS_REQUESTED:
        raise EventStateError("Only an open request can be edited")

    guess_point = _optional_point(lat, lng, field="coords")
    prepared = prepare_form(db, form, geo=geo, uploader=current_user, publication=False)
    write_form(db, geo, form, prepared, guess_point)
    # No points-cache invalidation: the map serves located rows only.
    return await commit_form(
        db, geo, form, prepared, sweep_context=f"event {geo.id} request edit rollback"
    )
