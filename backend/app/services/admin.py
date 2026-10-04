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
from app.models.collection import Collection
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
    EventVersion,
)
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.user import User
from app.schemas.admin import (
    AdminDetectionStatsRead,
    AdminInviteCodeRead,
    AdminInviteRedeemerRead,
)
from app.services import versions
from app.services.auth import bump_token_version, generate_invite_code, invite_code_status
from app.services.evidence_intake import (
    collect_event_media_keys,
    collect_media_keys,
    collect_snapshot_media_keys,
    orphaned_source_media,
    prune_unreferenced_proof_media,
)
from app.services.pagination import keyset_before, take_page
from app.services.storage import avatar_key_of, sweep_keys


class AdminError(Exception):
    """Base for friendly errors raised by admin services.

    Carries a ``code`` so the router maps to an HTTP status without string-matching exception
    text. Mirrors :class:`app.services.registration.RegistrationError`.
    """

    code: str = "admin_error"


class UserNotFoundError(AdminError):
    code = "user_not_found"


class EventNotFoundError(AdminError):
    code = "geolocation_not_found"


class XHandleConflictError(AdminError):
    code = "x_handle_conflict"


class VersionNotFoundError(AdminError):
    """The event carries no version under that number."""

    code = "version_not_found"


class InviteCodeUsedError(AdminError):
    """The code names a redeemer, so its row belongs to the audit trail."""

    code = "invite_code_used"


class CollectionNotFoundError(AdminError):
    """No collection carries that id."""

    code = "collection_not_found"


