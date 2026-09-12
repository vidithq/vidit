"""The ``/collections`` endpoints: one analyst's curated sets of their own events.

Every rule lives in ``services/collections``; this module resolves the row,
hands the verb its arguments, and turns a typed service error into its status.
"""

import uuid
from typing import NoReturn

from fastapi import (
    APIRouter,
    Depends,
    File,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.collection import Collection
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
from app.services import collections as collections_service
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
    """Resolve a readable collection or answer 404, the service's own branch."""
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
    """Open a collection. The title is the only field; it starts empty."""
    collection = collections_service.create_collection(db, owner=current_user, title=body.title)
    return collections_service.build_collection_read(db, collection)


@router.get("/{collection_id}", response_model=CollectionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_collection(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> CollectionRead:
    """One collection's header: owner, title, cover, item count and date range.

    Public, like the events it points at. A withheld collection reads as 404
    for everyone but an admin.
    """
    collection = _resolve(db, collection_id, current_user)
    return collections_service.build_collection_read(db, collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
@limiter.limit("30/minute")
def rename_collection(
    request: Request,
    collection_id: uuid.UUID,
    body: CollectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionRead:
    """Retitle your collection. Owner only; 403 for anyone else."""
    collection = _resolve(db, collection_id, current_user)
    renamed = collections_service.rename_collection(
        db, collection=collection, user=current_user, title=body.title
    )
    return collections_service.build_collection_read(db, renamed)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_collection(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Drop your collection. Owner only. Every event it held stays as it is."""
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
    """The collection's items, in the order the events happened.

    Ordered by ``event_date``, then ``event_time``, then ``created_at``, then
    ``id``, ascending, with an item missing its date or its hour sorting after
    the ones that carry them. Capped at 100 rows however large ``limit`` is; a
    caller reading further follows the ``cursor`` in the ``Link: rel="next"``
    header, which goes out exactly when the next page holds a row.
    """
    collection = _resolve(db, collection_id, current_user)
    size = page_size(limit)

    # One row past the page: its presence is what decides whether a
    # ``Link: rel="next"`` goes out at all.
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

    Idempotent: adding an event already on the collection returns 204 and
    writes no second row. 403 when either the collection or the event belongs
    to someone else, 409 when the event's state is not one a collection shows.
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
    """Take one event off your collection. Owner only.

    Idempotent: removing an event the collection does not hold returns 204.
    The event itself is untouched.
    """
    collection = _resolve(db, collection_id, current_user)
    collections_service.remove_event(
        db, collection=collection, event_id=event_id, user=current_user
    )


@router.put("/{collection_id}/cover", response_model=CollectionRead)
@limiter.limit("20/minute")
async def set_collection_cover(
    request: Request,
    collection_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionRead:
    """Replace your collection's cover with an uploaded image. Owner only.

    The same pipeline the profile picture takes: one image (JPEG / PNG /
    WebP), stored as a stripped and resized JPEG under
    ``collections/{collection id}/``, and the picture it replaced is deleted.
    """
    collection = _resolve(db, collection_id, current_user)
    try:
        updated = await collections_service.set_cover(
            db, collection=collection, user=current_user, file=file
        )
    except collections_service.CollectionError as exc:
        _raise_collection_error(exc)
    return collections_service.build_collection_read(db, updated)


@router.delete("/{collection_id}/cover", response_model=CollectionRead)
@limiter.limit("20/minute")
def delete_collection_cover(
    request: Request,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionRead:
    """Drop your collection's uploaded cover. Owner only.

    The cover falls back to the first chronological item's media. Idempotent:
    removing a cover you never set returns 200.
    """
    collection = _resolve(db, collection_id, current_user)
    updated = collections_service.clear_cover(db, collection=collection, user=current_user)
    return collections_service.build_collection_read(db, updated)
