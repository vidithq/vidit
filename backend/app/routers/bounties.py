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
from app.models.event import (
    STATUS_CLOSED,
    STATUS_REQUESTED,
    Event,
    EventClaim,
)
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.routers._event_query import AUTHOR_FILTER_PATTERN, apply_author_filter
from app.routers._forms import (
    parse_iso_datetime,
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_iso_time,
    parse_optional_json_object,
)
from app.schemas.bounty import BountyList, BountyRead
from app.services import bounties as bounties_service
from app.services import permissions
from app.services.audit import extract_client_ip, extract_user_agent
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.storage import get_storage, sweep_keys

router = APIRouter()

# The requested view over the unified event model: a bounty is a ``requested``
# event, and stays visible as ``closed`` once the author withdraws it. Reads and
# lifecycle ops scope to these two states so a located ``geolocated`` /
# ``detected`` event (served by ``/geolocations``) never surfaces here.
_REQUESTED_VIEW_STATUSES = (STATUS_REQUESTED, STATUS_CLOSED)

# Bounty creation raises typed errors (shared file/media codes from
# evidence_intake + the requested-view ones in services/bounties); map
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


def _apply_filters(
    query: SAQuery,
    *,
    status_filter: str | None = None,
    tag: str | None = None,
    author: str | None = None,
) -> SAQuery:
    """Filter set shared by list + detail-adjacent queries.

    Scopes to the requested view (``requested`` / ``closed``) and always excludes
    soft-deleted rows so public reads never see them; admin paths query the model
    directly to act on them. ``status_filter`` narrows within the view (e.g.
    ``?status=closed``).
    """
    query = query.filter(
        Event.deleted_at.is_(None),
        Event.status.in_(_REQUESTED_VIEW_STATUSES),
    )

    if status_filter:
        query = query.filter(Event.status == status_filter)

    if tag:
        query = query.join(Event.tags).filter(Tag.name == tag)

    if author:
        query = apply_author_filter(query, author)

    return query


def _serialize_list(db: Session, bounties: list[Event]) -> list[BountyList]:
    """Attach claimer aggregates to each requested event without N+1.

    Detail can afford `joinedload(claims)` on its one row; the list runs
    two grouped queries — one for the per-row count, one for the sample.
    """
    if not bounties:
        return []

    bounty_ids = [b.id for b in bounties]
    counts: dict[uuid.UUID, int] = {
        bid: int(count)
        for bid, count in db.query(EventClaim.event_id, func.count("*"))
        .filter(EventClaim.event_id.in_(bounty_ids))
        .group_by(EventClaim.event_id)
        .all()
    }

    # Newest claimer per row up to LIST_CLAIMER_SAMPLE_SIZE. Single
    # query — a Postgres window function would be tidier, but joined
    # order_by + Python-side cap is simpler and the working set is small.
    sample: dict[uuid.UUID, list[User]] = {}
    claims = (
        db.query(EventClaim)
        .options(joinedload(EventClaim.user))
        .filter(EventClaim.event_id.in_(bounty_ids))
        .order_by(EventClaim.event_id, EventClaim.created_at.desc())
        .all()
    )
    for claim in claims:
        bucket = sample.setdefault(claim.event_id, [])
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
            # into ``AuthorRef`` at runtime; mypy doesn't follow it.
            claimer_sample=sample.get(b.id, []),  # type: ignore[arg-type]
        )
        for b in bounties
    ]


def _serialize_detail(bounty: Event) -> BountyRead:
    return BountyRead(
        id=bounty.id,
        title=bounty.title,
        source_url=bounty.source_url,
        proof=bounty.proof,
        event_date=bounty.event_date,
        event_time=bounty.event_time,
        source_posted_at=bounty.source_posted_at,
        status=bounty.status,
        created_at=bounty.created_at,
        updated_at=bounty.updated_at,
        closed_at=bounty.closed_at,
        is_demo=bounty.is_demo,
        author=bounty.author,
        media=bounty.media,
        tags=bounty.tags,
        claimers=[c.user for c in bounty.claims],
    )


# Eager-loads the detail serializer reads: author, media, tags, and every
# claimer. Shared by the detail GET, the post-create reload, and close — all
# return the full ``BountyRead``.
_DETAIL_LOADS = (
    joinedload(Event.author),
    joinedload(Event.media),
    joinedload(Event.tags),
    joinedload(Event.claims).joinedload(EventClaim.user),
)


