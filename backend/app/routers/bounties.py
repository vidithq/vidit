import json
import uuid
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, joinedload, subqueryload

from app.dependencies import get_current_user, get_db
from app.models.bounty import (
    STATUS_CLOSED,
    STATUS_OPEN,
    Bounty,
    BountyClaim,
)
from app.models.geolocation import Geolocation
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.bounty import BountyList, BountyRead
from app.services import permissions
from app.services.audit import extract_client_ip, extract_user_agent
from app.services.evidence_processing import EvidenceProcessingError
from app.services.sanitize import sanitize_tiptap_doc
from app.services.storage import (
    get_storage,
    safe_original_filename,
    sweep_keys,
    upload_bounty_file,
    validate_file,
)

router = APIRouter()
# Detail page lists every claimer; the list endpoint card only needs a
# few avatars + a count. Tune if the avatar strip grows.
LIST_CLAIMER_SAMPLE_SIZE = 3

# Reject LIKE-injection at the input boundary — the value flows into
# `User.username.ilike(f"%{author}%")` in `_apply_filters`. Restricting to
# characters real usernames carry kills `%` / `\` vectors before the SQL builder.
_AUTHOR_FILTER_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"


def _apply_filters(
    query: SAQuery,
    *,
    status_filter: str | None = None,
    tag: str | None = None,
    author: str | None = None,
) -> SAQuery:
    """Filter set shared by list + detail-adjacent queries.

    Always excludes soft-deleted rows so public reads never see them;
    admin paths query the model directly to act on them.
    """
    query = query.filter(Bounty.deleted_at.is_(None))

    if status_filter:
        query = query.filter(Bounty.status == status_filter)

    if tag:
        query = query.join(Bounty.tags).filter(Tag.name == tag)

    if author:
        query = query.join(Bounty.author).filter(User.username.ilike(f"%{author}%"))

    return query


def _serialize_list(db: Session, bounties: list[Bounty]) -> list[BountyList]:
    """Attach claimer aggregates to each bounty without N+1.

    Detail can afford `joinedload(claims)` on its one row; the list runs
    two grouped queries — one for the per-bounty count, one for the sample.
    """
    if not bounties:
        return []

    bounty_ids = [b.id for b in bounties]
    counts: dict[uuid.UUID, int] = {
        bid: int(count)
        for bid, count in db.query(BountyClaim.bounty_id, func.count("*"))
        .filter(BountyClaim.bounty_id.in_(bounty_ids))
        .group_by(BountyClaim.bounty_id)
        .all()
    }

    # Newest claimer per bounty up to LIST_CLAIMER_SAMPLE_SIZE. Single
    # query — a Postgres window function would be tidier, but joined
    # order_by + Python-side cap is simpler and the working set is small.
    sample: dict[uuid.UUID, list[User]] = {}
    claims = (
        db.query(BountyClaim)
        .options(joinedload(BountyClaim.user))
        .filter(BountyClaim.bounty_id.in_(bounty_ids))
        .order_by(BountyClaim.bounty_id, BountyClaim.created_at.desc())
        .all()
    )
    for claim in claims:
        bucket = sample.setdefault(claim.bounty_id, [])
        if len(bucket) < LIST_CLAIMER_SAMPLE_SIZE:
            bucket.append(claim.user)

    return [
        BountyList(
            id=b.id,
            title=b.title,
            source_url=b.source_url,
            status=b.status,
            created_at=b.created_at,
            is_demo=b.is_demo,
            author=b.author,
            media=b.media,
            tags=b.tags,
            claimer_count=counts.get(b.id, 0),
            # Pydantic ``from_attributes`` coerces each SQLAlchemy ``User``
            # into ``AuthorRef`` at runtime; mypy doesn't follow it. Same
            # idiom as ``originated_from_bounty`` in the geolocation router.
            claimer_sample=sample.get(b.id, []),  # type: ignore[arg-type]
        )
        for b in bounties
    ]


def _serialize_detail(bounty: Bounty) -> BountyRead:
    return BountyRead(
        id=bounty.id,
        title=bounty.title,
        source_url=bounty.source_url,
        description=bounty.description,
        status=bounty.status,
        created_at=bounty.created_at,
        updated_at=bounty.updated_at,
        closed_at=bounty.closed_at,
        is_demo=bounty.is_demo,
        author=bounty.author,
        media=bounty.media,
        tags=bounty.tags,
        claimers=[c.user for c in bounty.claims],
        fulfilled_by=bounty.fulfilled_by,
    )


