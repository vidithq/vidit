"""The owner's archived copies of an event's links.

One write verb. The capture itself happens in the analyst's browser, on the
provider's own submit page, so nothing here talks to an archiving service; the
endpoint takes the snapshot URL that came back and hands it to
``services/source_archive`` to be checked and stored.
"""

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers.events._common import raise_archive_error, resolve_live_event
from app.schemas.event import ArchivedLinkRead, EventArchiveCreate
from app.services import permissions
from app.services import source_archive as source_archive_service

router = APIRouter()


@router.post("/{event_id}/archives", response_model=ArchivedLinkRead)
@limiter.limit("60/hour")
def record_archived_copy(
    request: Request,
    event_id: uuid.UUID,
    body: EventArchiveCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record the archived copy of one of this event's links (owner-only).

    ``original_url`` has to be one of the links the event carries (its source,
    a secondary source, the post it was detected from, or a proof citation);
    ``snapshot_url`` has to be an ``https`` URL on one of the three allowed
    archive hosts, and to name the same page. Both checks live in
    ``services/source_archive``; a failure is a 400 carrying the code that says
    which one.

    One copy per link: pasting a second snapshot for a link replaces the first,
    which is how the owner corrects a wrong paste. Soft-deleted → 404, not the
    owner → 403.

    On a ``geolocated`` event the copy is a tracked change: the write files the
    superseded version and the row takes the next ``version_no``, credited to
    the caller. A re-record of the copy the link already carries moves nothing
    and files nothing.

    The ceiling is per hour rather than per minute: one analyst archiving every
    link on a busy event is a run of a dozen calls, and nothing here costs an
    outbound request.
    """
    geo = resolve_live_event(db, event_id)
    permissions.ensure_owner(geo, current_user)
    try:
        row = source_archive_service.record_snapshot(
            db,
            event=geo,
            original_url=body.original_url,
            snapshot_url=body.snapshot_url,
            recorded_by=current_user,
        )
    except source_archive_service.SnapshotRejected as exc:
        raise_archive_error(exc)
    return ArchivedLinkRead(url=row.snapshot_url, provider=row.provider)