def _load_live_bounty(
    db: Session,
    bounty_id: uuid.UUID,
    *,
    options: tuple[Any, ...] = (),
) -> Event:
    """Load a non-deleted requested-view event by id, or 404.

    ``options`` carries eager-loads (pass ``_DETAIL_LOADS`` for a full read). The
    ``deleted_at IS NULL`` filter keeps soft-deleted rows out of every caller; the
    status filter keeps a located event (served by ``/geolocations``) from being
    read or mutated through the requested-view router.
    """
    query = db.query(Event).filter(
        Event.id == bounty_id,
        Event.deleted_at.is_(None),
        Event.status.in_(_REQUESTED_VIEW_STATUSES),
    )
    if options:
        query = query.options(*options)
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
    author: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Newest-first list. Same two-step "ids then full rows" shape as
    ``GET /geolocations`` so eager-loads can't inflate the LIMIT count.
    """
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 200")

    id_query = _apply_filters(db.query(Event.id), status_filter=status, tag=tag, author=author)
    ids = [row[0] for row in id_query.order_by(Event.created_at.desc()).limit(limit).all()]
    if not ids:
        return []

    rows = (
        db.query(Event)
        .options(
            subqueryload(Event.author),
            subqueryload(Event.media),
            subqueryload(Event.tags),
        )
        .filter(Event.id.in_(ids))
        .order_by(Event.created_at.desc())
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
    # Event date optional (often unknown for a request); the source is a post, so
    # its timestamp is required. Same loose ``str`` shapes, parsed below.
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    tag_ids: str | None = Form(None),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Post a bounty (a ``requested`` event). At least one media file is
    required — the platform treats bounties as "unfinished geolocations", so
    the evidence the poster has must be on the row from the start.

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
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")
    # A time-of-day needs its day; event_date is optional on a request.
    if parsed_event_time is not None and parsed_event_date is None:
        raise HTTPException(status_code=422, detail="event_time requires event_date")

    try:
        bounty = await bounties_service.create_with_evidence(
            db,
            current_user=current_user,
            title=title,
            source_url=source_url,
            proof_data=proof_data,
            event_date=parsed_event_date,
            event_time=parsed_event_time,
            source_posted_at=parsed_source_posted_at,
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
    bounty = db.query(Event).options(*_DETAIL_LOADS).filter(Event.id == bounty.id).one()
    return _serialize_detail(bounty)


@router.delete("/{bounty_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_bounty(
    request: Request,
    bounty_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hard-delete by the author. Cascades drop ``event_tags``,
    ``event_claims`` and ``media`` rows; the S3 objects are swept after
    the commit lands. Admin soft-delete lives behind the admin router and
    stamps ``deleted_at`` instead.
    """
    bounty = _load_live_bounty(db, bounty_id)
    permissions.ensure_author(bounty, current_user)

    storage = get_storage()
    media_urls = [
        row[0] for row in db.query(Media.storage_url).filter(Media.event_id == bounty.id).all()
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
    no-op, not a 409. Only open requests accept new claims; once a request
    is closed, claiming is rejected with 409.
    """
    bounty = _load_live_bounty(db, bounty_id)
    if bounty.status != STATUS_REQUESTED:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot claim a bounty with status {bounty.status}",
        )

    existing = (
        db.query(EventClaim)
        .filter(
            EventClaim.event_id == bounty.id,
            EventClaim.user_id == current_user.id,
        )
        .first()
    )
    if existing is not None:
        return

    # The SELECT above is the friendly-path read; the ``EventClaim``
    # composite-PK ``(geolocation_id, user_id)`` is the actual race backstop.
    # A double-click or two tabs both pass the SELECT, only one wins the
    # INSERT — without this SAVEPOINT the loser sees a 500 from the
    # unhandled ``IntegrityError`` instead of the idempotent 204. Mirrors
    # ``services/social.follow_user``.
    try:
        with db.begin_nested():
            db.add(EventClaim(event_id=bounty.id, user_id=current_user.id))
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

    db.query(EventClaim).filter(
        EventClaim.event_id == bounty.id,
        EventClaim.user_id == current_user.id,
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
    """Author withdraws the request without anyone geolocating it.

    Only the author can close. Already-closed requests can't be re-closed
    (terminal state). Closed requests are still readable — they live on as an
    audit row showing the queue tried but didn't produce a geolocation.
    """
    bounty = _load_live_bounty(db, bounty_id, options=_DETAIL_LOADS)
    permissions.ensure_author(bounty, current_user)
    if bounty.status != STATUS_REQUESTED:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot close a bounty with status {bounty.status}",
        )

    bounty.status = STATUS_CLOSED
    bounty.closed_at = datetime.now(UTC)
    db.commit()
    db.refresh(bounty)
    return _serialize_detail(bounty)
