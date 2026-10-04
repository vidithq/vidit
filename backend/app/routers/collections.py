"""The ``/collections`` endpoints: one analyst's curated sets of their own events.

Rules live in ``services/collections``; this module resolves the row, hands
the verb its arguments and maps a typed service error to its status.
"""

import uuid
from typing import NoReturn

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.collection import Collection
from app.models.content_report import ContentReport
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import build_event_list
from app.schemas.collection import (
    CollectionCreate,
    CollectionRead,
    CollectionUpdate,
)
from app.schemas.event import EventList
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.services import collections as collections_service
from app.services import reports as reports_service
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_chronological_cursor,
    encode_chronological_cursor,
    next_link,
    page_size,
    take_page,
)

router = APIRouter()


def _raise_collection_error(exc: collections_service.CollectionError) -> NoReturn:
    """Translate a typed collections error into a structured HTTP response."""
    raise_typed_error(exc, collections_service.COLLECTION_ERROR_STATUS)


def _resolve(db: Session, collection_id: uuid.UUID, viewer: User | None) -> Collection:
    """Resolve a readable collection or 404."""
    try:
        return collections_service.resolve_collection(
            db, collection_id=collection_id, viewer=viewer
        )
    except collections_service.CollectionError as exc:
        _raise_collection_error(exc)


@router.post("", response_model=CollectionRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_collection(
    request: Request,
    body: CollectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionRead:
    """Open a collection under a title and description, holding ``event_ids``.

    Ids are optional. With them the create and the shelving are one act under
    the refusals of ``PUT /collections/{id}/events/{event_id}``: a foreign or
    ineligible id fails the whole create.
    """
    try:
        collection = collections_service.create_collection(
            db,
            owner=current_user,
            title=body.title,
            description=body.description,
            event_ids=body.event_ids,
        )
    except collections_service.CollectionError as exc:
        _raise_collection_error(exc)
    return collections_service.build_collection_read(db, collection)


# Ahead of the ``/{collection_id}`` reads (see ``routers/events/item.py``).
@router.post(
    "/{collection_id}/report",
    response_model=ContentReportRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/hour")
def report_collection(
    request: Request,
    collection_id: uuid.UUID,
    body: ContentReportCreate,
    background_tasks: BackgroundTasks,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> ContentReport:
    """Report a collection for moderation.

    Same gesture, body and per-IP limit as an event report: open to anonymous
    viewers (``reporter_user_id`` NULL), a signed-in reporter is recorded. An
    unknown, withheld or orphaned collection answers 404.
    """
    try:
        return reports_service.create_collection_report(
            db,
            collection_id=collection_id,
            reason=body.reason,
            details=body.details,
            reporter_user_id=current_user.id if current_user is not None else None,
            reporter_username=current_user.username if current_user is not None else None,
            background_tasks=background_tasks,
        )
    except reports_service.ReportError as exc:
        raise_typed_error(exc, reports_service.REPORT_ERROR_STATUS)


@router.get("/{collection_id}", response_model=CollectionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_collection(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> CollectionRead:
    """One collection's header: owner, title, item count and date range.
    Public; a withheld collection is a 404 for everyone but an admin."""
    collection = _resolve(db, collection_id, current_user)
    return collections_service.build_collection_read(db, collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
@limiter.limit("30/minute")
def update_collection(
    request: Request,
    collection_id: uuid.UUID,
    body: CollectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionRead:
    """Write your collection's title and description (owner only, else 403).

    Both travel together. A refused description is a 400
    (``invalid_description``), as on create.
    """
    collection = _resolve(db, collection_id, current_user)
    try:
        updated = collections_service.update_collection_details(
            db,
            collection=collection,
            user=current_user,
            title=body.title,
            description=body.description,
        )
    except collections_service.CollectionError as exc:
        _raise_collection_error(exc)
    return collections_service.build_collection_read(db, updated)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_collection(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Drop your collection (owner only). Its events stay."""
    collection = _resolve(db, collection_id, current_user)
    collections_service.delete_collection(db, collection=collection, user=current_user)


@router.get("/{collection_id}/events", response_model=list[EventList])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_collection_events(
    request: Request,
    response: Response,
    collection_id: uuid.UUID,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """The collection's items in the order the events happened.

    Ordered ascending by ``event_date``, ``event_time``, ``created_at``, ``id``;
    a missing date or hour sorts last. Capped at 100 rows; follow the
    ``Link: rel="next"`` cursor, sent exactly when the next page holds a row.
    """
    collection = _resolve(db, collection_id, current_user)
    size = page_size(limit)

    # One row past the page decides whether a ``Link: rel="next"`` goes out.
    window = collections_service.list_items(
        db,
        collection_id=collection.id,
        limit=size + 1,
        cursor=decode_chronological_cursor(cursor) if cursor is not None else None,
    )
    rows, has_next = take_page(window, size)
    if has_next:
        last_event = rows[-1][0]
        response.headers["Link"] = next_link(
            request,
            encode_chronological_cursor(*collections_service.cursor_values(last_event)),
        )
    return [build_event_list(event, lat=lat, lng=lng) for event, lat, lng in rows]


@router.put("/{collection_id}/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def add_event_to_collection(
    request: Request,
    collection_id: uuid.UUID,
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Put one of your events on one of your collections.

    Idempotent (204, no second row). 403 when the collection or the event
    belongs to someone else, 409 when the event's state is not one a collection
    shows.
    """
    collection = _resolve(db, collection_id, current_user)
    try:
        collections_service.add_event(
            db, collection=collection, event_id=event_id, user=current_user
        )
    except collections_service.CollectionError as exc:
        _raise_collection_error(exc)


@router.delete("/{collection_id}/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def remove_event_from_collection(
    request: Request,
    collection_id: uuid.UUID,
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Take one event off your collection (owner only). Idempotent (204); the
    event is untouched."""
    collection = _resolve(db, collection_id, current_user)
    collections_service.remove_event(
        db, collection=collection, event_id=event_id, user=current_user
    )
