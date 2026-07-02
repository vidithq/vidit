import uuid
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.dependencies import get_db, require_admin
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.admin import (
    AdminEventDeleteResponse,
    AdminInviteCodeCreate,
    AdminInviteCodeRead,
    AdminMaintenanceResponse,
    AdminMeResponse,
    AdminSeedDemoBountiesRequest,
    AdminSeedDemoBountiesResponse,
    AdminSeedDemoRequest,
    AdminSeedDemoResponse,
    AdminTrustUpdate,
    AdminUserDeleteResponse,
    AdminUserRead,
    AdminWipeDemoBountiesResponse,
    AdminWipeDemoResponse,
)
from app.services import admin as admin_service
from app.services import maintenance as maintenance_service
from app.services import seed as seed_service

router = APIRouter()

_ADMIN_ERROR_STATUS: dict[str, int] = {
    "user_not_found": 404,
    "geolocation_not_found": 404,
    "trust_reason_required": 422,
}


def _raise_admin_error(exc: admin_service.AdminError) -> NoReturn:
    """Translate a typed admin error into a structured HTTP response."""
    raise_typed_error(exc, _ADMIN_ERROR_STATUS)


@router.get("/me", response_model=AdminMeResponse)
def admin_me(current_user: User = Depends(require_admin)) -> AdminMeResponse:
    """Frontend route-guard probe: 200 + ``{is_admin: true}`` for admins, 403
    otherwise. Does not leak ``is_admin`` into the public ``UserRead``."""
    return AdminMeResponse(is_admin=True)