@router.get("", response_model=list[BountyList])
@limiter.limit("120/minute")
def list_bounties(
    request: Request,
    status: str | None = None,
    tag: str | None = None,
    author: str | None = Query(None, pattern=_AUTHOR_FILTER_PATTERN),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Newest-first list. Same two-step "ids then full rows" shape as
    ``GET /geolocations`` so eager-loads can't inflate the LIMIT count.
    """
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 200")

    id_query = _apply_filters(db.query(Bounty.id), status_filter=status, tag=tag, author=author)
    ids = [row[0] for row in id_query.order_by(Bounty.created_at.desc()).limit(limit).all()]
    if not ids:
        return []

    rows = (
        db.query(Bounty)
        .options(
            subqueryload(Bounty.author),
            subqueryload(Bounty.media),
            subqueryload(Bounty.tags),
        )
        .filter(Bounty.id.in_(ids))
        .order_by(Bounty.created_at.desc())
        .all()
    )
    return _serialize_list(db, rows)


@router.get("/{bounty_id}", response_model=BountyRead)
@limiter.limit("120/minute")
def get_bounty(request: Request, bounty_id: uuid.UUID, db: Session = Depends(get_db)):
    bounty = (
        db.query(Bounty)
        .options(
            joinedload(Bounty.author),
            joinedload(Bounty.media),
            joinedload(Bounty.tags),
            joinedload(Bounty.fulfilled_by),
            joinedload(Bounty.claims).joinedload(BountyClaim.user),
        )
        .filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None))
        .first()
    )
    if bounty is None:
        raise HTTPException(status_code=404, detail="Bounty not found")
    return _serialize_detail(bounty)


@router.post("", response_model=BountyRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_bounty(
    request: Request,
    title: str = Form(...),
    source_url: str = Form(...),
    description: str | None = Form(None),
    tag_ids: str | None = Form(None),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Post a bounty. At least one media file is required — the platform
    treats bounties as "unfinished geolocations", so the evidence the
    poster has must be on the row from the start.
    """
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")
    if not files:
        raise HTTPException(status_code=400, detail="At least one media file is required")

    try:
        description_data = json.loads(description) if description else None
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON in 'description': {exc.msg}"
        ) from exc
    if description_data is not None and not isinstance(description_data, dict):
        raise HTTPException(status_code=400, detail="'description' must be a JSON object")
    if description_data is not None:
        try:
            description_data = sanitize_tiptap_doc(description_data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        parsed_tag_ids = json.loads(tag_ids) if tag_ids else []
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON in 'tag_ids': {exc.msg}"
        ) from exc
    if not isinstance(parsed_tag_ids, list):
        raise HTTPException(status_code=400, detail="'tag_ids' must be a JSON array")

    bounty = Bounty(
        author_id=current_user.id,
        title=title,
        source_url=source_url,
        description=description_data,
        status=STATUS_OPEN,
    )

    if parsed_tag_ids:
        tags = db.query(Tag).filter(Tag.id.in_(parsed_tag_ids)).all()
        bounty.tags = tags

    db.add(bounty)
    db.flush()

    # Validate every file before any upload — a 400 on file #3 shouldn't
    # leave files #1 and #2 stranded in S3 with no DB row.
    media_types: list[str] = []
    for file in files:
        try:
            media_types.append(validate_file(file))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Same provenance triple as `/geolocations` — captured once and applied
    # to every Media row, so a multi-file post shares one submitter signature.
    uploaded_ip = extract_client_ip(request)
    uploaded_user_agent = extract_user_agent(request)
    uploaded_keys: list[str] = []
    try:
        for file, media_type in zip(files, media_types, strict=True):
            try:
                result = await upload_bounty_file(file, bounty.id)
            except EvidenceProcessingError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            db.add(
                Media(
                    bounty_id=bounty.id,
                    storage_url=result.url,
                    media_type=media_type,
                    sha256=result.sha256,
                    uploaded_ip=uploaded_ip,
                    uploaded_user_agent=uploaded_user_agent,
                    original_filename=safe_original_filename(file.filename),
                )
            )
            key = get_storage().key_from_url(result.url)
            if key is not None:
                uploaded_keys.append(key)
                # Sweep the JPEG hero + thumbnail derivatives alongside the
                # original on row-side failure — an orphan derivative is the
                # same bucket-leak, just at a smaller per-object cost.
                uploaded_keys.extend(result.derivative_keys)

        db.commit()
    except Exception:
        # A mid-upload failure leaves S3 with orphan objects. The DB rolls
        # back via session-scope teardown; sweep S3 best-effort so the
        # bucket doesn't grow unbounded.
        db.rollback()
        sweep_keys(uploaded_keys, context="bounty create rollback")
        raise

    db.refresh(bounty)
    # Reload with the relationships the detail serializer reads.
    bounty = (
        db.query(Bounty)
        .options(
            joinedload(Bounty.author),
            joinedload(Bounty.media),
            joinedload(Bounty.tags),
            joinedload(Bounty.fulfilled_by),
            joinedload(Bounty.claims).joinedload(BountyClaim.user),
        )
        .filter(Bounty.id == bounty.id)
        .one()
    )
    return _serialize_detail(bounty)


