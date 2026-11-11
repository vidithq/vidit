"""Proof images ride inside the create multipart (``proof_files`` matched to
``placeholder://`` srcs), so there is no standalone proof-image endpoint. Source
files are staged first (``POST /uploads``) and named in ``sources``.
"""

import asyncio
from typing import cast

from fastapi import APIRouter, Depends, Form, Request, status
from geoalchemy2.shape import to_shape
from shapely.geometry import Point

from app.dependencies import DB, CurrentUser
from app.models.event import TITLE_MAX_LENGTH
from app.ratelimit import limiter
from app.routers.events._common import (
    GEOLOCATOR_INVITES_FIELD_DESCRIPTION,
    EventFormFields,
    build_event_read,
    parse_geolocator_invites,
)
from app.schemas.event import EventRead
from app.services import events as events_service

router = APIRouter()


# Both creates are plain ``def`` driving their async service through
# ``asyncio.run``, so queries stay off the event loop (``engineering.md``,
# Request concurrency).
@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_event(
    request: Request,
    current_user: CurrentUser,
    db: DB,
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    geolocator_invites: str | None = Form(None, description=GEOLOCATOR_INVITES_FIELD_DESCRIPTION),
    fields: EventFormFields = Depends(),
):
    """Direct geolocate: create an event born ``geolocated``."""
    form = fields.parse(title)
    geo = asyncio.run(
        events_service.create_with_evidence(
            db,
            current_user=current_user,
            form=form,
            lat=lat,
            lng=lng,
            geolocator_invites=parse_geolocator_invites(geolocator_invites),
        )
    )
    return build_event_read(geo, lat=lat, lng=lng)


@router.post("/requests", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_event_request(
    request: Request,
    current_user: CurrentUser,
    db: DB,
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    # An approximate guess is allowed (both halves or neither).
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    fields: EventFormFields = Depends(),
):
    """Open a request (a ``requested`` event)."""
    form = fields.parse(title, reject_blank_title=True)
    geo = asyncio.run(
        events_service.submit_request(db, current_user=current_user, form=form, lat=lat, lng=lng)
    )
    # Project the optional guess in Python rather than a second ST_X/ST_Y query.
    guess_lat: float | None = None
    guess_lng: float | None = None
    if geo.coords is not None:
        point = cast(Point, to_shape(geo.coords))
        guess_lat, guess_lng = point.y, point.x
    return build_event_read(geo, lat=guess_lat, lng=guess_lng)
