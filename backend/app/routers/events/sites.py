"""An event's links to sites: ``/events/{id}/site-links`` and ``/events/{id}/site-suggestions``."""

import uuid

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import resolve_live_event, resolve_readable_event
from app.schemas.site import EventSiteLinkCreate, EventSiteLinkRead, SiteSuggestionRead
from app.services import sites as sites_service

router = APIRouter()


@router.get("/{geolocation_id}/site-links", response_model=list[EventSiteLinkRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_links(
    request: Request,
    geolocation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[EventSiteLinkRead]:
    """The visible sites this event is linked to, oldest link first."""
    geo = resolve_readable_event(db, geolocation_id, current_user)
    return sites_service.list_event_links(db, event_id=geo.id)


@router.post("/{geolocation_id}/site-links", response_model=EventSiteLinkRead)
@limiter.limit("60/minute")
def link_site(
    request: Request,
    geolocation_id: uuid.UUID,
    body: EventSiteLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EventSiteLinkRead:
    """Link your published event to a site, or change the effect of its link (idempotent).

    403 for anyone but the event's owner, 409 ``event_not_linkable`` for an event that is not
    published, 404 ``site_not_found`` for an unknown or withheld site.
    """
    geo = resolve_live_event(db, geolocation_id)
    try:
        return sites_service.link_event(
            db, event=geo, user=current_user, site_id=body.site_id, effect=body.effect
        )
    except sites_service.SiteError as exc:
        raise_typed_error(exc, sites_service.SITE_ERROR_STATUS)


@router.delete("/{geolocation_id}/site-links/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def unlink_site(
    request: Request,
    geolocation_id: uuid.UUID,
    site_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove your event's link to a site (owner only). Idempotent (204)."""
    geo = resolve_live_event(db, geolocation_id)
    sites_service.unlink_event(db, event=geo, user=current_user, site_id=site_id)


@router.get("/{geolocation_id}/site-suggestions", response_model=list[SiteSuggestionRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_suggestions(
    request: Request,
    geolocation_id: uuid.UUID,
    margin_m: float = Query(2000, ge=0, le=sites_service.MAX_MARGIN_M),
    q: str | None = Query(None, min_length=1, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SiteSuggestionRead]:
    """Sites this event may link to, nearest first: those within ``margin_m`` metres of the
    event, or with ``q``, those whose name contains it. Capped at 20."""
    geo = resolve_live_event(db, geolocation_id)
    return sites_service.suggest_sites(db, event=geo, margin_m=margin_m, q=q)
