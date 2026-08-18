import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.admin_event import AdminEvent
from app.models.archive_import_job import ArchiveImportJob
from app.models.auth_event import EVENT_LOGIN, AuthEvent
from app.models.bot_mention import BotMention
from app.models.event import STATUS_CLOSED, STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.user import User
from app.schemas.admin import (
    AdminDetectionStatsRead,
    AdminInviteCodeRead,
    AdminInviteRedeemerRead,
)
from app.services.auth import bump_token_version, generate_invite_code, invite_code_status
from app.services.evidence_intake import collect_media_keys
from app.services.pagination import keyset_before, take_page
from app.services.storage import avatar_key_of, sweep_keys


class AdminError(Exception):
    """Base for friendly errors raised by admin services.

    Carries a ``code`` so the router maps to an HTTP status without
    string-matching exception text. Mirrors
    :class:`app.services.registration.RegistrationError`.
    """

    code: str = "admin_error"


class UserNotFoundError(AdminError):
    code = "user_not_found"


class EventNotFoundError(AdminError):
    code = "geolocation_not_found"


class XHandleConflictError(AdminError):
    code = "x_handle_conflict"


def _redeemer_reads(db: Session, users: list[User]) -> dict[uuid.UUID, AdminInviteRedeemerRead]:
    """Batch the onboarding counters for every redeemer in one pass per source.

    Grouped aggregates over ``archive_import_jobs``, ``bot_mentions``,
    ``events`` and ``auth_events`` keyed by user (bot mentions by lowercased
    handle), so the invite list stays O(1) queries however many rows it has.
    """
    if not users:
        return {}
    ids = [u.id for u in users]
    handles = [u.x_handle for u in users if u.x_handle]

    archives: dict[uuid.UUID, int] = {
        owner_id: count
        for owner_id, count in db.query(ArchiveImportJob.owner_id, func.count())
        .filter(ArchiveImportJob.owner_id.in_(ids), ArchiveImportJob.status == "done")
        .group_by(ArchiveImportJob.owner_id)
        .all()
    }
    bot_by_handle: dict[str, int] = (
        dict(
            db.query(
                func.lower(BotMention.author_handle),
                func.coalesce(func.sum(BotMention.events_created), 0),
            )
            .filter(func.lower(BotMention.author_handle).in_(handles))
            .group_by(func.lower(BotMention.author_handle))
            .all()
        )
        if handles
        else {}
    )
    event_rows = (
        db.query(Event.owner_id, Event.status, func.count())
        .filter(
            Event.owner_id.in_(ids),
            Event.deleted_at.is_(None),
            Event.status.in_((STATUS_DETECTED, STATUS_GEOLOCATED)),
        )
        .group_by(Event.owner_id, Event.status)
        .all()
    )
    by_status: dict[tuple[uuid.UUID, str], int] = {
        (owner_id, status_value): count for owner_id, status_value, count in event_rows
    }
    logins: dict[uuid.UUID | None, datetime] = {
        user_id: latest
        for user_id, latest in db.query(AuthEvent.user_id, func.max(AuthEvent.created_at))
        .filter(AuthEvent.user_id.in_(ids), AuthEvent.event == EVENT_LOGIN)
        .group_by(AuthEvent.user_id)
        .all()
    }

    return {
        u.id: AdminInviteRedeemerRead(
            user_id=u.id,
            username=u.username,
            email=u.email,
            is_admin=u.is_admin,
            x_handle=u.x_handle,
            archives_imported=archives.get(u.id, 0),
            bot_detection_count=bot_by_handle.get(u.x_handle, 0) if u.x_handle else 0,
            detected_count=by_status.get((u.id, STATUS_DETECTED), 0),
            geolocated_count=by_status.get((u.id, STATUS_GEOLOCATED), 0),
            last_login_at=logins.get(u.id),
        )
        for u in users
    }


