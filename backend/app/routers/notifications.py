import uuid
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse

from app.dependencies import DB, CurrentUser, Cursor
from app.ratelimit import limiter
from app.schemas.notification import (
    NotificationRead,
    NotificationReadUpdate,
    NotificationUnreadCount,
)
from app.services import notifications as notifications_service
from app.services import preferences as preferences_service
from app.services.email_layout import app_url
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_cursor,
    encode_cursor,
    page_size,
    paged,
)

router = APIRouter()


@router.get("", response_model=list[NotificationRead])
@limiter.limit("120/minute")
def list_notifications(
    request: Request,
    response: Response,
    db: DB,
    current_user: CurrentUser,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: Cursor = None,
) -> list[NotificationRead]:
    """Your notifications, newest first, capped at 100 per page (``Link: rel="next"`` cursor)."""
    size = page_size(limit)
    window = notifications_service.list_feed(
        db,
        user=current_user,
        limit=size,
        cursor=decode_cursor(cursor),
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r.created_at, r.id))
    answered = notifications_service.answered_approval_requests(db, user=current_user, rows=rows)
    return [notifications_service.build_read(row, answered=answered) for row in rows]


@router.get("/unread-count", response_model=NotificationUnreadCount)
@limiter.limit("120/minute")
def get_unread_count(
    request: Request, db: DB, current_user: CurrentUser
) -> NotificationUnreadCount:
    """How many visible notifications you have not been shown yet."""
    return NotificationUnreadCount(count=notifications_service.unread_count(db, user=current_user))


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def mark_notifications_read(
    request: Request, body: NotificationReadUpdate, db: DB, current_user: CurrentUser
) -> None:
    """Mark the listed notifications read. Ids that are not yours change nothing."""
    notifications_service.mark_read(db, user=current_user, ids=body.ids)
    db.commit()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def delete_notification(
    request: Request, notification_id: uuid.UUID, db: DB, current_user: CurrentUser
) -> None:
    """Delete one of your notifications. 404 when it is not yours."""
    if not notifications_service.delete(db, user=current_user, notification_id=notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")
    db.commit()


@router.get("/unsubscribe", status_code=status.HTTP_303_SEE_OTHER)
@limiter.limit("30/minute")
def unsubscribe_email_page(
    request: Request,
    token: str = Query(min_length=1, max_length=200),
) -> RedirectResponse:
    """Send a mail client that opens the ``List-Unsubscribe`` URL to the confirmation page."""
    return RedirectResponse(
        app_url(f"/unsubscribe/notifications?token={quote(token, safe='')}"),
        status_code=status.HTTP_303_SEE_OTHER,
    )


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def unsubscribe_email(
    request: Request, db: DB, token: str = Query(min_length=1, max_length=200)
) -> Response:
    """Turn off one kind of notification email, named by a signed token."""
    preferences_service.unsubscribe_email(db, token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
