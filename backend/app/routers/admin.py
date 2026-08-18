import uuid
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.dependencies import get_db, require_admin
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.admin import (
    AdminDetectionStatsRead,
    AdminEventDeleteResponse,
    AdminEventModerationRead,
    AdminEventModerationUpdate,
    AdminInviteCodeCreate,
    AdminInviteCodeRead,
    AdminMaintenanceResponse,
    AdminMeResponse,
    AdminPurgeDetectedResponse,
    AdminUserDeleteResponse,
    AdminUserRead,
    UserXHandleUpdate,
)
from app.schemas.report import ContentReportList, ContentReportRead, ContentReportUpdate
from app.services import admin as admin_service
from app.services import maintenance as maintenance_service
from app.services import registration as registration_service
from app.services import reports as reports_service
from app.services.pagination import MAX_PAGE_SIZE, decode_cursor, next_link, page_size

router = APIRouter()

_ADMIN_ERROR_STATUS: dict[str, int] = {
    "user_not_found": 404,
    "geolocation_not_found": 404,
    "x_handle_conflict": 409,
}


def _raise_admin_error(exc: admin_service.AdminError) -> NoReturn:
    """Translate a typed admin error into a structured HTTP response."""
    raise_typed_error(exc, _ADMIN_ERROR_STATUS)


@router.get("/me", response_model=AdminMeResponse)
def admin_me(current_user: User = Depends(require_admin)) -> AdminMeResponse:
    """Frontend route-guard probe: 200 + ``{is_admin: true}`` for admins, 403
    otherwise. Does not leak ``is_admin`` into the public ``UserRead``."""
    return AdminMeResponse(is_admin=True)


@router.get("/detection-stats", response_model=AdminDetectionStatsRead)
def detection_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminDetectionStatsRead:
    """Machine-extraction quality signal: the reject-rate over machine
    detections plus the missing-piece counts on the pending queue. Read-only,
    no audit row (a metric read is not an administrative act). See
    ``AdminDetectionStatsRead`` for the exact definitions."""
    return admin_service.detection_quality_stats(db)


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
    try:
        invite = admin_service.create_invite_code(
            db,
            actor_id=current_user.id,
            expires_in_days=body.expires_in_days,
            x_handle=body.x_handle,
        )
    except admin_service.AdminError as exc:
        _raise_admin_error(exc)
    return admin_service.serialize_invite_code(db, invite)


