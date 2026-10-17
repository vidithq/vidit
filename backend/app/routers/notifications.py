import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
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
from app.services.unsubscribe_tokens import InvalidUnsubscribeTokenError

router = APIRouter()


@router.get("", response_model=list[NotificationRead])
@limiter.limit("120/minute")
def list_notifications(
    request: Request,
    response: Response,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[NotificationRead]:
    """Your notifications, newest first, capped at 100 per page (``Link: rel="next"`` cursor).

    Listing marks nothing read; ``POST /notifications/read`` does.
    """
    size = page_size(limit)
    window = notifications_service.list_feed(
        db,
        user=current_user,
        limit=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r.created_at, r.id))
    answered = notifications_service.answered_approval_requests(db, user=current_user, rows=rows)
    return [notifications_service.build_read(row, answered=answered) for row in rows]


@router.get("/unread-count", response_model=NotificationUnreadCount)
@limiter.limit("120/minute")
def get_unread_count(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationUnreadCount:
    """How many visible notifications you have not been shown yet."""
    return NotificationUnreadCount(count=notifications_service.unread_count(db, user=current_user))


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def mark_notifications_read(
    request: Request,
    body: NotificationReadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Mark the listed notifications read. Ids that are not yours change nothing."""
    notifications_service.mark_read(db, user=current_user, ids=body.ids)
    db.commit()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def delete_notification(
    request: Request,
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    """Send a mail client that opens the ``List-Unsubscribe`` URL to the confirmation page.

    Changes nothing: a mail scanner opens links too. The page posts the token back here once
    the reader confirms.
    """
    return RedirectResponse(
        app_url(f"/unsubscribe/notifications?token={quote(token, safe='')}"),
        status_code=status.HTTP_303_SEE_OTHER,
    )


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def unsubscribe_email(
    request: Request,
    token: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> Response:
    """Turn off one kind of notification email, named by a signed token.

    Needs no session: a mail client posts it one-click from the
    ``List-Unsubscribe`` header. Idempotent; 400 on a token that does not
    verify.
    """
    try:
        preferences_service.unsubscribe_email(db, token)
    except InvalidUnsubscribeTokenError as exc:
        raise_typed_error(exc, {exc.code: 400})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