def serialize_invite_codes(db: Session, invites: list[InviteCode]) -> list[AdminInviteCodeRead]:
    redeemers = _redeemer_reads(db, [i.used_by_user for i in invites if i.used_by_user is not None])
    return [
        AdminInviteCodeRead(
            id=invite.id,
            code=invite.code,
            max_uses=invite.max_uses,
            use_count=invite.use_count,
            expires_at=invite.expires_at,
            revoked_at=invite.revoked_at,
            created_at=invite.created_at,
            status=invite_code_status(invite),
            redeemer=redeemers.get(invite.used_by) if invite.used_by else None,
            used_at=invite.used_at,
            x_handle=invite.x_handle,
        )
        for invite in invites
    ]


def serialize_invite_code(db: Session, invite: InviteCode) -> AdminInviteCodeRead:
    return serialize_invite_codes(db, [invite])[0]


def _assert_x_handle_free(
    db: Session, x_handle: str, *, exclude_user_id: uuid.UUID | None = None
) -> None:
    """Raise the typed conflict when any user row already carries the handle.

    Soft-deleted rows count too: ``users.x_handle`` is UNIQUE across every
    row, so a link that ignored a tombstoned holder would fail the constraint.
    """
    query = db.query(User).filter(User.x_handle == x_handle)
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    if query.first() is not None:
        raise XHandleConflictError("x_handle is already linked to another account")


def log_admin_event(
    db: Session,
    *,
    actor_id: uuid.UUID,
    action: str,
    target: dict[str, Any] | None = None,
) -> AdminEvent:
    """Append a row to ``admin_events``. No commit — caller owns the txn."""
    event = AdminEvent(actor_id=actor_id, action=action, target=target)
    db.add(event)
    return event


def create_invite_code(
    db: Session,
    *,
    actor_id: uuid.UUID,
    expires_in_days: int | None,
    x_handle: str | None = None,
) -> InviteCode:
    """Mint a single-use invite code, optionally bound to an X handle.

    ``max_uses`` is locked to 1 so every code's audit trail (``used_by`` /
    ``used_at``) names exactly one analyst. The column accepts higher
    values; the admin API doesn't expose them.

    A bound ``x_handle`` (already normalized by the schema) is copied onto
    the account at redemption; minting against a handle a user already
    carries raises the same conflict as the direct link endpoint.
    """
    if x_handle is not None:
        _assert_x_handle_free(db, x_handle)
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
    invite = InviteCode(
        code=generate_invite_code(),
        max_uses=1,
        expires_at=expires_at,
        x_handle=x_handle,
    )
    db.add(invite)
    db.flush()
    target: dict[str, Any] = {"invite_code_id": str(invite.id)}
    if x_handle is not None:
        target["x_handle"] = x_handle
    log_admin_event(
        db,
        actor_id=actor_id,
        action="invite_created",
        target=target,
    )
    db.commit()
    db.refresh(invite)
    return invite


def list_invite_codes(
    db: Session,
    *,
    limit: int,
    cursor: tuple[datetime, uuid.UUID] | None = None,
) -> tuple[list[InviteCode], bool]:
    """One page of invite codes, newest first, plus whether another follows.

    No status filtering: an admin reviewing the table needs revoked /
    expired rows to remember what was issued, not just the live ones. Paged
    all the same, on the same ``created_at DESC, id DESC`` keyset as the
    catalog lists: the table grows one row per invite forever and had no
    ceiling at all.
    """
    query = (
        db.query(InviteCode)
        .options(joinedload(InviteCode.used_by_user))
        .order_by(InviteCode.created_at.desc(), InviteCode.id.desc())
    )
    if cursor is not None:
        query = query.filter(keyset_before(InviteCode.created_at, InviteCode.id, cursor))
    return take_page(query.limit(limit + 1).all(), limit)


def revoke_invite_code(
    db: Session,
    *,
    actor_id: uuid.UUID,
    invite_id: uuid.UUID,
) -> InviteCode | None:
    invite = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    if invite is None:
        return None
    # Idempotent: keep the original ``revoked_at`` and skip the audit
    # append — re-revoking is a no-op, not a fresh administrative act.
    if invite.revoked_at is not None:
        return invite
    invite.revoked_at = datetime.now(UTC)
    log_admin_event(
        db,
        actor_id=actor_id,
        action="invite_revoked",
        target={"invite_code_id": str(invite.id)},
    )
    db.commit()
    db.refresh(invite)
    return invite


