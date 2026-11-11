"""Proof images ride inside the create multipart (``proof_files`` matched to
``placeholder://`` srcs), so there is no standalone proof-image endpoint. Source
files are staged first (``POST /uploads``) and named in ``sources``.
"""

import asyncio

from fastapi import APIRouter, Depends, Form, Request, status

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
from app.schemas.source import CoordsRead
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
    read = build_event_read(geo)
    # The submitted floats, which the stored point can differ from in the last bit.
    read.coords = CoordsRead(lat=lat, lng=lng)
    return read


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
    return build_event_read(geo)
