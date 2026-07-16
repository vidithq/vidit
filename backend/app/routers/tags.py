from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.event import Event
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.tag import TagCreate, TagRead

router = APIRouter()

# Categories authenticated users may create via the API. `capture_source`
# is curated (by the seeding migration) since it is a required, filterable
# map dimension that must stay clean; only `free` is open to user creation.
# Conflicts are not tags at all: they live in the `conflicts` referential.
USER_CREATABLE_CATEGORIES = {"free"}

# Server-managed taxonomy: every new geolocation must carry one tag from it
# (enforced in `services/events.py`). Surfaced as the required selector on
# the submit form via `?curated=true`.
CURATED_CATEGORIES = ("capture_source",)


@router.get("", response_model=list[TagRead])
@limiter.limit("60/minute")
def list_tags(
    request: Request,
    category: str | None = None,
    curated: bool = False,
    db: Session = Depends(get_db),
):
    """Return tags that are referenced by at least one *live* geolocation.

    Filters out orphan tags (no live row currently uses them) so the map
    filter UI doesn't surface chips that match zero results. Soft-deleted
    geos don't count toward the live set, so a tag falls off the filter
    once every geo using it is removed.

    ``curated=true`` flips the default: it returns the full curated
    ``capture_source`` taxonomy regardless of live usage. The submit form
    needs *every* option in this required bucket up front so the analyst can
    pick the right one even when they're first to tag it; the usage filter
    that's right for the map is wrong here.
    """
    if curated:
        query = db.query(Tag).filter(Tag.category.in_(CURATED_CATEGORIES))
        if category:
            query = query.filter(Tag.category == category)
        return query.order_by(Tag.category, Tag.name).all()

    query = (
        db.query(Tag)
        .join(event_tags, event_tags.c.tag_id == Tag.id)
        .join(Event, Event.id == event_tags.c.event_id)
        .filter(Event.deleted_at.is_(None))
        .distinct()
    )
    if category:
        query = query.filter(Tag.category == category)
    return query.order_by(Tag.name).all()


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
        # Idempotent create: same name + same category → hand the row
        # back. ``GET /tags`` filters orphan tags (refs == 0), so typing
        # the exact name of an orphaned free tag previously 409'd with no
        # way out of the form. Returns ``200 OK`` (not the ``201`` default)
        # to surface "no new row created" to consumers that care.
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

    # The SELECT above gives the friendly-error path; the UNIQUE on
    # ``tags.name`` is the actual race backstop. Two concurrent POSTs with
    # the same name both pass the SELECT, only one wins the INSERT —
    # without this SAVEPOINT the loser gets a 500 from the unhandled
    # ``IntegrityError`` instead of the 409 the caller retries on. Mirrors
    # ``services/social.follow_user``.
    tag = Tag(name=body.name, category=body.category)
    try:
        with db.begin_nested():
            db.add(tag)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Tag already exists") from exc
    db.commit()
    db.refresh(tag)
    return tag