def search_users(db: Session, *, query: str, limit: int = 20) -> list[User]:
    """Case-insensitive substring match on username or email.

    ``ILIKE`` is fine at low-hundreds-of-users scale; past ~10k users,
    switch to pg_trgm + GIN.
    """
    cleaned = query.strip()
    if not cleaned:
        return []
    pattern = f"%{cleaned}%"
    return (
        db.query(User)
        .filter(
            User.deleted_at.is_(None),
            or_(User.username.ilike(pattern), User.email.ilike(pattern)),
        )
        .order_by(User.username.asc())
        .limit(limit)
        .all()
    )


def set_user_x_handle(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
    x_handle: str | None,
) -> User:
    """Link or clear the X handle the bot attributes mentions to, with audit.

    The schema validator already normalized the value (lowercased, no leading
    ``@``). A handle held by any other user raises the conflict error.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.deleted_at is not None:
        # Mutating a tombstoned account would plant a stale link that
        # resurrects with the row.
        raise UserNotFoundError("User not found")

    if x_handle is not None:
        _assert_x_handle_free(db, x_handle, exclude_user_id=user_id)
        user.x_handle = x_handle
        action = "x_handle_linked"
        target = {"user_id": str(user.id), "x_handle": x_handle}
    else:
        user.x_handle = None
        action = "x_handle_cleared"
        target = {"user_id": str(user.id)}

    log_admin_event(db, actor_id=actor_id, action=action, target=target)
    try:
        db.commit()
    except IntegrityError as exc:
        # The pre-check above races the UNIQUE: a concurrent link (another
        # admin call, or a registration redeeming an invite bound to the same
        # handle) can land between check and commit. Surface the same typed
        # 409 as the pre-check instead of a 500.
        db.rollback()
        raise XHandleConflictError("X handle already linked to another user") from exc
    db.refresh(user)
    return user


def soft_delete_geolocation(
    db: Session,
    *,
    actor_id: uuid.UUID,
    geolocation_id: uuid.UUID,
) -> Event:
    """Mark a geolocation as removed-from-public-view.

    Idempotent — on an already soft-deleted row, preserves the original
    timestamp and skips a fresh audit row. The S3 objects + media rows
    stay put; evidence is preserved, just hidden.
    """
    geo = db.query(Event).filter(Event.id == geolocation_id).first()
    if geo is None:
        raise EventNotFoundError("Event not found")
    if geo.deleted_at is not None:
        return geo

    geo.deleted_at = datetime.now(UTC)
    log_admin_event(
        db,
        actor_id=actor_id,
        action="geolocation_soft_deleted",
        target={"geolocation_id": str(geo.id), "title": geo.title},
    )
    db.commit()
    db.refresh(geo)
    return geo


def hard_delete_geolocation(
    db: Session,
    *,
    actor_id: uuid.UUID,
    geolocation_id: uuid.UUID,
) -> dict[str, Any]:
    """GDPR-grade erasure: drop the row, the media rows, and the S3 objects.

    Commit-then-sweep, see :func:`services.storage.sweep_keys`. Reachable on
    already-soft-deleted rows (escalation: soft now, hard later) and on live
    rows (admin override).
    """
    geo = db.query(Event).filter(Event.id == geolocation_id).first()
    if geo is None:
        raise EventNotFoundError("Event not found")

    # Capture S3 keys *before* the cascade fires: every media row, source and
    # proof roles alike, derivatives included.
    media_keys = collect_media_keys(list(geo.media))

    target = {
        "geolocation_id": str(geo.id),
        "title": geo.title,
        "media_count": len(geo.media),
    }
    db.delete(geo)
    log_admin_event(db, actor_id=actor_id, action="geolocation_hard_deleted", target=target)
    db.commit()

    sweep_keys(
        media_keys,
        context=f"geolocation {geolocation_id} hard-delete",
    )

    return target


def soft_delete_user(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[User, int]:
    """Mark a user as removed-from-public-view + cascade to their submissions.

    Returns ``(user, cascaded_geolocations)`` — the count of *live*
    (``deleted_at IS NULL``) events flipped in this call. Idempotent on an
    already-deleted user (same timestamp, no fresh audit row, count zero).

    Since the request + geolocation merge, requests and geolocations are one
    table, so a single cascade covers both: a banned author shouldn't leave open
    requests on the index, and historical events shouldn't surface the banned
    account in their author slot.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise UserNotFoundError("User not found")
    if user.deleted_at is not None:
        return user, 0

    now = datetime.now(UTC)
    user.deleted_at = now
    # `get_current_user` already rejects soft-deleted accounts, but bumping
    # `token_version` covers any path that fetched the user before checking
    # `deleted_at`, and stops a later un-soft-delete (column is recoverable)
    # from reviving old sessions.
    bump_token_version(user)
    # Release the X handle: the UNIQUE constraint spans tombstoned rows, so a
    # kept link would 409 every future re-link of this handle while the PATCH
    # endpoint refuses tombstoned targets. The audit target records the freed
    # value.
    freed_x_handle = user.x_handle
    user.x_handle = None

    # Cascade to every live event (located + requested). ``WHERE deleted_at IS
    # NULL`` leaves earlier soft-delete timestamps untouched, so the count
    # reflects only what *this* call flipped.
    cascaded_geolocations = (
        db.query(Event)
        .filter(
            Event.owner_id == user.id,
            Event.deleted_at.is_(None),
        )
        .update({Event.deleted_at: now}, synchronize_session=False)
    )

    log_admin_event(
        db,
        actor_id=actor_id,
        action="user_soft_deleted",
        target={
            "user_id": str(user.id),
            "username": user.username,
            "cascaded_geolocations": cascaded_geolocations,
            "freed_x_handle": freed_x_handle,
        },
    )
    db.commit()
    db.refresh(user)
    return user, cascaded_geolocations


