"""The X Account Activity webhook: the bot's nominal mention delivery.

Unauthenticated by design: the HMAC signature over the raw body (the consumer
secret, held only by X and this deployment) is the gate. The CRC responder
signs with the same construction, so it would be a signing oracle for forged
bodies if it signed arbitrary input; the ``crc_token`` charset gate closes
that (a JSON body never fits it). No rate limiter: a signature rejection is
one HMAC, cheaper than limiter bookkeeping.

The POST does no pipeline work: it verifies, reduces the payload to the
internal ``Mention`` shape, inserts ``bot_webhook_events`` rows and answers
200 (one insert batch, one commit, since X retries on slow answers). The
import worker drains the queue (``services/bot``).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.dependencies import get_db
from app.services.bot import enqueue_webhook_mentions
from app.services.x_api import Mention

logger = logging.getLogger(__name__)

router = APIRouter()

_SIGNATURE_HEADER = "x-twitter-webhooks-signature"
_SIGNATURE_PREFIX = "sha256="

# X's CRC tokens are short URL-safe strings. The CRC answer is
# HMAC(consumer_secret, crc_token), the same construction the POST verifier
# checks, so signing arbitrary input would hand out valid signatures for forged
# bodies. A JSON body always contains ``{`` and ``"``, which this charset rejects.
_CRC_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,200}$")

# Small by design (a bounded batch of tweet objects). Public because the
# body-size middleware (``app.main.enforce_request_body_size``) pins this cap
# on the webhook path, so an oversized delivery 413s pre-auth at this cap, not
# the larger upload ceiling.
MAX_BODY_BYTES = 512 * 1024

# Bound on the per-delivery batch; anything past it is dropped, not queued.
_MAX_EVENTS_PER_DELIVERY = 100


def _sign(secret: str, payload: bytes) -> str:
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    return _SIGNATURE_PREFIX + base64.b64encode(digest).decode("ascii")


@router.get("/x")
def crc_challenge(crc_token: str) -> dict[str, str]:
    """Answer X's Challenge-Response Check (registration, then hourly; a wrong
    or slow answer deactivates the webhook). Pure HMAC, no DB. Tokens outside
    X's URL-safe shape are rejected (see ``_CRC_TOKEN_RE``)."""
    if not settings.x_api_consumer_secret:
        raise HTTPException(status_code=503, detail="X webhook credentials not configured")
    if not _CRC_TOKEN_RE.fullmatch(crc_token):
        raise HTTPException(status_code=400, detail="Malformed crc_token")
    return {"response_token": _sign(settings.x_api_consumer_secret, crc_token.encode())}


def _event_to_mention(event: object) -> Mention | None:
    """Reduce one ``tweet_create_events`` entry to the internal shape.

    Drops the bot's own posts and anything not mentioning the bot (the
    subscription also delivers timeline activity), decided by
    ``entities.user_mentions`` ids. Legacy AAA quirk: a truncated tweet keeps
    its full text under ``extended_tweet.full_text`` and its full entities
    under ``extended_tweet.entities``, so both prefer the extended form.
    """
    if not isinstance(event, dict):
        return None
    tweet_id = event.get("id_str")
    user = event.get("user")
    if not isinstance(tweet_id, str) or not isinstance(user, dict):
        return None
    author_id = user.get("id_str")
    author_handle = user.get("screen_name")
    if not isinstance(author_id, str) or not isinstance(author_handle, str):
        return None
    if author_id == settings.x_bot_user_id:
        return None
    extended = event.get("extended_tweet")
    extended = extended if isinstance(extended, dict) else None
    entities = extended.get("entities") if extended is not None else None
    if not isinstance(entities, dict):
        entities = event.get("entities")
    user_mentions = entities.get("user_mentions") if isinstance(entities, dict) else None
    if not isinstance(user_mentions, list) or not any(
        isinstance(m, dict) and m.get("id_str") == settings.x_bot_user_id for m in user_mentions
    ):
        return None
    full_text = extended.get("full_text") if extended is not None else None
    text = full_text if isinstance(full_text, str) else event.get("text")
    reply_to = event.get("in_reply_to_user_id_str")
    reply_to_status = event.get("in_reply_to_status_id_str")
    return Mention(
        tweet_id=tweet_id,
        author_id=author_id,
        author_handle=author_handle.lower(),
        text=text if isinstance(text, str) else "",
        in_reply_to_user_id=reply_to if isinstance(reply_to, str) else None,
        in_reply_to_status_id=reply_to_status if isinstance(reply_to_status, str) else None,
    )


@router.post("/x")
async def receive_account_activity(request: Request, db: Session = Depends(get_db)) -> dict:
    """Verify, queue, answer. Valid-but-irrelevant deliveries still get a 200:
    a non-2xx makes X retry and eventually deactivate the webhook."""
    if not settings.x_api_consumer_secret or not settings.x_bot_user_id:
        # An empty x_bot_user_id would silently drop every event; 503 so a
        # misconfigured deployment is loud.
        raise HTTPException(status_code=503, detail="X webhook credentials not configured")
    # The body-size middleware already 413'd anything over ``MAX_BODY_BYTES``.
    raw = await request.body()
    provided = request.headers.get(_SIGNATURE_HEADER, "")
    expected = _sign(settings.x_api_consumer_secret, raw)
    # Compared as bytes: a non-ASCII str value makes compare_digest raise.
    if not hmac.compare_digest(
        provided.encode("utf-8", "surrogateescape"), expected.encode("ascii")
    ):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        # Signed yet unparseable: X never does this. Log and swallow (a 4xx
        # would only trigger retries of the same body).
        logger.warning("Unparseable signed webhook body (%d bytes)", len(raw))
        return {"queued": 0}
    if not isinstance(payload, dict) or payload.get("for_user_id") != settings.x_bot_user_id:
        return {"queued": 0}
    events = payload.get("tweet_create_events")
    if not isinstance(events, list):
        return {"queued": 0}
    if len(events) > _MAX_EVENTS_PER_DELIVERY:
        logger.warning(
            "Webhook delivery over batch cap: %d events, keeping %d",
            len(events),
            _MAX_EVENTS_PER_DELIVERY,
        )
        events = events[:_MAX_EVENTS_PER_DELIVERY]
    mentions = [m for m in (_event_to_mention(e) for e in events) if m is not None]
    if not mentions:
        return {"queued": 0}
    # Sync SQLAlchemy insert: off the event loop.
    return {"queued": await run_in_threadpool(enqueue_webhook_mentions, db, mentions)}
