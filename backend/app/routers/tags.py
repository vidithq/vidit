import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError

from app.dependencies import DB, CurrentUser
from app.models.tag import Tag
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.tag import TagCreate, TagRead
from app.services.pagination import REFERENTIAL_MAX_ROWS
from app.services.tags import live_tags, suggested_tags

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
def list_tags(request: Request, db: DB):
    """Return tags referenced by at least one *live* event or one of its sources, so the map
    filter shows no chips that match nothing."""
    return _warn_if_truncated(live_tags(db))


@router.get("/suggested", response_model=list[TagRead])
@limiter.limit("60/minute")
def list_suggested_tags(request: Request, current_user: CurrentUser, db: DB):
    """Return the tags a form offers in one click: your most used tags, then the platform's."""
    return suggested_tags(db, current_user.id)


@router.post("", response_model=TagRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_tag(request: Request, body: TagCreate, current_user: CurrentUser, db: DB):
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
    return tag