def hard_delete_user(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """GDPR-grade erasure: drop the user, every event they own, and every
    S3 object referenced by the cascade.

    Order matters:

    1. Capture S3 keys upfront: the media URLs (all roles: source footage +
       proof images) across their events, located and requested alike, plus
       the account's own avatar object. The cascade about to fire would drop
       those rows before we could read them.
    2. Manually delete each event: ``owner_id`` carries no ``ON DELETE
       CASCADE`` (would mean retroactive constraint changes). Each ``db.delete``
       cascades to that row's media / contributor rows / tags. Because the
       owner is always among an event's geolocators, no ``geolocated`` event
       is left below one geolocator.
    3. Delete the user. ``auth_tokens`` and their contributor rows on other
       people's events cascade-drop; ``admin_events.actor_id`` and
       ``invite_codes.used_by`` flip to NULL via migration f1a3b5c7d9e0:
       invite-code rows are audit trail and should outlive the user.
    4. Commit, *then* sweep S3 (see :func:`services.storage.sweep_keys`).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise UserNotFoundError("User not found")

    # 1. Capture every S3 key this user's events reference (media all roles,
    # derivatives included), plus their profile picture: the avatar is
    # personal data on the same erasure request, and nothing else references
    # it once the row is gone.
    geolocations = db.query(Event).filter(Event.owner_id == user.id).all()
    geo_media_keys: list[str] = []
    for geo in geolocations:
        geo_media_keys.extend(collect_media_keys(list(geo.media)))
    avatar_key = avatar_key_of(user.avatar_url)

    target = {
        "user_id": str(user.id),
        "username": user.username,
        "geolocation_count": len(geolocations),
        "media_count": len(geo_media_keys),
    }

    # 2. Drop events manually so their media / contributor / tag cascades
    # fire before we delete the user row.
    for geo in geolocations:
        db.delete(geo)

    # 3. Drop the user row. auth_tokens + contributor rows cascade-drop on
    # user.id; admin_events / invite_codes FKs become NULL.
    db.delete(user)

    log_admin_event(db, actor_id=actor_id, action="user_hard_deleted", target=target)
    db.commit()

    # 4. Best-effort S3 sweep, after the DB transaction is durable.
    sweep_keys(
        geo_media_keys + ([avatar_key] if avatar_key else []),
        context=f"user {user_id} hard-delete",
    )

    return target


def purge_detected_events(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Hard-delete every detection a user owns, keeping the account.

    The broken-archive repair: a bad import can mint hundreds of junk detections;
    this sweeps them (rows + S3 objects via :func:`collect_media_keys`,
    derivatives included, soft-deleted detections included) without touching the
    account, its geolocations, or its requests. ``closed`` rows that were once
    detected stay (the owner explicitly acted on those). Same
    commit-then-sweep ordering as :func:`hard_delete_user`.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise UserNotFoundError("User not found")

    detections = (
        db.query(Event)
        .options(joinedload(Event.media))
        .filter(Event.owner_id == user.id, Event.status == STATUS_DETECTED)
        .all()
    )
    media_keys: list[str] = []
    for detection in detections:
        media_keys.extend(collect_media_keys(list(detection.media)))

    target = {
        "user_id": str(user.id),
        "username": user.username,
        "deleted_events": len(detections),
        "media_count": len(media_keys),
    }
    for detection in detections:
        db.delete(detection)
    log_admin_event(db, actor_id=actor_id, action="detected_events_purged", target=target)
    db.commit()

    sweep_keys(media_keys, context=f"user {user_id} detected purge")

    return target


def detection_quality_stats(db: Session) -> AdminDetectionStatsRead:
    """Machine-extraction quality signal for the admin panel (read-only).

    See :class:`AdminDetectionStatsRead` for the exact definitions. Two cheap
    aggregate queries, each one grouped pass with conditional counts:

    1. Reject-rate over every machine detection (``detected_from_url`` set):
       the ``count(*) FILTER (WHERE ...)`` of dismissed
       detections over the total. A machine detection dismissed before it was
       published counts as a reject whichever door it left through: an owner close off
       ``detected`` or an admin soft-delete that never left ``detected``. A
       soft-deleted ``geolocated`` row is not a reject (it was vouched before
       removal). Both shapes are ones
       :func:`app.services.detection._row_disposition` refuses to re-import,
       since each records a judgment a re-import must not undo.
    2. The live ``detected`` queue (``deleted_at IS NULL``, human rows
       excluded), counting the detections missing a source media, a proof image,
       or a source URL, the pieces the geolocate floor will demand.
    """
    machine = Event.detected_from_url.isnot(None)
    rejected = or_(
        and_(Event.status == STATUS_CLOSED, Event.before_closed_status == STATUS_DETECTED),
        and_(Event.deleted_at.isnot(None), Event.status == STATUS_DETECTED),
    )
    machine_total, machine_rejected = (
        db.query(
            func.count(),
            func.count().filter(rejected),
        )
        .filter(machine)
        .one()
    )

    pending = and_(
        Event.status == STATUS_DETECTED,
        Event.deleted_at.is_(None),
        Event.detected_from_url.isnot(None),
    )
    has_source = Event.media.any(Media.role == "source")
    has_proof = Event.media.any(and_(Media.role == "proof", Media.media_type == "image"))
    (
        pending_total,
        missing_source_media,
        missing_proof_image,
        missing_source_url,
    ) = (
        db.query(
            func.count(),
            func.count().filter(~has_source),
            func.count().filter(~has_proof),
            func.count().filter(Event.source_url.is_(None)),
        )
        .filter(pending)
        .one()
    )

    return AdminDetectionStatsRead(
        machine_total=int(machine_total),
        machine_rejected=int(machine_rejected),
        reject_rate=(int(machine_rejected) / int(machine_total)) if machine_total else 0.0,
        pending=int(pending_total),
        pending_missing_source_media=int(missing_source_media),
        pending_missing_proof_image=int(missing_proof_image),
        pending_missing_source_url=int(missing_source_url),
    )