def _redeemer_reads(db: Session, users: list[User]) -> dict[uuid.UUID, AdminInviteRedeemerRead]:
    """Batch the onboarding counters for every redeemer in one pass per source.

    Grouped aggregates over ``archive_import_jobs``, ``bot_mentions`` (by lowercased handle),
    ``events`` and ``auth_events``, so the invite list stays O(1) queries. ``last_seen_at``
    falls back to the newest ``login`` auth event for rows predating ``users.last_seen_at``.
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
            last_seen_at=u.last_seen_at or logins.get(u.id),
        )
        for u in users
    }


def serialize_invite_codes(db: Session, invites: list[InviteCode]) -> list[AdminInviteCodeRead]:
    redeemers = _redeemer_reads(db, [i.used_by_user for i in invites if i.used_by_user is not None])
    return [
        AdminInviteCodeRead(
            id=invite.id,
            code=invite.code,
            expires_at=invite.expires_at,
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

    Soft-deleted rows count too: ``users.x_handle`` is UNIQUE across every row.
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
    """Append a row to ``admin_events``. No commit: the caller owns the transaction."""
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

    A bound ``x_handle`` (already normalized by the schema) is copied onto the account at
    redemption; minting against a handle a user already carries raises the same conflict as the
    direct link endpoint.
    """
    if x_handle is not None:
        _assert_x_handle_free(db, x_handle)
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
    invite = InviteCode(
        code=generate_invite_code(),
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

    No status filtering: an admin needs revoked and expired rows to remember what was issued.
    Paged on the ``created_at DESC, id DESC`` keyset, since only an unused code's row ever
    leaves the table.
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
    # Idempotent: keep the original ``revoked_at`` and skip the audit append.
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


def delete_invite_code(
    db: Session,
    *,
    actor_id: uuid.UUID,
    invite_id: uuid.UUID,
) -> bool:
    """Drop an unredeemed invite code row. Returns False when the id is unknown.

    Revocation keeps the row; deletion cleans up a code no account was created from. A row
    naming a redeemer is refused: it is the account's origin record. The audit row keeps the
    code value. An unconfirmed registration started from the code goes with it
    (``ON DELETE CASCADE``), the same outcome as revoking the code under that signup.
    """
    invite = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    if invite is None:
        return False
    if invite.used_by is not None:
        raise InviteCodeUsedError("A redeemed invite code cannot be deleted")
    log_admin_event(
        db,
        actor_id=actor_id,
        action="invite_deleted",
        target={"invite_code_id": str(invite.id), "code": invite.code},
    )
    db.delete(invite)
    db.commit()
    return True


def search_users(db: Session, *, query: str, limit: int = 20) -> list[User]:
    """Case-insensitive substring match on username or email.

    ``ILIKE`` is fine at low-hundreds-of-users scale; past ~10k users, switch to pg_trgm + GIN.
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

    The schema validator already normalized the value. A handle held by any other user raises
    the conflict error.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.deleted_at is not None:
        # A link on a tombstoned account would resurrect with the row.
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
        # The pre-check races the UNIQUE (a concurrent link or invite redemption can land
        # before commit): surface the same typed 409 instead of a 500.
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

    Idempotent: an already soft-deleted row keeps its timestamp and files no audit row. S3
    objects and media rows stay put (evidence is preserved, just hidden).
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


def withhold_collection(db: Session, *, collection: Collection, actor_id: uuid.UUID) -> None:
    """Stamp one collection's takedown and file the audit row. No commit.

    Shared by :func:`hide_collection` and :func:`services.reports.resolve_report`, so both doors
    write the same thing. It lives here because ``services/reports`` imports this module for
    :func:`log_admin_event`.

    Idempotent: an already withheld collection keeps its timestamp and files no second audit row.
    """
    if collection.hidden_at is not None:
        return
    collection.hidden_at = datetime.now(UTC)
    log_admin_event(
        db,
        actor_id=actor_id,
        action="collection_hidden",
        target={"collection_id": str(collection.id), "title": collection.title},
    )


def restore_collection(db: Session, *, collection: Collection, actor_id: uuid.UUID) -> None:
    """Clear one collection's takedown and file the audit row. No commit.

    The reverse of :func:`withhold_collection`. The collection's events are untouched: each
    carries its own moderation state.

    Idempotent: a collection that is not withheld files no audit row.
    """
    if collection.hidden_at is None:
        return
    collection.hidden_at = None
    log_admin_event(
        db,
        actor_id=actor_id,
        action="collection_restored",
        target={"collection_id": str(collection.id), "title": collection.title},
    )


def set_collection_moderation(
    db: Session,
    *,
    actor_id: uuid.UUID,
    collection_id: uuid.UUID,
    hidden: bool,
) -> Collection:
    """Move one collection's takedown either way, by id.

    The collection-shaped counterpart of ``services/reports.set_event_moderation``, on the same
    reversible ``hidden_at`` axis. ``hidden=True`` writes the stamp :func:`withhold_collection`
    writes.

    Locked like the event a report verdict mutates, so this door and the report queue serialize
    on the row. Raises :class:`CollectionNotFoundError` (404) for an unknown id.
    """
    collection = (
        db.query(Collection)
        .filter(Collection.id == collection_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if collection is None:
        raise CollectionNotFoundError("Collection not found")
    if hidden:
        withhold_collection(db, collection=collection, actor_id=actor_id)
    else:
        restore_collection(db, collection=collection, actor_id=actor_id)
    db.commit()
    db.refresh(collection)
    return collection


def hide_collection(
    db: Session,
    *,
    actor_id: uuid.UUID,
    collection_id: uuid.UUID,
) -> Collection:
    """Withhold one collection from every read but an admin's, by id.

    The takedown half of :func:`set_collection_moderation`, kept for the
    ``DELETE /admin/collections/{id}`` alias. Idempotent, and 404 on an unknown collection.
    """
    return set_collection_moderation(
        db, actor_id=actor_id, collection_id=collection_id, hidden=True
    )


def hard_delete_geolocation(
    db: Session,
    *,
    actor_id: uuid.UUID,
    geolocation_id: uuid.UUID,
) -> dict[str, Any]:
    """GDPR-grade erasure: drop the row, the media rows, and the S3 objects.

    Commit-then-sweep, see :func:`services.storage.sweep_keys`. Reachable on soft-deleted rows
    (soft now, hard later) and on live rows (admin override).
    """
    geo = db.query(Event).filter(Event.id == geolocation_id).first()
    if geo is None:
        raise EventNotFoundError("Event not found")

    # Capture S3 keys before the cascade fires: every media row (all roles, derivatives
    # included), plus the source media a correction superseded, which outlives its row.
    media_keys = collect_event_media_keys(db, geo)

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


def redact_version(
    db: Session,
    *,
    actor_id: uuid.UUID,
    geolocation_id: uuid.UUID,
    version_no: int,
) -> EventVersion:
    """Blank one filed version of an event, keeping the row and its number.

    The moderation exit for a version whose content the record must stop serving.
    ``event_versions`` is append-only, so the snapshot and the note are blanked in place and the
    row is stamped ``redacted_at`` / ``redacted_by_id``. ``version_no`` and ``created_at`` stay,
    so ``/vN`` addressing never shifts.

    This is also the one write outside an edit that can free evidence: a proof image no readable
    version and no current proof body points at is deleted (row and object), and so is the S3
    object of a superseded source media this version alone named. Both run commit-then-sweep.

    Idempotent: a second call changes nothing and writes no audit row, like
    ``services/reports.set_event_moderation``. Raises :class:`EventNotFoundError` (404) for an
    unknown or soft-deleted event and :class:`VersionNotFoundError` (404) for a missing version.
    """
    # Locked like a moderation verdict: the prune below reads this event's media and history,
    # so a concurrent edit must not interleave its own proof diff.
    event = (
        db.query(Event)
        .filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
        .populate_existing()
        .with_for_update()
        .first()
    )
    if event is None:
        raise EventNotFoundError("Event not found")
    row = versions.get_version(db, event_id=event.id, version_no=version_no)
    if row is None:
        raise VersionNotFoundError("Version not found")
    # Read what this version rendered before it is blanked; the flush puts the redaction ahead
    # of the queries below, so neither counts this row as holding a file alive.
    superseded_sources = versions.media_fragment(row.snapshot, "source_media")
    if not versions.redact_version(db, version=row, actor_id=actor_id):
        return row
    db.flush()

    # The audit entry counts media (one per source image); the sweep takes the keys (a source
    # image owns two derivatives as well).
    removed_proof_keys, removed_proof_rows = prune_unreferenced_proof_media(db, event)
    freed_sources = orphaned_source_media(db, event, dropped=superseded_sources)
    removed_keys = removed_proof_keys + collect_snapshot_media_keys(freed_sources)
    log_admin_event(
        db,
        actor_id=actor_id,
        action="event_version_redacted",
        target={
            "geolocation_id": str(event.id),
            "version_no": version_no,
            "removed_media_count": removed_proof_rows + len(freed_sources),
        },
    )
    db.commit()
    db.refresh(row)

    sweep_keys(removed_keys, context=f"event {event.id} version {version_no} redaction")
    return row


def soft_delete_user(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[User, int]:
    """Mark a user as removed-from-public-view + cascade to their submissions.

    Returns ``(user, cascaded_geolocations)``: the count of live (``deleted_at IS NULL``) events
    flipped in this call. Idempotent on an already-deleted user (same timestamp, no audit row,
    count zero).

    Requests and geolocations are one table, so a single cascade covers both.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise UserNotFoundError("User not found")
    if user.deleted_at is not None:
        return user, 0

    now = datetime.now(UTC)
    user.deleted_at = now
    # ``get_current_user`` already rejects soft-deleted accounts; bumping ``token_version``
    # also covers paths that fetched the user first, and stops a later un-soft-delete (the
    # column is recoverable) from reviving old sessions.
    bump_token_version(user)
    # Release the X handle: the UNIQUE constraint spans tombstoned rows, so a kept link would
    # 409 every future re-link while the PATCH endpoint refuses tombstoned targets. The audit
    # target records the freed value.
    freed_x_handle = user.x_handle
    user.x_handle = None

    # Cascade to every live event (located and requested). ``deleted_at IS NULL`` leaves earlier
    # timestamps untouched, so the count reflects only what this call flipped.
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
    """GDPR-grade erasure: drop the user, every event they own, and every S3 object referenced
    by the cascade.

    Order matters:

    1. Capture S3 keys upfront (media of all roles across their events, plus the account's
       avatar): the cascade would drop those rows before we could read them.
    2. Delete each event manually: ``owner_id`` carries no ``ON DELETE CASCADE``. Each
       ``db.delete`` cascades to that row's media, contributor rows and tags.
    3. Delete the user. ``auth_tokens``, their collections (and memberships) and their
       contributor rows on other people's events cascade-drop; ``admin_events.actor_id`` and
       ``invite_codes.used_by`` flip to NULL (migration f1a3b5c7d9e0), so invite-code rows
       outlive the user as audit trail.
    4. Commit, then sweep S3 (see :func:`services.storage.sweep_keys`).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise UserNotFoundError("User not found")

    # 1. Capture every S3 key the user's events reference, plus their profile picture (personal
    # data on the same erasure request, referenced by nothing else once the row is gone).
    geolocations = db.query(Event).filter(Event.owner_id == user.id).all()
    geo_media_keys: list[str] = []
    for geo in geolocations:
        geo_media_keys.extend(collect_event_media_keys(db, geo))
    avatar_key = avatar_key_of(user.avatar_url)

    target = {
        "user_id": str(user.id),
        "username": user.username,
        "geolocation_count": len(geolocations),
        "media_count": len(geo_media_keys),
    }

    # 2. Drop events manually so their cascades fire before the user row goes.
    for geo in geolocations:
        db.delete(geo)

    # 3. Drop the user row.
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

    The broken-archive repair: rows and S3 objects (via :func:`collect_media_keys`, derivatives
    and soft-deleted detections included), leaving the account, geolocations and requests.
    ``closed`` rows that were once detected stay (the owner acted on them). Same
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

    See :class:`AdminDetectionStatsRead` for the exact definitions. Two grouped aggregate
    queries:

    1. Reject-rate over every machine detection (``Event.is_machine_detection``): dismissed
       detections over the total. A detection dismissed before publication counts as a reject
       through either door: an owner close off ``detected``, or an admin soft-delete that never
       left ``detected``. A soft-deleted ``geolocated`` row is not a reject (it was vouched).
       :func:`app.services.detection._row_disposition` refuses to re-import both shapes.
    2. The live ``detected`` queue (``deleted_at IS NULL``, human rows excluded), counting
       detections missing a source media, a proof image or a source URL, which the geolocate
       floor demands.
    """
    # A bot-opened request carries ``detected_from_url`` too, so the cohort is the model's own
    # predicate rather than a second spelling of it.
    machine = Event.is_machine_detection
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

    pending = and_(Event.status == STATUS_DETECTED, Event.deleted_at.is_(None), machine)
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
