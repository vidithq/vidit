"""The ``/collections`` endpoints: one analyst's curated sets of their own events.

Rules live in ``services/collections``; this module resolves the row and hands
the verb its arguments.
"""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.content_report import ContentReport
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import build_event_list
from app.schemas.collection import (
    CollectableCount,
    CollectionBulkAdd,
    CollectionBulkAddResult,
    CollectionBulkAddSkipped,
    CollectionCreate,
    CollectionRead,
    CollectionUpdate,
    SearchMatch,
)
from app.schemas.event import EventList
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.services import collections as collections_service
from app.services import collections_bulk
from app.services import reports as reports_service
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_chronological_cursor,
    decode_cursor,
    encode_chronological_cursor,
    encode_cursor,
    page_size,
    paged,
)

router = APIRouter()


@router.post("", response_model=CollectionRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_collection(
    request: Request,
    body: CollectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionRead:
    """Open a collection under a title and description, holding ``event_ids``."""
    collection = collections_service.create_collection(
        db,
        owner=current_user,
        title=body.title,
        description=body.description,
        event_ids=body.event_ids,
    )
    return collections_service.build_collection_read(db, collection)


# Ahead of the ``/{collection_id}`` reads (see ``routers/events/item.py``).
@router.post("/collectable-count", response_model=CollectableCount)
@limiter.limit("60/minute")
def count_collectable_matches(
    request: Request,
    body: SearchMatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectableCount:
    """Count your events a search lists in its Geolocations group that a collection can hold."""
    return CollectableCount(total=collections_bulk.count_matches(db, match=body, user=current_user))


@router.post("/collectable-events", response_model=list[EventList])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_collectable_matches(
    request: Request,
    response: Response,
    body: SearchMatch,
    limit: int = Query(20, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[EventList]:
    """Page through the events ``POST /collections/collectable-count`` counts, newest first."""
    size = page_size(limit)
    window = collections_bulk.list_matches(
        db,
        match=body,
        user=current_user,
        limit=size,
        after=decode_cursor(cursor) if cursor is not None else None,
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r[0].created_at, r[0].id))
    return [build_event_list(event, lat=lat, lng=lng) for event, lat, lng in rows]


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
    """Report a collection for moderation."""
    return reports_service.create_report(
        db,
        kind="collection",
        target_id=collection_id,
        body=body,
        reporter=current_user,
        background_tasks=background_tasks,
    )


@router.get("/{collection_id}", response_model=CollectionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_collection(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> CollectionRead:
    """One collection's header: owner, title, item count and date range."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
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
    """Write your collection's title and description (owner only, else 403)."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
    updated = collections_service.update_collection_details(
        db,
        collection=collection,
        user=current_user,
        title=body.title,
        description=body.description,
    )
    return collections_service.build_collection_read(db, updated)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_collection(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Drop your collection (owner only)."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
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
    """The collection's items in the order the events happened."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
    size = page_size(limit)
    window = collections_service.list_items(
        db,
        collection_id=collection.id,
        limit=size,
        cursor=decode_chronological_cursor(cursor) if cursor is not None else None,
    )
    rows = paged(
        request,
        response,
        window,
        size,
        lambda r: encode_chronological_cursor(*collections_service.cursor_values(r[0])),
    )
    return [build_event_list(event, lat=lat, lng=lng) for event, lat, lng in rows]


@router.post("/{collection_id}/events", response_model=CollectionBulkAddResult)
@limiter.limit("10/minute")
def add_events_to_collection(
    request: Request,
    collection_id: uuid.UUID,
    body: CollectionBulkAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionBulkAddResult:
    """Put many of your events on one of your collections, by id or by search, in one write."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
    outcome = collections_bulk.add_events(
        db,
        collection=collection,
        user=current_user,
        event_ids=body.event_ids,
        match=body.match,
        exclude_event_ids=body.exclude_event_ids,
    )
    return CollectionBulkAddResult(
        added=outcome.added,
        skipped=CollectionBulkAddSkipped(
            already_in_collection=outcome.already_in_collection,
            not_collectable=outcome.not_collectable,
        ),
    )


@router.put("/{collection_id}/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def add_event_to_collection(
    request: Request,
    collection_id: uuid.UUID,
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Put one of your events on one of your collections."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
    collections_service.add_event(db, collection=collection, event_id=event_id, user=current_user)


@router.delete("/{collection_id}/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def remove_event_from_collection(
    request: Request,
    collection_id: uuid.UUID,
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Take one event off your collection (owner only)."""
    collection = collections_service.resolve_collection(
        db, collection_id=collection_id, viewer=current_user
    )
    collections_service.remove_event(
        db, collection=collection, event_id=event_id, user=current_user
    )
