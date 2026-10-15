"""Web Push: the devices an analyst registers, and the send to each of them.

``pywebpush`` encrypts the payload for each subscription and signs the request
with the VAPID key, so the push service relays a body it cannot read. An
endpoint is a bearer URL: no log line, error report or API response carries
one, and a failure is logged by subscription id and status only.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from functools import cache

import requests
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid, Vapid02
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException, webpush
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.notification import DeliveryOutcome
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.schemas.push import PushSubscriptionCreate

logger = logging.getLogger(__name__)

# A notification older than a day is old news; the push service drops it
# rather than wake a device that was offline that long.
PUSH_TTL_SECONDS = 24 * 60 * 60
PUSH_TIMEOUT_SECONDS = 10.0

# The answers by which a push service says the subscription is gone for good.
_GONE_STATUSES = frozenset({404, 410})

# Which device outcome names the row when the devices disagree.
_ROW_OUTCOME_ORDER: tuple[DeliveryOutcome, ...] = ("sent", "unknown", "refused")


@dataclass(frozen=True)
class PushMessage:
    """What the service worker shows: a title, a short body, and the app path a
    click opens."""

    title: str
    body: str
    path: str


@cache
def _vapid_for(private_key: str) -> Vapid02:
    return Vapid.from_string(private_key=private_key)


def _vapid() -> Vapid02 | None:
    if not settings.vapid_private_key:
        return None
    return _vapid_for(settings.vapid_private_key)


def public_key() -> str | None:
    """The application server key browsers subscribe with, or None when push is
    off on this deployment. It derives from the private key, so the two cannot
    disagree."""
    vapid = _vapid()
    if vapid is None:
        return None
    raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return b64urlencode(raw)


def register(
    db: Session, *, user: User, body: PushSubscriptionCreate, user_agent: str | None
) -> PushSubscription:
    """Store this device for ``user``. The caller commits.

    Registering a known endpoint again refreshes its keys, and moves it to
    ``user`` when the browser signed in to another account.
    """
    values = {
        "user_id": user.id,
        "p256dh": body.keys.p256dh,
        "auth": body.keys.auth,
        "user_agent": user_agent[:512] if user_agent else None,
    }
    stmt = (
        insert(PushSubscription)
        .values(id=uuid.uuid4(), endpoint=body.endpoint, created_at=datetime.now(UTC), **values)
        .on_conflict_do_update(constraint="uq_push_subscriptions_endpoint", set_=values)
        .returning(PushSubscription.id)
    )
    subscription_id = db.execute(stmt).scalar_one()
    return (
        db.query(PushSubscription)
        .filter(PushSubscription.id == subscription_id)
        .populate_existing()
        .one()
    )


def unregister(db: Session, *, user: User, subscription_id: uuid.UUID) -> bool:
    """Drop one of ``user``'s devices; False when ``user`` has no such device.
    The caller commits."""
    deleted = (
        db.query(PushSubscription)
        .filter(PushSubscription.id == subscription_id, PushSubscription.user_id == user.id)
        .delete(synchronize_session=False)
    )
    return deleted > 0


def has_device(db: Session, *, user_id: uuid.UUID) -> bool:
    return (
        db.query(PushSubscription.id).filter(PushSubscription.user_id == user_id).first()
        is not None
    )


def _send_one(sub: PushSubscription, payload: str, vapid: Vapid02) -> DeliveryOutcome | None:
    """One device's outcome; None when the push service says it is gone."""
    try:
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=payload,
            vapid_private_key=vapid,
            # A fresh dict per call: ``webpush`` writes the endpoint's origin
            # into it as the token audience.
            vapid_claims={"sub": settings.vapid_subject},
            ttl=PUSH_TTL_SECONDS,
            timeout=PUSH_TIMEOUT_SECONDS,
        )
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in _GONE_STATUSES:
            return None
        logger.warning("push to subscription %s refused with status %s", sub.id, status)
        return "refused"
    except requests.RequestException as exc:
        # The request may have reached the push service: never resend it.
        logger.warning("push to subscription %s outcome unknown: %s", sub.id, type(exc).__name__)
        return "unknown"
    except Exception as exc:
        # Raised before any request left (a key that does not decode, say).
        logger.warning("push to subscription %s not sent: %s", sub.id, type(exc).__name__)
        return "refused"
    return "sent"


def send(db: Session, *, user_id: uuid.UUID, message: PushMessage) -> DeliveryOutcome:
    """Push ``message`` to every device of ``user_id``. The caller commits.

    A device the push service reports gone is deleted. The row outcome is
    ``sent`` when any device took it, else ``unknown`` when any may have, else
    ``refused`` when any refused, else ``skipped`` (push is off here, or no
    device is left). A refused row is retried, so it never repeats a push a
    device already shows.
    """
    vapid = _vapid()
    if vapid is None:
        return "skipped"
    subscriptions = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    payload = json.dumps(asdict(message))
    outcomes: set[DeliveryOutcome] = set()
    for sub in subscriptions:
        outcome = _send_one(sub, payload, vapid)
        if outcome is None:
            db.delete(sub)
            continue
        if outcome == "sent":
            sub.last_success_at = datetime.now(UTC)
        outcomes.add(outcome)
    return next((o for o in _ROW_OUTCOME_ORDER if o in outcomes), "skipped")
