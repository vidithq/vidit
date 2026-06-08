import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models.admin_event import AdminEvent
from app.models.bounty import Bounty
from app.models.geolocation import Geolocation
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.proof_image import ProofImage
from app.models.user import User
from app.schemas.admin import AdminInviteCodeRead, InviteCodeStatus
from app.services.auth import bump_token_version, generate_invite_code
from app.services.storage import StorageDeleteError, get_storage

logger = logging.getLogger(__name__)


def _invite_code_status(invite: InviteCode) -> InviteCodeStatus:
    if invite.revoked_at is not None:
        return "revoked"
    if invite.expires_at is not None and invite.expires_at < datetime.now(UTC):
        return "expired"
    if invite.use_count >= invite.max_uses:
        return "exhausted"
    return "active"


def serialize_invite_code(invite: InviteCode) -> AdminInviteCodeRead:
    return AdminInviteCodeRead(
        id=invite.id,
        code=invite.code,
        max_uses=invite.max_uses,
        use_count=invite.use_count,
        expires_at=invite.expires_at,
        revoked_at=invite.revoked_at,
        created_at=invite.created_at,
        status=_invite_code_status(invite),
        used_by_username=invite.used_by_user.username if invite.used_by_user else None,
        used_at=invite.used_at,
    )


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
) -> InviteCode:
    """Mint a single-use invite code.

    ``max_uses`` is locked to 1 here so every code's audit trail (the
    ``used_by`` / ``used_at`` pair) names exactly one analyst. The column
    accepts higher values, but the admin API doesn't expose them.
    """
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
    invite = InviteCode(
        code=generate_invite_code(),
        created_by=actor_id,
        max_uses=1,
        expires_at=expires_at,
    )
    db.add(invite)
    db.flush()
    log_admin_event(
        db,
        actor_id=actor_id,
        action="invite_created",
        target={"invite_code_id": str(invite.id)},
    )
    db.commit()
    db.refresh(invite)
    return invite


def list_invite_codes(db: Session) -> list[InviteCode]:
    """Return every invite code, newest first.

    No filtering by status — the page renders all codes and surfaces the
    derived status as a chip. An admin reviewing the table needs to see
    revoked / expired rows to remember what was issued, not just the live
    ones.
    """
    return (
        db.query(InviteCode)
        .options(joinedload(InviteCode.used_by_user))
        .order_by(InviteCode.created_at.desc())
        .all()
    )


def revoke_invite_code(
    db: Session,
    *,
    actor_id: uuid.UUID,
    invite_id: uuid.UUID,
) -> InviteCode | None:
    invite = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    if invite is None:
        return None
    # Idempotent: revoking an already-revoked code keeps the original
    # ``revoked_at`` so the audit trail still points to when it actually
    # happened. Skip the audit append in that case too — re-revoking is a
    # no-op, not a fresh administrative act.
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

    The admin uses this to find the row to toggle trust on. ``ILIKE`` is
    fine at closed-beta scale (low hundreds of users); when the user table
    grows past ~10k consider pg_trgm + GIN.
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


