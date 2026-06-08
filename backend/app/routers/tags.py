from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.geolocation import Geolocation
from app.models.tag import Tag, geolocation_tags
from app.models.user import User
from app.schemas.tag import TagCreate, TagRead

router = APIRouter()

# Categories that authenticated users may create via the API.
# `conflict` and `capture_source` are curated — `conflict` by direct DB
# access, `capture_source` by the seeding migration — since both are
# required, filterable dimensions on the map and must stay clean. Only
# `free` is open to user creation.
USER_CREATABLE_CATEGORIES = {"free"}

# Server-managed taxonomies: every new geolocation must carry at least
# one tag from each (enforced in `routers/geolocations.py`). Surfaced as
# the two required selectors on the submit form via `?curated=true`.
CURATED_CATEGORIES = ("conflict", "capture_source")


@router.get("", response_model=list[TagRead])
def list_tags(
    category: str | None = None,
    curated: bool = False,
    db: Session = Depends(get_db),
):
    """Return tags that are referenced by at least one *live* geolocation.

    Filters out orphan tags (created at some point but no live row uses
    them right now) so the map filter UI doesn't surface chips that match
    zero results — that's a confusing dead-end for the analyst. Soft-
    deleted geos don't count toward the live set; if every geo using a
    tag has been removed, the tag falls off the filter.

    ``curated=true`` flips to the opposite default: it returns the full
    curated taxonomy (``conflict`` + ``capture_source``) regardless of
    live usage. The submit form needs *every* option in these two
    required buckets up front — including zero-usage ones — so the
    analyst can pick the right conflict / capture source even when
    they're the first to tag it. (The usage filter that's right for the
    map is exactly wrong for a submission selector.)
    """
    if curated:
        query = db.query(Tag).filter(Tag.category.in_(CURATED_CATEGORIES))
        if category:
            query = query.filter(Tag.category == category)
        return query.order_by(Tag.category, Tag.name).all()

    query = (
        db.query(Tag)
        .join(geolocation_tags, geolocation_tags.c.tag_id == Tag.id)
        .join(Geolocation, Geolocation.id == geolocation_tags.c.geolocation_id)
        .filter(Geolocation.deleted_at.is_(None))
        .distinct()
    )
    if category:
        query = query.filter(Tag.category == category)
    return query.order_by(Tag.name).all()


@router.post("", response_model=TagRead, status_code=status.HTTP_201_CREATED)
def create_tag(
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
        # Idempotent create: same name + same category → just hand the
        # row back. ``GET /tags`` filters orphan tags (refs == 0), so an
        # analyst typing the exact name of an existing-but-orphaned free
        # tag previously hit a 409 with no way out from the form. Returns
        # ``200 OK`` (not the ``201 Created`` default) to surface "no new
        # row created" to API consumers that care about it.
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
    # ``tags.name`` is the actual race backstop. Two concurrent POSTs
    # with the same name (two analysts both typing a trending conflict
    # into the picker at the same moment) both pass the SELECT, only
    # one wins the INSERT — without this SAVEPOINT, the loser gets a
    # 500 from the unhandled ``IntegrityError`` instead of the 409 the
    # caller is built to retry on. Mirrors the pattern in
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
