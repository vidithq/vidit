import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.event import Event
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.tag import TagCreate, TagRead
from app.services.event_filters import visible_events
from app.services.pagination import REFERENTIAL_MAX_ROWS

logger = logging.getLogger(__name__)

router = APIRouter()


def _warn_if_truncated(rows: list[Tag], *, view: str) -> list[Tag]:
    """Log when a referential response lands exactly on the ceiling.

    A whole-hydrated vocabulary carries no ``Link`` header to say it was cut;
    the log is the signal to raise ``REFERENTIAL_MAX_ROWS`` or page the picker.
    """
    if len(rows) == REFERENTIAL_MAX_ROWS:
        logger.warning(
            "GET /tags (%s) hit the %d-row referential ceiling; "
            "the response is truncated and the picker is missing options",
            view,
            REFERENTIAL_MAX_ROWS,
        )
    return rows


# Categories users may create. `capture_source` is curated (seeded) because it
# is a required map dimension; conflicts live in the `conflicts` referential.
USER_CREATABLE_CATEGORIES = {"free"}

# Server-managed taxonomy: every new geolocation needs one tag from it
# (`services/events/rules.py`); the submit form's `?curated=true` selector.
CURATED_CATEGORIES = ("capture_source",)


@router.get("", response_model=list[TagRead])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_tags(
    request: Request,
    category: str | None = None,
    curated: bool = False,
    db: Session = Depends(get_db),
):
    """Return tags referenced by at least one *live* geolocation, so the map
    filter shows no chips that match nothing.

    ``curated=true`` instead returns the full curated ``capture_source``
    taxonomy regardless of usage: the submit form needs every option in this
    required bucket, even for the first analyst to tag it.

    Bounded by ``REFERENTIAL_MAX_ROWS``, not the 100-row list cap: pickers and
    the filter panel hydrate the vocabulary whole and filter client-side. The
    ceiling bounds ``free``-category growth; a response landing on it is
    logged because the payload can't say it was cut.
    """
    if curated:
        query = db.query(Tag).filter(Tag.category.in_(CURATED_CATEGORIES))
        if category:
            query = query.filter(Tag.category == category)
        return _warn_if_truncated(
            query.order_by(Tag.category, Tag.name).limit(REFERENTIAL_MAX_ROWS).all(),
            view="curated",
        )

    query = (
        db.query(Tag)
        .join(event_tags, event_tags.c.tag_id == Tag.id)
        .join(Event, Event.id == event_tags.c.event_id)
        .filter(*visible_events())
        .distinct()
    )
    if category:
        query = query.filter(Tag.category == category)
    return _warn_if_truncated(
        query.order_by(Tag.name).limit(REFERENTIAL_MAX_ROWS).all(), view="live"
    )


@router.post("", response_model=TagRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_tag(
    request: Request,
    body: TagCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.category not in USER_CREATABLE_CATEGORIES:
        raise HTTPException(
            status_code=403,
            detail=f"Tag category {body.category!r} cannot be created via the API",
        )

    existing = db.query(Tag).filter(Tag.name == body.name).first()
    if existing:
        # Idempotent create: same name + category returns the row (200, not
        # 201). The lookup covers every tag, orphans included, because
        # ``GET /tags`` hides orphans and a 409 would leave the form no way out.
        if existing.category == body.category:
            return Response(
                content=TagRead.model_validate(existing, from_attributes=True).model_dump_json(),
                media_type="application/json",
                status_code=200,
            )
        raise HTTPException(
            status_code=409,
            detail=(
                f"Tag {body.name!r} already exists under a different "
                f"category ({existing.category!r})"
            ),
        )

    # The SELECT only buys the friendly category-conflict message; the UNIQUE on
    # ``tags.name`` is the race backstop, and the SAVEPOINT turns the loser into
    # the retryable 409 (see ``services/social.follow_user``).
    tag = Tag(name=body.name, category=body.category)
    try:
        with db.begin_nested():
            db.add(tag)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Tag already exists") from exc
    db.commit()
    db.refresh(tag)
    return tag
