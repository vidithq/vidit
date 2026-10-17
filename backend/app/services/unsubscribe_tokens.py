"""Signed unsubscribe tokens: an account, a purpose and an optional scope, under ``JWT_SECRET``.

A token reads ``<user id hex>.<signature>``, or ``<user id hex>.<scope>.<signature>`` with a
scope. The purpose is in the signature only, so a token signed for one purpose never verifies
for another. A token carries no expiry, so the link in an old email keeps working; rotating
``JWT_SECRET`` voids every token.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import uuid

from app.config import settings


class InvalidUnsubscribeTokenError(Exception):
    code = "invalid_unsubscribe_token"


def _signature(purpose: bytes, user_id: uuid.UUID, scope: str) -> bytes:
    return hmac.new(
        settings.jwt_secret.encode(), purpose + user_id.bytes + scope.encode(), hashlib.sha256
    ).digest()


# The join order is mirrored by frontend lib/notifications.ts unsubscribeTokenKind; change both.
def sign(purpose: bytes, user_id: uuid.UUID, scope: str = "") -> str:
    sig = base64.urlsafe_b64encode(_signature(purpose, user_id, scope)).rstrip(b"=").decode()
    return ".".join([user_id.hex, *([scope] if scope else []), sig])


def verify(purpose: bytes, token: str) -> tuple[uuid.UUID, str]:
    """The account and scope ``token`` names, or ``InvalidUnsubscribeTokenError``."""
    parts = token.split(".")
    if len(parts) not in (2, 3) or (len(parts) == 3 and not parts[1]):
        raise InvalidUnsubscribeTokenError("This unsubscribe link is not valid.")
    head, scope, sig = parts[0], parts[1] if len(parts) == 3 else "", parts[-1]
    try:
        user_id = uuid.UUID(hex=head)
        given = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4))
    except (ValueError, binascii.Error):
        raise InvalidUnsubscribeTokenError("This unsubscribe link is not valid.") from None
    if not hmac.compare_digest(given, _signature(purpose, user_id, scope)):
        raise InvalidUnsubscribeTokenError("This unsubscribe link is not valid.")
    return user_id, scope
