import base64
import binascii
import uuid
from datetime import datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The browser push services. The worker POSTs to a registered endpoint, so an
# endpoint on any other host would let an analyst aim server requests at it.
PUSH_SERVICE_HOSTS = frozenset(
    {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
)
PUSH_SERVICE_HOST_SUFFIXES = (".notify.windows.com", ".push.apple.com")


def _b64url_bytes(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("must be base64url") from exc


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(max_length=128)
    auth: str = Field(max_length=64)

    @field_validator("p256dh")
    @classmethod
    def _p256dh_is_a_p256_point(cls, value: str) -> str:
        raw = _b64url_bytes(value)
        if len(raw) != 65 or raw[0] != 0x04:
            raise ValueError("must be an uncompressed P-256 public key")
        return value

    @field_validator("auth")
    @classmethod
    def _auth_is_16_bytes(cls, value: str) -> str:
        if len(_b64url_bytes(value)) != 16:
            raise ValueError("must be a 16-byte secret")
        return value


class PushSubscriptionCreate(BaseModel):
    """Body for ``POST /users/me/push-subscriptions``: the browser's
    ``PushSubscription.toJSON()``. Its ``expirationTime`` is ignored. ``resync``
    marks a registration the page makes by itself, which a revoked device
    cannot pass; enabling push leaves it false."""

    endpoint: str = Field(max_length=2048)
    keys: PushSubscriptionKeys
    resync: bool = False

    @field_validator("endpoint")
    @classmethod
    def _endpoint_is_a_push_service(cls, value: str) -> str:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower()
        if (
            parts.scheme != "https"
            or parts.port is not None
            or parts.username is not None
            or not (host in PUSH_SERVICE_HOSTS or host.endswith(PUSH_SERVICE_HOST_SUFFIXES))
        ):
            raise ValueError("must be an https URL on a browser push service")
        return value


class PushSubscriptionRead(BaseModel):
    """One registered device. The endpoint is a bearer secret and is never
    returned."""

    id: uuid.UUID
    user_agent: str | None
    created_at: datetime
    last_success_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class PushConfigRead(BaseModel):
    """``public_key`` is the VAPID application server key, null when this
    deployment does not send push."""

    public_key: str | None
