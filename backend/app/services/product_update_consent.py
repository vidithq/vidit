"""The consent to product update emails and the signed unsubscribe token.

Each grant is a ``product_update_consents`` row. A withdrawal stamps it and a
later grant adds a row, so the record of earlier grants stays.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.product_update import ConsentSource, ProductUpdateConsent
from app.services import unsubscribe_tokens
from app.services.unsubscribe_tokens import InvalidUnsubscribeTokenError

_TOKEN_PURPOSE = b"vidit:product-updates-unsubscribe:"


def unsubscribe_token(user_id: uuid.UUID) -> str:
    """A token naming ``user_id`` and the product update unsubscribe."""
    return unsubscribe_tokens.sign(_TOKEN_PURPOSE, user_id)


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
    user_id, scope = unsubscribe_tokens.verify(_TOKEN_PURPOSE, token)
    if scope:
        raise InvalidUnsubscribeTokenError("This unsubscribe link is not valid.")
    withdraw(db, user_id=user_id)
    db.commit()
