"""Paid X API v2 client: the bot's mentions read and reply write.

The only consumer is the bot pipeline (``services/bot``): everything else on
the platform reads X through the free syndication path
(``tweet_ingest.syndication``). Kept deliberately minimal (two calls, no
SDK) because every call is billed per resource on X's pay-per-use plan:

* ``GET /2/users/:id/mentions`` — $ per post read. Incremental via
  ``since_id`` so a run only pays for mentions it has never seen.
* ``POST /2/tweets`` — $ per reply, and ~13x the price when the text carries
  a URL (X bills link posts higher). The reply composer must therefore never
  include a URL or auto-linkable domain; the clickable link lives in the bot
  bio.

Reading mentions works app-only (bearer token). Posting requires user
context, wired as OAuth 1.0a signing (consumer key/secret + the bot
account's access token/secret) — static credentials, no refresh flow.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

_API_BASE = "https://api.x.com/2"
_HTTP_TIMEOUT_S = 15.0
_USER_AGENT = "vidit-bot/1.0"
# One mentions pull is bounded: 100 mentions per page, pages capped so a
# runaway backlog (or an API pagination bug) can't loop a paid call forever.
# The timeline pages newest-first, so a backlog past the cap drops its OLDEST
# overflow — and once this pass records the newest mentions, the caller's
# ``since_id`` advances past the dropped ones for good. Needs 1000+ new
# mentions in one pass; logged below when it happens.
_MENTIONS_PAGE_SIZE = 100
_MENTIONS_MAX_PAGES = 10


class XApiError(RuntimeError):
    """The paid X API call failed — transport, auth, or unexpected schema."""


@dataclass(frozen=True)
class Mention:
    """One tweet mentioning the bot: the shared shape both the mentions
    timeline (poll) and the Account Activity webhook payload reduce to."""

    tweet_id: str
    author_id: str
    author_handle: str  # normalized: lowercase, no leading @
    text: str
    # Who the tagged tweet replies to, when it is a reply. The failure-reply
    # loop guard reads it: a tag on the bot's own reply must not earn another
    # reply.
    in_reply_to_user_id: str | None = None


def _get(
    url: str,
    *,
    params: dict[str, str],
    bearer_token: str,
    client: httpx.Client | None,
) -> dict[str, object]:
    headers = {
        "Authorization": f"Bearer {bearer_token}",
        "User-Agent": _USER_AGENT,
    }
    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own_client:
                resp = own_client.get(url, params=params, headers=headers)
        else:
            resp = client.get(url, params=params, headers=headers)
    except httpx.HTTPError as exc:
        raise XApiError(f"transport error: {exc}") from exc
    if resp.status_code != 200:
        raise XApiError(f"upstream returned {resp.status_code}: {resp.text[:200]}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise XApiError(f"unparseable upstream body: {exc}") from exc
    if not isinstance(body, dict):
        raise XApiError("upstream returned non-object body")
    return body


def fetch_mentions(
    *,
    user_id: str,
    bearer_token: str,
    since_id: str | None = None,
    client: httpx.Client | None = None,
) -> list[Mention]:
    """Every mention of the bot account newer than ``since_id``, oldest first.

    Paginates until the API stops returning a ``next_token`` (capped at
    ``_MENTIONS_MAX_PAGES``). ``expansions=author_id`` resolves each mention's
    author handle in the same call, so no extra (billed) user lookup is
    needed. Oldest-first ordering lets the caller advance its cursor safely: a
    failure mid-batch never leaves a newer mention processed before an older
    one was recorded.
    """
    url = f"{_API_BASE}/users/{user_id}/mentions"
    mentions: list[Mention] = []
    pagination_token: str | None = None
    for _ in range(_MENTIONS_MAX_PAGES):
        params: dict[str, str] = {
            "max_results": str(_MENTIONS_PAGE_SIZE),
            "expansions": "author_id",
            "user.fields": "username",
            "tweet.fields": "in_reply_to_user_id",
        }
        if since_id is not None:
            params["since_id"] = since_id
        if pagination_token is not None:
            params["pagination_token"] = pagination_token
        body = _get(url, params=params, bearer_token=bearer_token, client=client)

        data = body.get("data")
        includes = body.get("includes")
        users = includes.get("users") if isinstance(includes, dict) else None
        handle_by_id: dict[str, str] = {}
        if isinstance(users, list):
            for user in users:
                if not isinstance(user, dict):
                    continue
                uid, username = user.get("id"), user.get("username")
                if isinstance(uid, str) and isinstance(username, str):
                    handle_by_id[uid] = username.lower()
        if isinstance(data, list):
            for tweet in data:
                if not isinstance(tweet, dict):
                    continue
                tweet_id = tweet.get("id")
                author_id = tweet.get("author_id")
                text = tweet.get("text")
                # A dropped mention leaves no ledger trace and the caller's
                # cursor will pass it, so schema surprises are logged loudly
                # rather than lost silently. Non-numeric ids would also break
                # the sort below and the caller's cursor cast.
                if (
                    not isinstance(tweet_id, str)
                    or not tweet_id.isdigit()
                    or not isinstance(author_id, str)
                ):
                    logger.warning("Dropping malformed mention entry: %r", tweet)
                    continue
                handle = handle_by_id.get(author_id)
                if handle is None:
                    logger.warning(
                        "Dropping mention %s: author %s missing from includes",
                        tweet_id,
                        author_id,
                    )
                    continue
                reply_to = tweet.get("in_reply_to_user_id")
                mentions.append(
                    Mention(
                        tweet_id=tweet_id,
                        author_id=author_id,
                        author_handle=handle,
                        text=text if isinstance(text, str) else "",
                        in_reply_to_user_id=reply_to if isinstance(reply_to, str) else None,
                    )
                )
        meta = body.get("meta")
        next_token = meta.get("next_token") if isinstance(meta, dict) else None
        if not isinstance(next_token, str) or not next_token:
            break
        pagination_token = next_token
    else:
        logger.warning(
            "Mentions backlog exceeded %d pages; oldest overflow will be lost "
            "once the cursor advances",
            _MENTIONS_MAX_PAGES,
        )

    mentions.sort(key=lambda m: int(m.tweet_id))
    return mentions


# ── OAuth 1.0a (HMAC-SHA1) — the reply write's user context ───────────────


def _percent_encode(value: str) -> str:
    # RFC 5849 §3.6: percent-encode everything but the RFC 3986 unreserved set.
    return quote(value, safe="-._~")


def oauth1_signature(
    method: str,
    url: str,
    params: dict[str, str],
    *,
    consumer_secret: str,
    token_secret: str,
) -> str:
    """RFC 5849 HMAC-SHA1 signature over ``method``, ``url`` and ``params``.

    ``params`` is every oauth_* protocol parameter plus any query / form
    parameters (a JSON body is excluded from the base string by the spec,
    which is why the v2 reply write signs only its oauth_* params).
    """
    encoded = sorted((_percent_encode(k), _percent_encode(v)) for k, v in params.items())
    param_string = "&".join(f"{k}={v}" for k, v in encoded)
    base_string = "&".join((method.upper(), _percent_encode(url), _percent_encode(param_string)))
    signing_key = f"{_percent_encode(consumer_secret)}&{_percent_encode(token_secret)}"
    digest = hmac.new(
        signing_key.encode("ascii"), base_string.encode("ascii"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def _oauth1_header(
    method: str,
    url: str,
    *,
    consumer_key: str,
    consumer_secret: str,
    token: str,
    token_secret: str,
) -> str:
    oauth_params = {
        "oauth_consumer_key": consumer_key,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": token,
        "oauth_version": "1.0",
    }
    oauth_params["oauth_signature"] = oauth1_signature(
        method,
        url,
        oauth_params,
        consumer_secret=consumer_secret,
        token_secret=token_secret,
    )
    header_params = ", ".join(
        f'{_percent_encode(k)}="{_percent_encode(v)}"' for k, v in sorted(oauth_params.items())
    )
    return f"OAuth {header_params}"


def _post_user_context(
    url: str,
    payload: dict[str, object],
    *,
    consumer_key: str,
    consumer_secret: str,
    access_token: str,
    access_token_secret: str,
    client: httpx.Client | None,
) -> dict[str, object]:
    """POST ``payload`` as JSON under OAuth 1.0a user context; return the
    parsed body. A JSON body stays out of the signature base string (RFC
    5849), so only the oauth_* params are signed."""
    headers = {
        "Authorization": _oauth1_header(
            "POST",
            url,
            consumer_key=consumer_key,
            consumer_secret=consumer_secret,
            token=access_token,
            token_secret=access_token_secret,
        ),
        "User-Agent": _USER_AGENT,
    }
    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own_client:
                resp = own_client.post(url, json=payload, headers=headers)
        else:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise XApiError(f"transport error: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise XApiError(f"upstream returned {resp.status_code}: {resp.text[:200]}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise XApiError(f"unparseable upstream body: {exc}") from exc
    if not isinstance(body, dict):
        raise XApiError("upstream returned non-object body")
    return body


def post_reply(
    *,
    text: str,
    in_reply_to_tweet_id: str,
    consumer_key: str,
    consumer_secret: str,
    access_token: str,
    access_token_secret: str,
    client: httpx.Client | None = None,
) -> str:
    """Post ``text`` as a reply to ``in_reply_to_tweet_id``; return the new
    tweet's id.

    The caller owns the linkless-text invariant (see module docstring); this
    function posts what it is given.
    """
    body = _post_user_context(
        f"{_API_BASE}/tweets",
        {"text": text, "reply": {"in_reply_to_tweet_id": in_reply_to_tweet_id}},
        consumer_key=consumer_key,
        consumer_secret=consumer_secret,
        access_token=access_token,
        access_token_secret=access_token_secret,
        client=client,
    )
    data = body.get("data")
    tweet_id = data.get("id") if isinstance(data, dict) else None
    if not isinstance(tweet_id, str):
        raise XApiError("reply created but no tweet id in response")
    return tweet_id