def set_user_trust(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
    is_trusted: bool,
    trust_reason: str | None,
) -> User:
    """Grant or revoke ``is_trusted`` on a user, with audit.

    Granting requires a non-empty ``trust_reason`` (caller's responsibility
    to strip whitespace before calling — the schema validator already does).
    Revoking clears any existing reason in the same transaction so we don't
    leak yesterday's rationale onto today's non-trusted row.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.deleted_at is not None:
        # Tombstoned rows are invisible to the trust panel — flipping
        # is_trusted on a deleted account would resurrect a stale signal
        # the moment the row is ever un-deleted.
        raise HTTPException(status_code=404, detail="User not found")

    if is_trusted and not trust_reason:
        raise HTTPException(status_code=422, detail="trust_reason is required when granting trust")

    if is_trusted:
        user.is_trusted = True
        user.trust_reason = trust_reason
        action = "trust_granted"
        target = {"user_id": str(user.id), "trust_reason": trust_reason}
    else:
        user.is_trusted = False
        user.trust_reason = None
        action = "trust_revoked"
        target = {"user_id": str(user.id)}

    log_admin_event(db, actor_id=actor_id, action=action, target=target)
    db.commit()
    db.refresh(user)
    return user


def soft_delete_geolocation(
    db: Session,
    *,
    actor_id: uuid.UUID,
    geolocation_id: uuid.UUID,
) -> Geolocation:
    """Mark a geolocation as removed-from-public-view.

    Idempotent — calling this on an already soft-deleted row preserves the
    original timestamp and skips a fresh audit row (re-soft-deleting is a
    no-op administrative act). The S3 objects + media rows stay put; the
    evidence is preserved, just hidden.
    """
    geo = db.query(Geolocation).filter(Geolocation.id == geolocation_id).first()
    if geo is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")
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

    The DB transaction commits *before* the S3 delete attempt so a flaky
    storage backend can't strand DB rows that point at a still-live key.
    Per-key S3 failures are logged and swallowed — orphaned objects are
    picked up by the proof-image reaper. Reachable on already-soft-deleted
    rows (escalation path: soft now, hard later) and on live rows
    (admin override).
    """
    geo = db.query(Geolocation).filter(Geolocation.id == geolocation_id).first()
    if geo is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")

    # Capture S3 keys *before* the cascade fires. Media rows store the
    # public URL; convert them via the storage layer's reverse-lookup so
    # we hand `delete_many` actual keys (its contract).
    storage = get_storage()
    proof_image_keys = [
        row[0]
        for row in db.query(ProofImage.s3_key).filter(ProofImage.geolocation_id == geo.id).all()
    ]
    media_keys: list[str] = []
    for m in geo.media:
        key = storage.key_from_url(m.storage_url)
        if key:
            media_keys.append(key)
        else:
            # Foreign URL we didn't write (shouldn't happen, but the row
            # has it) — log and skip rather than crash the delete.
            logger.warning(
                "Media row %s has unrecognised storage_url %s — skipping S3 delete",
                m.id,
                m.storage_url,
            )

    target = {
        "geolocation_id": str(geo.id),
        "title": geo.title,
        "media_count": len(geo.media),
        "proof_image_count": len(proof_image_keys),
    }
    db.delete(geo)
    log_admin_event(db, actor_id=actor_id, action="geolocation_hard_deleted", target=target)
    db.commit()

    storage_keys = proof_image_keys + media_keys
    if storage_keys:
        try:
            storage.delete_many(storage_keys)
        except StorageDeleteError:
            logger.exception(
                "Partial S3 delete failure on hard-delete of geolocation %s; orphans may remain",
                geolocation_id,
            )

    return target


