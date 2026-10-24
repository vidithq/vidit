"""``GET /sources``: the source picker, to copy an existing source into an event form."""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers.events._common import build_source_read
from app.schemas.source import SourcePickRead
from app.services import search as search_service

router = APIRouter()


@router.get("", response_model=list[SourcePickRead])
@limiter.limit("60/minute")
def pick_sources(
    request: Request,
    q: str = Query(..., min_length=3, max_length=2000, description="A URL or part of a title"),
    limit: int = Query(10, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SourcePickRead]:
    """Sources of live events whose title or one of whose URLs contains ``q``, newest first.

    The form copies a pick into its source list by naming the pick's
    ``media.id`` as ``media_id`` (``SourceCreate``): the copy is a new source
    on the same stored file.
    """
    return [
        SourcePickRead(
            **build_source_read(source).model_dump(),
            event_id=source.event_id,
            event_title=source.event.title,
        )
        for source in search_service.find_sources(db, query=q, limit=limit)
    ]
