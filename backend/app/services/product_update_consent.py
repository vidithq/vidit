"""The consent to product update emails and the signed unsubscribe token.

Each grant is a ``product_update_consents`` row. A withdrawal stamps it and a
later grant adds a row, so the record of earlier grants stays.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import uuid
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.product_update import ConsentSource, ProductUpdateConsent

_TOKEN_PURPOSE = b"vidit:product-updates-unsubscribe:"


class InvalidUnsubscribeTokenError(Exception):
    code = "invalid_unsubscribe_token"


def _signature(user_id: uuid.UUID) -> bytes:
    return hmac.new(
        settings.jwt_secret.encode(), _TOKEN_PURPOSE + user_id.bytes, hashlib.sha256
    ).digest()


def unsubscribe_token(user_id: uuid.UUID) -> str:
    """A token naming ``user_id`` and the unsubscribe purpose. It carries no
    expiry, so the link in an old email keeps working; rotating
    ``JWT_SECRET`` voids every token."""
    sig = base64.urlsafe_b64encode(_signature(user_id)).rstrip(b"=").decode()
    return f"{user_id.hex}.{sig}"


def _token_user_id(token: str) -> uuid.UUID | None:
    head, _, sig = token.partition(".")
    try:
        user_id = uuid.UUID(hex=head)
        given = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4))
    except (ValueError, binascii.Error):
        return None
    return user_id if hmac.compare_digest(given, _signature(user_id)) else None


def has_consent(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.query(ProductUpdateConsent.id)
        .filter(
            ProductUpdateConsent.user_id == user_id,
            ProductUpdateConsent.withdrawn_at.is_(None),
        )
        .first()
        is not None
    )


def grant(db: Session, *, user_id: uuid.UUID, source: ConsentSource, at: datetime) -> None:
    """Open a consent unless one is current. The caller commits."""
    db.execute(
        insert(ProductUpdateConsent)
        .values(id=uuid.uuid4(), user_id=user_id, source=source, granted_at=at)
        .on_conflict_do_nothing(
            index_elements=["user_id"], index_where=ProductUpdateConsent.withdrawn_at.is_(None)
        )
    )


def withdraw(db: Session, *, user_id: uuid.UUID) -> None:
    """Close the current consent, if any. The caller commits."""
    db.execute(
        update(ProductUpdateConsent)
        .where(
            ProductUpdateConsent.user_id == user_id,
            ProductUpdateConsent.withdrawn_at.is_(None),
        )
        .values(withdrawn_at=datetime.now(UTC))
    )


def unsubscribe(db: Session, token: str) -> None:
    """Withdraw the consent the token names. Idempotent: an account with no
    current consent, or none at all, answers the same."""
    user_id = _token_user_id(token)
    if user_id is None:
        raise InvalidUnsubscribeTokenError("This unsubscribe link is not valid.")
    withdraw(db, user_id=user_id)
    db.commit()
