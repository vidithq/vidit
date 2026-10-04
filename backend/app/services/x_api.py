"""Paid X API v2 client: the bot's mentions read and reply write.

Only the bot pipeline (``services/bot``) uses it; everything else reads X
through the free ``tweet_ingest.syndication`` path. Two calls, no SDK, because
each is billed per resource:

* ``GET /2/users/:id/mentions``: billed per post read. ``since_id`` keeps runs
  incremental.
* ``POST /2/tweets``: billed per reply, ~13x more when the text carries a URL.
  The reply composer must never include a URL or auto-linkable domain.

Reads use the app-only bearer token. Posting uses OAuth 1.0a user context
(static credentials, no refresh flow).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

_API_BASE = "https://api.x.com/2"
_HTTP_TIMEOUT_S = 15.0
_USER_AGENT = "vidit-bot/1.0"
# The page cap stops a runaway backlog from looping a paid call. The timeline
# pages newest-first, so past the cap the OLDEST mentions are dropped for good
# once the caller's ``since_id`` advances (needs 1000+ new mentions; logged).
_MENTIONS_PAGE_SIZE = 100
_MENTIONS_MAX_PAGES = 10


class XApiError(RuntimeError):
    """The paid X API call failed: transport, auth, or unexpected schema."""


@dataclass(frozen=True)
class Mention:
    """One tweet mentioning the bot, as read from the timeline or the webhook."""

    tweet_id: str
    author_id: str
    author_handle: str  # normalized: lowercase, no leading @
    text: str
    # Loop guard: a tag on the bot's own reply must not earn another reply.
    in_reply_to_user_id: str | None = None
    # Read by ``bot._tag_is_inherited``: X inserts inherited mentions into
    # replies. ``None`` means not a reply, so every mention is typed.
    in_reply_to_status_id: str | None = None


def _json_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    params: dict[str, str] | None = None,
    json_body: dict[str, object] | None = None,
    ok_statuses: tuple[int, ...],
    client: httpx.Client | None,
) -> dict[str, object]:
    """Run one X API call and return its JSON object body.

    Reuses the caller's ``httpx.Client`` (tests inject a mock transport) and
    folds every failure into :class:`XApiError` so no httpx type leaks.
    """
    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own_client:
                resp = own_client.request(
                    method, url, params=params, json=json_body, headers=headers
                )
        else:
            resp = client.request(method, url, params=params, json=json_body, headers=headers)
    except httpx.HTTPError as exc:
        raise XApiError(f"transport error: {exc}") from exc
    if resp.status_code not in ok_statuses:
        raise XApiError(f"upstream returned {resp.status_code}: {resp.text[:200]}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise XApiError(f"unparseable upstream body: {exc}") from exc
    if not isinstance(body, dict):
        raise XApiError("upstream returned non-object body")
    return body


def _get(
    url: str,
    *,
    params: dict[str, str],
    bearer_token: str,
    client: httpx.Client | None,
) -> dict[str, object]:
    """GET under the app-only bearer token (the billed read side)."""
    return _json_request(
        "GET",
        url,
        headers={
            "Authorization": f"Bearer {bearer_token}",
            "User-Agent": _USER_AGENT,
        },
        params=params,
        ok_statuses=(200,),
        client=client,
    )


def _replied_to_id(tweet: dict[str, object]) -> str | None:
    """The id of the post ``tweet`` replies to, or ``None``.

    Only the ``replied_to`` entry of ``referenced_tweets`` is the parent
    (``quoted`` and ``retweeted`` share the list).
    """
    referenced = tweet.get("referenced_tweets")
    if not isinstance(referenced, list):
        return None
    for reference in referenced:
        if not isinstance(reference, dict) or reference.get("type") != "replied_to":
            continue
        parent_id = reference.get("id")
        if isinstance(parent_id, str) and parent_id:
            return parent_id
    return None


def fetch_mentions(
    *,
    user_id: str,
    bearer_token: str,
    since_id: str | None = None,
    client: httpx.Client | None = None,
) -> list[Mention]:
    """Every mention of the bot account newer than ``since_id``, oldest first.

    Paginates up to ``_MENTIONS_MAX_PAGES``. ``expansions=author_id`` avoids a
    billed user lookup. Oldest-first lets the caller advance its cursor safely
    after a mid-batch failure.
    """
    url = f"{_API_BASE}/users/{user_id}/mentions"
    mentions: list[Mention] = []
    pagination_token: str | None = None
    for _ in range(_MENTIONS_MAX_PAGES):
        params: dict[str, str] = {
            "max_results": str(_MENTIONS_PAGE_SIZE),
            "expansions": "author_id",
            "user.fields": "username",
            "tweet.fields": "in_reply_to_user_id,referenced_tweets",
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
                # A dropped mention leaves no ledger trace, so log schema
                # surprises. Non-numeric ids would break the sort and cursor cast.
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
                        in_reply_to_status_id=_replied_to_id(tweet),
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


# OAuth 1.0a (HMAC-SHA1): the reply write's user context.


@dataclass(frozen=True)
class OAuth1Credentials:
    """The bot account's OAuth 1.0a user context: four static credentials.

    ``repr`` prints none of them, so logging the object leaks nothing.
    """

    consumer_key: str = field(repr=False)
    consumer_secret: str = field(repr=False)
    access_token: str = field(repr=False)
    access_token_secret: str = field(repr=False)


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

    ``params`` is every oauth_* parameter plus query / form parameters. A JSON
    body is excluded by the spec, so the v2 reply write signs only oauth_*.
    """
    encoded = sorted((_percent_encode(k), _percent_encode(v)) for k, v in params.items())
    param_string = "&".join(f"{k}={v}" for k, v in encoded)
    base_string = "&".join((method.upper(), _percent_encode(url), _percent_encode(param_string)))
    signing_key = f"{_percent_encode(consumer_secret)}&{_percent_encode(token_secret)}"
    digest = hmac.new(
        signing_key.encode("ascii"), base_string.encode("ascii"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def _oauth1_header(method: str, url: str, credentials: OAuth1Credentials) -> str:
    oauth_params = {
        "oauth_consumer_key": credentials.consumer_key,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": credentials.access_token,
        "oauth_version": "1.0",
    }
    oauth_params["oauth_signature"] = oauth1_signature(
        method,
        url,
        oauth_params,
        consumer_secret=credentials.consumer_secret,
        token_secret=credentials.access_token_secret,
    )
    header_params = ", ".join(
        f'{_percent_encode(k)}="{_percent_encode(v)}"' for k, v in sorted(oauth_params.items())
    )
    return f"OAuth {header_params}"


def _post_user_context(
    url: str,
    payload: dict[str, object],
    *,
    credentials: OAuth1Credentials,
    client: httpx.Client | None,
) -> dict[str, object]:
    """POST ``payload`` as JSON under OAuth 1.0a user context (RFC 5849: body unsigned)."""
    return _json_request(
        "POST",
        url,
        headers={
            "Authorization": _oauth1_header("POST", url, credentials),
            "User-Agent": _USER_AGENT,
        },
        json_body=payload,
        ok_statuses=(200, 201),
        client=client,
    )


def post_reply(
    *,
    text: str,
    in_reply_to_tweet_id: str,
    credentials: OAuth1Credentials,
    client: httpx.Client | None = None,
) -> str:
    """Post ``text`` as a reply to ``in_reply_to_tweet_id``; return the new tweet's id.

    The caller owns the linkless-text invariant (see module docstring).
    """
    body = _post_user_context(
        f"{_API_BASE}/tweets",
        {"text": text, "reply": {"in_reply_to_tweet_id": in_reply_to_tweet_id}},
        credentials=credentials,
        client=client,
    )
    data = body.get("data")
    tweet_id = data.get("id") if isinstance(data, dict) else None
    if not isinstance(tweet_id, str):
        raise XApiError("reply created but no tweet id in response")
    return tweet_id
