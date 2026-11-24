"""An event's links to sites: ``/events/{id}/site-links``."""

import uuid

from fastapi import APIRouter, Request, status

from app.dependencies import DB, CurrentUser, OptionalUser
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import resolve_live_event, resolve_readable_event
from app.schemas.site import EventSiteLinkCreate, EventSiteLinkRead
from app.services import sites as sites_service

router = APIRouter()


@router.get("/{event_id}/site-links", response_model=list[EventSiteLinkRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_links(
    request: Request, event_id: uuid.UUID, db: DB, current_user: OptionalUser
) -> list[EventSiteLinkRead]:
    """The visible sites this event is linked to, oldest link first."""
    geo = resolve_readable_event(db, event_id, current_user)
    return sites_service.list_event_links(db, event_id=geo.id)


@router.post("/{event_id}/site-links", response_model=EventSiteLinkRead)
@limiter.limit("60/minute")
def link_site(
    request: Request,
    event_id: uuid.UUID,
    body: EventSiteLinkCreate,
    db: DB,
    current_user: CurrentUser,
) -> EventSiteLinkRead:
    """Link your published event to a site, or change the effect of its link (idempotent)."""
    geo = resolve_live_event(db, event_id)
    return sites_service.link_event(
        db, event=geo, user=current_user, site_id=body.site_id, effect=body.effect
    )


@router.delete("/{event_id}/site-links/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def unlink_site(
    request: Request,
    event_id: uuid.UUID,
    site_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser,
) -> None:
    """Remove your event's link to a site (owner only). Idempotent (204)."""
    geo = resolve_live_event(db, event_id)
    sites_service.unlink_event(db, event=geo, user=current_user, site_id=site_id)
