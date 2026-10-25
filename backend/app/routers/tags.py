import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.event import Event
from app.models.source import Source, source_tags
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.tag import TagCreate, TagRead
from app.services.event_filters import visible_events
from app.services.pagination import REFERENTIAL_MAX_ROWS

logger = logging.getLogger(__name__)

router = APIRouter()


def _warn_if_truncated(rows: list[Tag]) -> list[Tag]:
    """Log when a referential response lands exactly on the ceiling.

    A whole-hydrated vocabulary carries no ``Link`` header to say it was cut;
    the log is the signal to raise ``REFERENTIAL_MAX_ROWS`` or page the picker.
    """
    if len(rows) == REFERENTIAL_MAX_ROWS:
        logger.warning(
            "GET /tags hit the %d-row referential ceiling; "
            "the response is truncated and the picker is missing options",
            REFERENTIAL_MAX_ROWS,
        )
    return rows


@router.get("", response_model=list[TagRead])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_tags(
    request: Request,
    db: Session = Depends(get_db),
):
    """Return tags referenced by at least one *live* event or one of its sources, so the map
    filter shows no chips that match nothing.

    Bounded by ``REFERENTIAL_MAX_ROWS``, not the 100-row list cap: pickers and
    the filter panel hydrate the vocabulary whole and filter client-side. A
    response landing on the ceiling is logged because the payload can't say it
    was cut.
    """
    on_event = (
        select(event_tags.c.tag_id)
        .join(Event, Event.id == event_tags.c.event_id)
        .where(*visible_events())
    )
    on_source = (
        select(source_tags.c.tag_id)
        .join(Source, Source.id == source_tags.c.source_id)
        .join(Event, Event.id == Source.event_id)
        .where(*visible_events())
    )
    query = db.query(Tag).filter(or_(Tag.id.in_(on_event), Tag.id.in_(on_source)))
    return _warn_if_truncated(query.order_by(Tag.name).limit(REFERENTIAL_MAX_ROWS).all())


@router.post("", response_model=TagRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_tag(
    request: Request,
    body: TagCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a free tag, or return the one already named so (200).

    The lookup covers every tag, orphans included, because ``GET /tags`` hides
    orphans and a 409 would leave the form no way out.
    """
    existing = db.query(Tag).filter(Tag.name == body.name).first()
    if existing:
        return Response(
            content=TagRead.model_validate(existing, from_attributes=True).model_dump_json(),
            media_type="application/json",
            status_code=200,
        )

    # The UNIQUE on ``tags.name`` is the race backstop, and the SAVEPOINT turns the loser into
    # the retryable 409 (see ``services/social.follow_user``).
    tag = Tag(name=body.name)
    try:
        with db.begin_nested():
            db.add(tag)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Tag already exists") from exc
    db.commit()
    db.refresh(tag)
    return tag