@router.get("/invite-codes", response_model=list[AdminInviteCodeRead])
def list_invite_codes(
    request: Request,
    response: Response,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[AdminInviteCodeRead]:
    """Invite codes, newest first, capped at 100 per page.

    The table is append-only, so the admin console reads it a page at a time
    through the ``Link: rel="next"`` cursor like every other list.
    """
    size = page_size(limit)
    rows, has_next = admin_service.list_invite_codes(
        db,
        limit=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
    )
    if has_next:
        last = rows[-1]
        response.headers["Link"] = next_link(request, last.created_at, last.id)
    return admin_service.serialize_invite_codes(db, rows)


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
    return admin_service.serialize_invite_code(db, invite)


@router.get("/users", response_model=list[AdminUserRead])
def search_users(
    q: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[User]:
    """Case-insensitive substring match on username or email. Empty query
    returns []; the admin search box doesn't preload the whole user table."""
    return admin_service.search_users(db, query=q)


@router.patch("/users/{user_id}/x-handle", response_model=AdminUserRead)
@limiter.limit("60/hour")
def set_user_x_handle(
    request: Request,
    user_id: uuid.UUID,
    body: UserXHandleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> User:
    """Link or clear the X handle the bot attributes mentions to. The only
    write path for ``users.x_handle`` today; self-serve linking waits on
    verify-by-post."""
    try:
        return admin_service.set_user_x_handle(
            db,
            actor_id=current_user.id,
            user_id=user_id,
            x_handle=body.x_handle,
        )
    except admin_service.AdminError as exc:
        _raise_admin_error(exc)


@router.delete(
    "/users/{user_id}/detected-events",
    response_model=AdminPurgeDetectedResponse,
)
@limiter.limit("30/hour")
def purge_detected_events_admin(
    request: Request,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminPurgeDetectedResponse:
    """Hard-delete every detection the user owns (rows + S3 media),
    keeping the account and everything else they authored. The
    broken-archive repair."""
    try:
        result = admin_service.purge_detected_events(db, actor_id=current_user.id, user_id=user_id)
    except admin_service.AdminError as exc:
        _raise_admin_error(exc)
    points_cache.invalidate()
    return AdminPurgeDetectedResponse(
        user_id=user_id,
        username=result["username"],
        deleted_events=result["deleted_events"],
        media_count=result["media_count"],
    )


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


# ── Content reports ──────────────────────────────────────────────────────


@router.get("/reports", response_model=ContentReportList)
def list_reports(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ContentReportList:
    """The moderation queue: open reports first, newest first within each group.

    Resolved rows stay in the list rather than dropping out of it: a report is
    never deleted, so the queue doubles as the record of what was reported and
    what was decided. Offset-paged (see ``ContentReportList``), capped at 100
    rows per page.
    """
    per_page = page_size(per_page)
    rows, total = reports_service.list_reports(db, page=page, per_page=per_page)
    return ContentReportList(
        items=[ContentReportRead.model_validate(row) for row in rows],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("/reports/{report_id}/resolve", response_model=ContentReportRead)
@limiter.limit("60/hour")
def resolve_report(
    request: Request,
    report_id: uuid.UUID,
    body: ContentReportUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ContentReportRead:
    """Close one report with a verdict, applying it to the reported event.

    404 on an unknown report, 409 on one that already carries a verdict
    (reports are resolved once, never reopened). The service owns the event
    mutation and the audit trail; the points cache is dropped here, and only
    when the event actually left the map.
    """
    try:
        report, hidden_changed = reports_service.resolve_report(
            db,
            report_id=report_id,
            resolution=body.resolution,
            actor_id=current_user.id,
        )
    except reports_service.ReportError as exc:
        raise_typed_error(exc, reports_service.REPORT_ERROR_STATUS)
    if hidden_changed:
        points_cache.invalidate()
    return ContentReportRead.model_validate(report)


@router.patch("/events/{geolocation_id}/moderation", response_model=AdminEventModerationRead)
@limiter.limit("60/hour")
def set_event_moderation(
    request: Request,
    geolocation_id: uuid.UUID,
    body: AdminEventModerationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminEventModerationRead:
    """Set an event's moderation state directly, with no report behind it.

    Both fields are optional and independent; a field left out, or sent equal
    to what the row already holds, changes nothing and writes no audit row. The
    one verb that also UNDOES a takedown. 404 for an unknown or soft-deleted
    event.
    """
    try:
        event, hidden_changed = reports_service.set_event_moderation(
            db,
            geolocation_id=geolocation_id,
            is_graphic=body.is_graphic,
            hidden=body.hidden,
            actor_id=current_user.id,
        )
    except reports_service.ReportError as exc:
        raise_typed_error(exc, reports_service.REPORT_ERROR_STATUS)
    if hidden_changed:
        points_cache.invalidate()
    return AdminEventModerationRead.model_validate(event)


# ── Maintenance ──────────────────────────────────────────────────────────


@router.post("/maintenance/reap-auth-tokens", response_model=AdminMaintenanceResponse)
@limiter.limit("30/hour")
def maintenance_reap_auth_tokens(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminMaintenanceResponse:
    """Drop expired and old-consumed auth_tokens rows."""
    result = maintenance_service.reap_auth_tokens(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="maintenance_reap_auth_tokens",
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
    result = registration_service.reap_pending_registrations(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="maintenance_reap_pending_registrations",
        target=result,
    )
    db.commit()
    return AdminMaintenanceResponse(**result)


@router.post("/maintenance/send-completion-digests", response_model=AdminMaintenanceResponse)
@limiter.limit("30/hour")
def maintenance_send_completion_digests(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AdminMaintenanceResponse:
    """Email every analyst holding unpublished detections.

    One message per analyst: how many detections wait, and the link back to their
    own Detections queue, where the batch completion publishes them. The nudge
    behind the import: the completion mail scrolls away, the backlog does not.
    Runs on a click like the reapers above, one provider round-trip per
    analyst, capped at ``maintenance.COMPLETION_DIGEST_LIMIT`` addresses; a
    provider failure on one of them is counted, not raised."""
    result = maintenance_service.send_completion_digests(db)
    admin_service.log_admin_event(
        db,
        actor_id=current_user.id,
        action="maintenance_send_completion_digests",
        target=result,
    )
    db.commit()
    return AdminMaintenanceResponse(**result)
