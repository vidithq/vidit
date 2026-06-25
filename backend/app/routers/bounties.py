import uuid
from datetime import UTC, datetime
from typing import Any, NoReturn

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
from app.routers._errors import raise_typed_error
from app.routers._forms import (
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_json_object,
)
from app.schemas.bounty import BountyList, BountyRead
from app.services import bounties as bounties_service
from app.services import permissions
from app.services.audit import extract_client_ip, extract_user_agent
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.storage import get_storage, sweep_keys

router = APIRouter()

# Bounty creation raises typed errors (shared file/media codes from
# evidence_intake + the bounty-specific ones in services/bounties); map
# each to an HTTP status and surface the same ``{code, message}`` envelope
# as the geolocation + registration flows.
_BOUNTY_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "invalid_proof": 400,
}


def _raise_bounty_error(exc: EvidenceIntakeError) -> NoReturn:
    raise_typed_error(exc, _BOUNTY_ERROR_STATUS)


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
        proof=bounty.proof,
        event_date=bounty.event_date,
        source_date=bounty.source_date,
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


# Eager-loads the detail serializer reads: author, media, tags, the fulfilling
# geolocation's author, and every claimer. Shared by the detail GET, the
# post-create reload, and close — all return the full ``BountyRead``.
_DETAIL_LOADS = (
    joinedload(Bounty.author),
    joinedload(Bounty.media),
    joinedload(Bounty.tags),
    joinedload(Bounty.fulfilled_by),
    joinedload(Bounty.claims).joinedload(BountyClaim.user),
)


def _load_live_bounty(
    db: Session,
    bounty_id: uuid.UUID,
    *,
    options: tuple[Any, ...] = (),
    for_update: bool = False,
) -> Bounty:
    """Load a non-deleted bounty by id, or 404.

    ``options`` carries eager-loads (pass ``_DETAIL_LOADS`` for a full read);
    ``for_update`` takes a row lock (``SELECT ... FOR UPDATE``) to serialise
    against a concurrent fulfilment. The ``deleted_at IS NULL`` filter keeps
    soft-deleted rows out of every caller.
    """
    query = db.query(Bounty).filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None))
    if options:
        query = query.options(*options)
    if for_update:
        query = query.with_for_update(of=Bounty)
    bounty = query.first()
    if bounty is None:
        raise HTTPException(status_code=404, detail="Bounty not found")
    return bounty


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
    bounty = _load_live_bounty(db, bounty_id, options=_DETAIL_LOADS)
    return _serialize_detail(bounty)


@router.post("", response_model=BountyRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_bounty(
    request: Request,
    # ``max_length`` ceilings mirror the geolocation form: title is the DB
    # column width (String(255)), source_url a chosen API bound — so
    # over-length input 422s at the boundary, not at flush time AFTER the
    # attached files have already hit S3.
    title: str = Form(..., min_length=1, max_length=255),
    source_url: str = Form(..., max_length=2000),
    proof: str | None = Form(None),
    # Optional dates — same loose ``str`` shape as the geolocation form,
    # parsed below (not by Pydantic).
    event_date: str | None = Form(None),
    source_date: str | None = Form(None),
    tag_ids: str | None = Form(None),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Post a bounty. At least one media file is required — the platform
    treats bounties as "unfinished geolocations", so the evidence the
    poster has must be on the row from the start.

    Parses the multipart form into clean Python types; business rules + IO
    live in ``services/bounties.create_with_evidence``.
    """
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    parsed_source_date = parse_optional_iso_date(source_date, field="source_date")

    try:
        bounty = await bounties_service.create_with_evidence(
            db,
            current_user=current_user,
            title=title,
            source_url=source_url,
            proof_data=proof_data,
            event_date=parsed_event_date,
            source_date=parsed_source_date,
            tag_ids=parsed_tag_ids,
            files=files,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
        )
    except EvidenceIntakeError as exc:
        _raise_bounty_error(exc)

    # Reload with the relationships the detail serializer reads. Not via
    # _load_live_bounty: the row was just created, so it can't be soft-deleted —
    # .one() asserts that invariant instead of the helper's fetch-or-404.
    bounty = db.query(Bounty).options(*_DETAIL_LOADS).filter(Bounty.id == bounty.id).one()
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
    bounty = _load_live_bounty(db, bounty_id, for_update=True)
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
    bounty = _load_live_bounty(db, bounty_id)
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
    bounty = _load_live_bounty(db, bounty_id)

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
    bounty = _load_live_bounty(db, bounty_id, options=_DETAIL_LOADS)
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
