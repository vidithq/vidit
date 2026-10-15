"""Product update emails: the admin send and the worker's drain of
``product_update_deliveries``.

Consent is its own record (``services/product_update_consent``), not a
notification switch. A send writes one
delivery row per analyst who holds a current consent and a verified address.
The worker sends at most ``PRODUCT_UPDATE_EMAIL_BATCH_SIZE`` per pass and
``PRODUCT_UPDATE_EMAIL_DAILY_CAP`` in any trailing 24 hours, so a large
audience spreads over several days and never takes the notification or auth
share of the provider quota.
"""

from __future__ import annotations

import math
import re
import uuid
from datetime import UTC, datetime
from functools import partial

from sqlalchemy import Select, func, insert, literal, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.notification import DeliveryOutcome
from app.models.product_update import (
    ProductUpdate,
    ProductUpdateConsent,
    ProductUpdateDelivery,
)
from app.models.user import User
from app.schemas.product_update import (
    ProductUpdateCreate,
    ProductUpdatePreview,
    ProductUpdateProgress,
    ProductUpdateRead,
)
from app.services import email
from app.services.admin import log_admin_event
from app.services.email_layout import Block, app_url
from app.services.notification_delivery import (
    CAP_WINDOW,
    RETRY_AFTER,
    STALE_SENDING_AFTER,
    deliver,
    send_email,
)
from app.services.notifications import has_verified_email
from app.services.product_update_consent import unsubscribe_token

_LIST_ITEM = re.compile(r"^[-*] +")


class ProductUpdateError(Exception):
    code: str = "product_update_error"


class AlreadySentError(ProductUpdateError):
    code = "product_update_already_sent"


class UnverifiedAddressError(ProductUpdateError):
    code = "email_unverified"


class ProviderRefusedError(ProductUpdateError):
    code = "test_send_failed"


PRODUCT_UPDATE_ERROR_STATUS: dict[str, int] = {
    AlreadySentError.code: 409,
    UnverifiedAddressError.code: 409,
    ProviderRefusedError.code: 502,
}


def _blocks(body: str) -> list[Block]:
    blocks: list[Block] = []
    for paragraph in re.split(r"\n\s*\n", body.strip()):
        lines = [line.strip() for line in paragraph.strip().splitlines()]
        if all(_LIST_ITEM.match(line) for line in lines):
            blocks.append(tuple(_LIST_ITEM.sub("", line) for line in lines))
        else:
            blocks.append("\n".join(lines))
    return blocks


def _email_for(
    *, to: str, user_id: uuid.UUID, label: str, title: str, body: str, link_url: str | None
) -> email.Email:
    token = unsubscribe_token(user_id)
    return email.product_update_email(
        to=to,
        label=label,
        title=title,
        blocks=_blocks(body),
        link_url=link_url,
        unsubscribe_url=app_url(f"/unsubscribe?token={token}"),
        one_click_url=f"{settings.api_url.rstrip('/')}/product-updates/unsubscribe?token={token}",
    )


