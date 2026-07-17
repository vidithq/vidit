"""The X Account Activity webhook: the bot's nominal mention delivery.

Unauthenticated by design: X calls it, and the HMAC signature over the raw
body (the app's consumer secret, which only X and this deployment hold) is
the gate. The CRC responder signs with the same secret and the same
construction, so it would be a signing oracle for forged webhook bodies if
it signed arbitrary input; the ``crc_token`` charset gate below is what
closes that (a JSON body can never fit the allowed charset). No rate
limiter on top: the signature rejection is one HMAC over the body, cheaper
than any limiter bookkeeping, and a 401 costs the caller a full request
either way.

The POST does no pipeline work: it verifies, reduces the payload to the
internal ``Mention`` shape, inserts ``bot_webhook_events`` rows, and answers
200. The import worker drains the queue (``services/bot``). X retries or
falls back on slow answers, so the request path must stay allocation-cheap
and DB-light (one insert batch, one commit).
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

# X's CRC tokens are short URL-safe strings. The gate matters because the CRC
# answer is HMAC(consumer_secret, crc_token), the exact construction the POST
# verifier checks over the raw body: signing arbitrary input would let anyone
# obtain a valid signature for a forged webhook body. A JSON body always
# contains ``{`` and ``"``, so this charset can never be coerced into one.
_CRC_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,200}$")

# An Account Activity delivery is small (a bounded batch of tweet objects);
# a few hundred KB is generous. Checked against Content-Length before the
# body is read, so an oversized delivery never gets buffered pre-auth.
_MAX_BODY_BYTES = 512 * 1024

# Belt-and-suspenders bound on the per-delivery batch: X batches far fewer
# events per delivery; anything past the cap is dropped, not queued.
_MAX_EVENTS_PER_DELIVERY = 100


def _sign(secret: str, payload: bytes) -> str:
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    return _SIGNATURE_PREFIX + base64.b64encode(digest).decode("ascii")


@router.get("/x")
def crc_challenge(crc_token: str) -> dict[str, str]:
    """Answer X's Challenge-Response Check.

    X sends one at registration and then hourly; a wrong or slow answer
    deactivates the webhook. Pure HMAC over the token, no DB, so the answer
    is immediate. Tokens outside X's URL-safe shape are rejected: see
    ``_CRC_TOKEN_RE`` for why signing arbitrary input would be an oracle.
    """
    if not settings.x_api_consumer_secret:
        raise HTTPException(status_code=503, detail="X webhook credentials not configured")
    if not _CRC_TOKEN_RE.fullmatch(crc_token):
        raise HTTPException(status_code=400, detail="Malformed crc_token")
    return {"response_token": _sign(settings.x_api_consumer_secret, crc_token.encode())}


def _event_to_mention(event: object) -> Mention | None:
    """Reduce one ``tweet_create_events`` entry to the internal shape.

    Drops the bot's own posts and anything that doesn't actually mention the
    bot (the account's subscription also delivers its timeline activity; the
    poll's equivalent filter is reading the mentions timeline, so here the
    ``entities.user_mentions`` ids carry the decision). Legacy AAA quirk:
    on a truncated tweet the full text lives under
    ``extended_tweet.full_text`` and the full entities (a tag past the
    truncation point included) under ``extended_tweet.entities``, so both
    prefer the extended form when present.
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
    return Mention(
        tweet_id=tweet_id,
        author_id=author_id,
        author_handle=author_handle.lower(),
        text=text if isinstance(text, str) else "",
        in_reply_to_user_id=reply_to if isinstance(reply_to, str) else None,
    )


@router.post("/x")
async def receive_account_activity(request: Request, db: Session = Depends(get_db)) -> dict:
    """Verify, queue, answer. Anything valid-but-irrelevant (another
    ``for_user_id``, non-mention events, retweets of the bot) still gets a
    200: a non-2xx makes X retry and eventually deactivate the webhook."""
    if not settings.x_api_consumer_secret or not settings.x_bot_user_id:
        # An empty x_bot_user_id would silently drop every event below (no
        # for_user_id ever matches ""); 503 like the missing secret so a
        # misconfigured deployment is loud, not a black hole.
        raise HTTPException(status_code=503, detail="X webhook credentials not configured")
    content_length = request.headers.get("content-length", "")
    if content_length.isdigit() and int(content_length) > _MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")
    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")
    provided = request.headers.get(_SIGNATURE_HEADER, "")
    expected = _sign(settings.x_api_consumer_secret, raw)
    # Compared as bytes: header values decode as latin-1, and a non-ASCII
    # value passed to compare_digest as str raises instead of mismatching.
    if not hmac.compare_digest(
        provided.encode("utf-8", "surrogateescape"), expected.encode("ascii")
    ):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        # Signed by the right secret yet unparseable: X never does this, so
        # log loudly and swallow (a 4xx would only trigger retries of the
        # same body).
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
    # The insert is sync SQLAlchemy: off the event loop, like the archive
    # enqueue in routers/events/import_archive.
    return {"queued": await run_in_threadpool(enqueue_webhook_mentions, db, mentions)}