@router.delete("/{bounty_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_bounty(
    request: Request,
    bounty_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hard-delete by the author. Cascades drop ``bounty_tags``,
    ``bounty_claims`` and ``media`` rows; the S3 objects are swept after
    the commit lands. Admin soft-delete lives behind the admin router
    and stamps ``deleted_at`` instead.
    """
    # SELECT ... FOR UPDATE to serialise against a concurrent
    # ``POST /geolocations bounty_id=…`` fulfilling this bounty. Without
    # the lock both transactions read status=open at once and we'd end up
    # with a lost or fulfilled-but-deleted bounty depending on commit order;
    # with it, the loser observes the new state and 409s.
    bounty = (
        db.query(Bounty)
        .filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None))
        .with_for_update(of=Bounty)
        .first()
    )
    if bounty is None:
        raise HTTPException(status_code=404, detail="Bounty not found")
    permissions.ensure_author(bounty, current_user)

    # Deliberately no ``deleted_at.is_(None)`` filter: a soft-deleted
    # geolocation still carries the audit trail to its source bounty, and
    # deleting the bounty would strand that link (FK flips to NULL via SET
    # NULL). Hard-delete the geolocation first to get the bounty gone.
    fulfilled = (
        db.query(Geolocation.id).filter(Geolocation.originated_from_bounty_id == bounty.id).first()
    )
    if fulfilled is not None:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a bounty that has been fulfilled by a geolocation",
        )

    storage = get_storage()
    media_urls = [
        row[0] for row in db.query(Media.storage_url).filter(Media.bounty_id == bounty.id).all()
    ]
    media_keys = [k for k in (storage.key_from_url(u) for u in media_urls) if k is not None]

    db.delete(bounty)
    db.commit()

    sweep_keys(media_keys, context=f"bounty {bounty.id} delete")


@router.post("/{bounty_id}/claim", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def claim_bounty(
    request: Request,
    bounty_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Signal "I'm working on this". Idempotent — re-claiming is a 204
    no-op, not a 409. Only open bounties accept new claims; once a
    bounty is fulfilled or closed, claiming is rejected with 409.
    """
    bounty = db.query(Bounty).filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None)).first()
    if bounty is None:
        raise HTTPException(status_code=404, detail="Bounty not found")
    if bounty.status != STATUS_OPEN:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot claim a bounty with status {bounty.status}",
        )

    existing = (
        db.query(BountyClaim)
        .filter(
            BountyClaim.bounty_id == bounty.id,
            BountyClaim.user_id == current_user.id,
        )
        .first()
    )
    if existing is not None:
        return

    # The SELECT above is the friendly-path read; the ``BountyClaim``
    # composite-PK ``(bounty_id, user_id)`` is the actual race backstop.
    # A double-click or two tabs both pass the SELECT, only one wins the
    # INSERT — without this SAVEPOINT the loser sees a 500 from the
    # unhandled ``IntegrityError`` instead of the idempotent 204. Mirrors
    # ``services/social.follow_user``.
    try:
        with db.begin_nested():
            db.add(BountyClaim(bounty_id=bounty.id, user_id=current_user.id))
    except IntegrityError:
        # Loser of the race — the row exists, which IS the post-condition.
        pass
    db.commit()


@router.delete("/{bounty_id}/claim", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def unclaim_bounty(
    request: Request,
    bounty_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop signaling. 204 even if the caller wasn't a claimer — the
    user-observable post-condition (caller not in the working set) is
    what we promise, not "exactly one row was deleted."
    """
    bounty = db.query(Bounty).filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None)).first()
    if bounty is None:
        raise HTTPException(status_code=404, detail="Bounty not found")

    db.query(BountyClaim).filter(
        BountyClaim.bounty_id == bounty.id,
        BountyClaim.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()


@router.post("/{bounty_id}/close", response_model=BountyRead)
@limiter.limit("60/minute")
def close_bounty(
    request: Request,
    bounty_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Author withdraws the bounty without anyone geolocating it.

    Only the author can close. Fulfilled bounties can't be re-closed
    (terminal state). Closed bounties are still readable — they live
    on as an audit row showing the queue tried but didn't produce a
    geolocation.
    """
    bounty = (
        db.query(Bounty)
        .options(
            joinedload(Bounty.author),
            joinedload(Bounty.media),
            joinedload(Bounty.tags),
            joinedload(Bounty.fulfilled_by),
            joinedload(Bounty.claims).joinedload(BountyClaim.user),
        )
        .filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None))
        .first()
    )
    if bounty is None:
        raise HTTPException(status_code=404, detail="Bounty not found")
    permissions.ensure_author(bounty, current_user)
    if bounty.status != STATUS_OPEN:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot close a bounty with status {bounty.status}",
        )

    bounty.status = STATUS_CLOSED
    bounty.closed_at = datetime.now(UTC)
    db.commit()
    db.refresh(bounty)
    return _serialize_detail(bounty)