def _audience() -> Select[tuple[uuid.UUID]]:
    """Every analyst a send reaches now: a current consent, a verified
    address, a live active account."""
    return (
        select(User.id)
        .join(ProductUpdateConsent, ProductUpdateConsent.user_id == User.id)
        .where(
            ProductUpdateConsent.withdrawn_at.is_(None),
            User.email.is_not(None),
            User.email_verified_at.is_not(None),
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
    )


def _is_recipient(db: Session, user_id: uuid.UUID) -> bool:
    return db.scalar(select(_audience().where(User.id == user_id).exists())) is True


def preview(db: Session, *, admin: User, body: ProductUpdateCreate) -> ProductUpdatePreview:
    """The email as ``admin`` would receive it, and the audience today."""
    message = _email_for(to=admin.email or "", user_id=admin.id, **body.model_dump())
    recipients = db.scalar(select(func.count()).select_from(_audience().subquery())) or 0
    cap = settings.product_update_email_daily_cap
    return ProductUpdatePreview(
        subject=message.subject,
        html=message.html,
        text=message.text,
        recipients=recipients,
        daily_cap=cap,
        batch_size=settings.product_update_email_batch_size,
        days=math.ceil(recipients / cap),
    )


def send_test(*, admin: User, body: ProductUpdateCreate) -> None:
    """Email the announcement to ``admin`` alone, inline and outside the caps."""
    if not has_verified_email(admin):
        raise UnverifiedAddressError("Your address is not verified, so no test can go to it.")
    assert admin.email is not None
    try:
        email.send(_email_for(to=admin.email, user_id=admin.id, **body.model_dump()))
    except email.EmailSendError as exc:
        raise ProviderRefusedError("The provider did not accept the test email.") from exc


def send(db: Session, *, admin: User, body: ProductUpdateCreate) -> ProductUpdateRead:
    """Record the announcement and queue one delivery per recipient, in one
    transaction. The UNIQUE label is the lock: a concurrent or repeated send of
    the same label waits on it, then finds it taken."""
    update_id = db.scalar(
        pg_insert(ProductUpdate)
        .values(id=uuid.uuid4(), sent_by=admin.id, recipient_count=0, **body.model_dump())
        .on_conflict_do_nothing(index_elements=["label"])
        .returning(ProductUpdate.id)
    )
    if update_id is None:
        db.rollback()
        raise AlreadySentError(f"Release {body.label} was already announced.")
    db.execute(
        insert(ProductUpdateDelivery).from_select(
            ["id", "product_update_id", "user_id", "status", "attempts", "created_at"],
            _audience().with_only_columns(
                func.gen_random_uuid(),
                literal(update_id),
                User.id,
                literal("queued"),
                literal(0),
                func.now(),
            ),
        )
    )
    recipients = (
        db.scalar(select(func.count()).where(ProductUpdateDelivery.product_update_id == update_id))
        or 0
    )
    row = db.get_one(ProductUpdate, update_id)
    row.recipient_count = recipients
    log_admin_event(
        db,
        actor_id=admin.id,
        action="product_update_sent",
        target={"label": body.label, "recipients": recipients},
    )
    db.commit()
    return _read(row, ProductUpdateProgress(queued=recipients))


def _read(row: ProductUpdate, progress: ProductUpdateProgress) -> ProductUpdateRead:
    return ProductUpdateRead(
        id=row.id,
        label=row.label,
        title=row.title,
        link_url=row.link_url,
        created_at=row.created_at,
        recipient_count=row.recipient_count,
        progress=progress,
    )


def list_updates(db: Session) -> list[ProductUpdateRead]:
    counts: dict[uuid.UUID, dict[str, int]] = {}
    for update_id, status, count in db.execute(
        select(
            ProductUpdateDelivery.product_update_id,
            ProductUpdateDelivery.status,
            func.count(),
        ).group_by(ProductUpdateDelivery.product_update_id, ProductUpdateDelivery.status)
    ):
        counts.setdefault(update_id, {})[status] = count
    rows = db.query(ProductUpdate).order_by(ProductUpdate.created_at.desc()).all()
    return [_read(row, ProductUpdateProgress(**counts.get(row.id, {}))) for row in rows]


def _claim_next(db: Session, *, now: datetime) -> ProductUpdateDelivery | None:
    sent_today = (
        db.query(func.count(ProductUpdateDelivery.id))
        .filter(
            ProductUpdateDelivery.status == "sent",
            ProductUpdateDelivery.sent_at >= now - CAP_WINDOW,
        )
        .scalar()
        or 0
    )
    if sent_today >= settings.product_update_email_daily_cap:
        return None
    row = (
        db.query(ProductUpdateDelivery)
        .filter(
            ProductUpdateDelivery.status == "queued",
            or_(
                ProductUpdateDelivery.claimed_at.is_(None),
                ProductUpdateDelivery.claimed_at < now - RETRY_AFTER,
            ),
        )
        .order_by(ProductUpdateDelivery.created_at, ProductUpdateDelivery.id)
        .with_for_update(skip_locked=True)
        .first()
    )
    if row is None:
        return None
    row.status = "sending"
    row.claimed_at = now
    db.commit()
    return row


def _attempt(db: Session, row: ProductUpdateDelivery) -> DeliveryOutcome:
    """Send the row's email, or skip it when the recipient withdrew consent,
    lost the verified address or left since the send."""
    if not _is_recipient(db, row.user_id):
        return "skipped"
    recipient = db.get_one(User, row.user_id)
    announcement = row.product_update
    assert recipient.email is not None
    message = _email_for(
        to=recipient.email,
        user_id=recipient.id,
        label=announcement.label,
        title=announcement.title,
        body=announcement.body,
        link_url=announcement.link_url,
    )
    return send_email(message, what=f"product update email {row.id}")


def drain(db: Session) -> int:
    """Send up to one batch of claimable rows; return the rows handled. A row
    stuck in ``sending`` past the stale limit turns ``failed``. A queued row
    never expires: a large audience takes days. A row that raises counts as a
    refusal and the batch goes on."""
    now = datetime.now(UTC)
    db.execute(
        update(ProductUpdateDelivery)
        .where(
            ProductUpdateDelivery.status == "sending",
            ProductUpdateDelivery.claimed_at < now - STALE_SENDING_AFTER,
        )
        .values(status="failed")
    )
    db.commit()
    handled = 0
    while handled < settings.product_update_email_batch_size and (
        row := _claim_next(db, now=datetime.now(UTC))
    ):
        deliver(db, row, partial(_attempt, db, row), what="product update email")
        handled += 1
    return handled