def soft_delete_user(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[User, int, int]:
    """Mark a user as removed-from-public-view + cascade to their submissions.

    Returns ``(user, cascaded_geolocations, cascaded_bounties)`` — the
    count of *live* (``deleted_at IS NULL``) rows of each type flipped in
    this call. Re-soft-deleting an already-deleted user is idempotent
    (same timestamp, no fresh audit row, both counts zero).

    Bounties cascade alongside geolocations: a banned author shouldn't
    leave open bounties on the index, and historical (fulfilled/closed)
    bounties shouldn't surface the banned account in their author slot.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.deleted_at is not None:
        return user, 0, 0

    now = datetime.now(UTC)
    user.deleted_at = now
    # Invalidate every outstanding session. `get_current_user` already
    # rejects soft-deleted accounts on the next request, but bumping
    # `token_version` makes the invalidation explicit so any code path
    # that one day fetched the user *before* checking `deleted_at`
    # still 401s — and so an admin un-soft-deleting the user later
    # (no UI today, but the column is recoverable) doesn't accidentally
    # re-revive their old sessions.
    bump_token_version(user)

    # Cascade soft-delete to every live geolocation by this user. ``UPDATE
    # ... WHERE deleted_at IS NULL`` leaves any earlier soft-delete
    # timestamps untouched (so the audit picks up only what *this* call
    # actually flipped).
    cascaded_geolocations = (
        db.query(Geolocation)
        .filter(
            Geolocation.author_id == user.id,
            Geolocation.deleted_at.is_(None),
        )
        .update({Geolocation.deleted_at: now}, synchronize_session=False)
    )

    # Same shape for bounties — every live bounty the user authored gets
    # the same soft-delete stamp. Doesn't touch ``status`` or ``closed_at``;
    # the lifecycle is decoupled from the visibility flag, identical to
    # the geolocation pattern.
    cascaded_bounties = (
        db.query(Bounty)
        .filter(
            Bounty.author_id == user.id,
            Bounty.deleted_at.is_(None),
        )
        .update({Bounty.deleted_at: now}, synchronize_session=False)
    )

    log_admin_event(
        db,
        actor_id=actor_id,
        action="user_soft_deleted",
        target={
            "user_id": str(user.id),
            "username": user.username,
            "cascaded_geolocations": cascaded_geolocations,
            "cascaded_bounties": cascaded_bounties,
        },
    )
    db.commit()
    db.refresh(user)
    return user, cascaded_geolocations, cascaded_bounties


def hard_delete_user(
    db: Session,
    *,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """GDPR-grade erasure: drop the user, every geolocation they authored,
    every bounty they authored, and every S3 object referenced by the
    cascade.

    Order matters:

    1. Capture S3 keys upfront — proof images they own (linked + orphan),
       media URLs across all their geolocations, AND media URLs across
       all their bounties. The cascade about to fire would drop those
       rows before we could read them.
    2. Manually delete each geolocation and bounty. We can't rely on a
       DB cascade because ``geolocations.author_id`` / ``bounties.author_id``
       don't carry ``ON DELETE CASCADE`` (would mean retroactive
       constraint changes). Each ``db.delete(geo)`` / ``db.delete(bounty)``
       cascades to that row's media + proof_images / claims + tags. Geos
       that *fulfilled* the user's bounties (potentially authored by
       other analysts) keep their rows; ``ON DELETE SET NULL`` on
       ``originated_from_bounty_id`` drops just the trace pointer.
    3. Delete the user. ``auth_tokens`` and any still-orphan proof_images
       cascade-drop; ``admin_events.actor_id`` and ``invite_codes.created_by`` /
       ``.used_by`` flip to NULL via the constraints set in
       migration f1a3b5c7d9e0 — invite-code rows are part of the audit
       trail and should outlive the user.
    4. Commit, *then* sweep S3. If S3 fails, the DB is already consistent
       and the proof-image reaper will pick up orphaned objects.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    storage = get_storage()

    # 1. Capture every S3 key this user is responsible for, across every
    # geolocation + bounty they authored AND any orphaned proof images
    # they uploaded but never submitted.
    proof_image_keys = [
        row[0] for row in db.query(ProofImage.s3_key).filter(ProofImage.user_id == user.id).all()
    ]

    def _resolve_keys(media_rows: list[Media]) -> list[str]:
        keys: list[str] = []
        for m in media_rows:
            key = storage.key_from_url(m.storage_url)
            if key:
                keys.append(key)
            else:
                logger.warning(
                    "Media row %s has unrecognised storage_url %s — skipping S3 delete",
                    m.id,
                    m.storage_url,
                )
        return keys

    geolocations = db.query(Geolocation).filter(Geolocation.author_id == user.id).all()
    geo_media_keys: list[str] = []
    for geo in geolocations:
        geo_media_keys.extend(_resolve_keys(list(geo.media)))

    bounties = db.query(Bounty).filter(Bounty.author_id == user.id).all()
    bounty_media_keys: list[str] = []
    for bounty in bounties:
        bounty_media_keys.extend(_resolve_keys(list(bounty.media)))

    target = {
        "user_id": str(user.id),
        "username": user.username,
        "geolocation_count": len(geolocations),
        "bounty_count": len(bounties),
        "media_count": len(geo_media_keys) + len(bounty_media_keys),
        "proof_image_count": len(proof_image_keys),
    }

    # 2. Drop every geolocation + bounty manually so the
    # geo→media + geo→proof_images and bounty→media + bounty→claims + bounty→tags
    # cascades fire before we try to delete the user row.
    for geo in geolocations:
        db.delete(geo)
    for bounty in bounties:
        db.delete(bounty)

    # 3. Drop the user row. auth_tokens cascade-drops, lingering
    # proof_images (no geolocation, no parent geo to cascade through)
    # cascade-drop on user.id, admin_events / invite_codes FKs become NULL.
    db.delete(user)

    log_admin_event(db, actor_id=actor_id, action="user_hard_deleted", target=target)
    db.commit()

    # 4. Best-effort S3 sweep, after the DB transaction is durable.
    storage_keys = proof_image_keys + geo_media_keys + bounty_media_keys
    if storage_keys:
        try:
            storage.delete_many(storage_keys)
        except StorageDeleteError:
            logger.exception(
                "Partial S3 delete failure on hard-delete of user %s; orphans may remain",
                user_id,
            )

    return target