@router.post(
    "/invite-codes",
    response_model=AdminInviteCodeRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def create_invite_code(
    request: Request,
    body: AdminInviteCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminInviteCodeRead:
    invite = admin_service.create_invite_code(
        db,
        actor_id=current_user.id,
        expires_in_days=body.expires_in_days,
    )
    return admin_service.serialize_invite_code(invite)


@router.get("/invite-codes", response_model=list[AdminInviteCodeRead])
def list_invite_codes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[AdminInviteCodeRead]:
    return [admin_service.serialize_invite_code(i) for i in admin_service.list_invite_codes(db)]


@router.delete(
    "/invite-codes/{invite_id}",
    response_model=AdminInviteCodeRead,
)
@limiter.limit("60/hour")
def revoke_invite_code(
    request: Request,
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminInviteCodeRead:
    invite = admin_service.revoke_invite_code(db, actor_id=current_user.id, invite_id=invite_id)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    return admin_service.serialize_invite_code(invite)


@router.get("/users", response_model=list[AdminUserRead])
def search_users(
    q: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[User]:
    """Case-insensitive substring match on username or email. Empty query
    returns []; the admin search box doesn't preload the whole user table."""
    return admin_service.search_users(db, query=q)


@router.patch("/users/{user_id}/trust", response_model=AdminUserRead)
@limiter.limit("60/hour")
def set_user_trust(
    request: Request,
    user_id: uuid.UUID,
    body: AdminTrustUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> User:
    try:
        return admin_service.set_user_trust(
            db,
            actor_id=current_user.id,
            user_id=user_id,
            is_trusted=body.is_trusted,
            trust_reason=body.trust_reason,
        )
    except admin_service.AdminError as exc:
        _raise_admin_error(exc)


@router.delete(
    "/users/{user_id}",
    response_model=AdminUserDeleteResponse,
)
@limiter.limit("30/hour")
def delete_user_admin(
    request: Request,
    user_id: uuid.UUID,
    hard: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminUserDeleteResponse:
    """Remove a user account. Default soft (sets `users.deleted_at` and
    cascade-soft-deletes their submissions); `?hard=true` is GDPR erasure
    (drops the row + cascade-drops their geolocations + sweeps S3). Both
    paths invalidate the points cache."""
    try:
        if hard:
            result = admin_service.hard_delete_user(db, actor_id=current_user.id, user_id=user_id)
            points_cache.invalidate()
            return AdminUserDeleteResponse(
                user_id=user_id,
                username=result["username"],
                mode="hard",
                deleted_at=None,
                cascaded_geolocations=result["geolocation_count"],
                media_count=result["media_count"],
                proof_image_count=result["proof_image_count"],
            )

        user, cascaded_geolocations = admin_service.soft_delete_user(
            db, actor_id=current_user.id, user_id=user_id
        )
    except admin_service.AdminError as exc:
        _raise_admin_error(exc)
    points_cache.invalidate()
    return AdminUserDeleteResponse(
        user_id=user.id,
        username=user.username,
        mode="soft",
        deleted_at=user.deleted_at,
        cascaded_geolocations=cascaded_geolocations,
    )


@router.delete(
    "/events/{geolocation_id}",
    response_model=AdminEventDeleteResponse,
)
@limiter.limit("60/hour")
def delete_geolocation_admin(
    request: Request,
    geolocation_id: uuid.UUID,
    hard: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminEventDeleteResponse:
    """Remove a geolocation. Default is soft (sets `deleted_at`); pass
    `?hard=true` for GDPR-grade erasure (drops the row, media rows, and
    S3 objects). Both paths invalidate the points cache."""
    try:
        if hard:
            result = admin_service.hard_delete_geolocation(
                db, actor_id=current_user.id, geolocation_id=geolocation_id
            )
            points_cache.invalidate()
            return AdminEventDeleteResponse(
                geolocation_id=geolocation_id,
                title=result["title"],
                mode="hard",
                deleted_at=None,
                media_count=result["media_count"],
                proof_image_count=result["proof_image_count"],
            )

        geo = admin_service.soft_delete_geolocation(
            db, actor_id=current_user.id, geolocation_id=geolocation_id
        )
    except admin_service.AdminError as exc:
        _raise_admin_error(exc)
    points_cache.invalidate()
    return AdminEventDeleteResponse(
        geolocation_id=geo.id,
        title=geo.title,
        mode="soft",
        deleted_at=geo.deleted_at,
    )


# ── Demo data ────────────────────────────────────────────────────────────


@router.post("/seed-demo", response_model=AdminSeedDemoResponse)
@limiter.limit("10/hour")
def seed_demo(
    request: Request,
    body: AdminSeedDemoRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminSeedDemoResponse:
    """Generate `count` synthetic demo geolocations attributed to the demo
    author pool. Reads templates from the `demo-pool/` storage prefix; if
    the prefix is empty or missing the expected layout, returns 422 so
    the admin can populate the pool before retrying."""
    try:
        result = seed_service.seed_demo(db, count=body.count)
    except seed_service.NoTemplatesError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="demo_seeded",
        target={"count": result["created"], "templates": result["templates"]},
    )
    db.commit()
    points_cache.invalidate()
    return AdminSeedDemoResponse(**result)


@router.delete("/seed-demo", response_model=AdminWipeDemoResponse)
@limiter.limit("10/hour")
def wipe_demo(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminWipeDemoResponse:
    """Drop every is_demo=True geolocation + user. The `demo-pool/` S3
    objects are NOT touched — they're shared assets for re-seeding."""
    result = seed_service.wipe_demo(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="demo_wiped",
        target={
            "deleted_geos": result["deleted_geos"],
            "deleted_users": result["deleted_users"],
        },
    )
    db.commit()
    points_cache.invalidate()
    return AdminWipeDemoResponse(**result)


@router.post("/seed-demo-bounties", response_model=AdminSeedDemoBountiesResponse)
@limiter.limit("10/hour")
def seed_demo_bounties(
    request: Request,
    body: AdminSeedDemoBountiesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminSeedDemoBountiesResponse:
    """Generate ``count`` synthetic demo bounties attributed to the same
    fixed pool of demo authors as the geolocation seeder. Reads templates
    from the same ``demo-pool/`` S3 prefix — bounties only need media,
    not coordinates, so the template imagery is reused unchanged.
    """
    try:
        result = seed_service.seed_demo_bounties(db, count=body.count)
    except seed_service.NoTemplatesError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="demo_bounties_seeded",
        target={"count": result["created"], "templates": result["templates"]},
    )
    db.commit()
    return AdminSeedDemoBountiesResponse(**result)


@router.delete("/seed-demo-bounties", response_model=AdminWipeDemoBountiesResponse)
@limiter.limit("10/hour")
def wipe_demo_bounties(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminWipeDemoBountiesResponse:
    """Drop every is_demo=True bounty. Demo users and demo geolocations
    are NOT touched — they live behind the separate ``Demo data`` panel
    and an admin may want to keep one population while wiping the other.
    """
    result = seed_service.wipe_demo_bounties(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="demo_bounties_wiped",
        target={"deleted_bounties": result["deleted_bounties"]},
    )
    db.commit()
    return AdminWipeDemoBountiesResponse(**result)


# ── Maintenance ──────────────────────────────────────────────────────────


@router.post("/maintenance/reap-auth-tokens", response_model=AdminMaintenanceResponse)
@limiter.limit("30/hour")
def maintenance_reap_auth_tokens(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminMaintenanceResponse:
    """Drop expired and old-consumed auth_tokens rows. Replaces the cron
    that previously lived in `scripts/reap_auth_tokens.py`."""
    result = maintenance_service.reap_auth_tokens(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="maintenance_reap_auth_tokens",
        target=result,
    )
    db.commit()
    return AdminMaintenanceResponse(**result)


@router.post("/maintenance/reap-proof-orphans", response_model=AdminMaintenanceResponse)
@limiter.limit("30/hour")
def maintenance_reap_proof_orphans(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminMaintenanceResponse:
    """Drop orphan proof_images rows + sweep S3. Replaces the cron that
    previously lived in `scripts/reap_proof_image_orphans.py`."""
    result = maintenance_service.reap_proof_image_orphans(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="maintenance_reap_proof_orphans",
        target=result,
    )
    db.commit()
    return AdminMaintenanceResponse(**result)


@router.post("/maintenance/reap-pending-registrations", response_model=AdminMaintenanceResponse)
@limiter.limit("30/hour")
def maintenance_reap_pending_registrations(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminMaintenanceResponse:
    """Drop expired ``pending_registrations`` rows. A pending row holds
    its email + username until the user confirms or the TTL expires;
    the create path sweeps inline so this button mostly mops up the
    long tail of abandoned signups."""
    result = maintenance_service.reap_pending_registrations(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="maintenance_reap_pending_registrations",
        target=result,
    )
    db.commit()
    return AdminMaintenanceResponse(**result)
