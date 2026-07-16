"""Unit tests for the paid X API client — mentions read + reply write.

Everything runs through ``httpx.MockTransport``; no network, no credentials.
The OAuth 1.0a signature is pinned against the worked example in X's
"Creating a signature" developer doc, so the signer can't drift silently.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.x_api import (
    Mention,
    XApiError,
    fetch_mentions,
    oauth1_signature,
    post_reply,
)


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


# ── fetch_mentions ─────────────────────────────────────────────────────────


def test_fetch_mentions_maps_authors_and_sorts_oldest_first():
    payload = {
        "data": [
            {"id": "300", "author_id": "u2", "text": "@bot late"},
            {"id": "100", "author_id": "u1", "text": "@bot early"},
        ],
        "includes": {
            "users": [{"id": "u1", "username": "Alpha"}, {"id": "u2", "username": "bravo"}]
        },
        "meta": {},
    }
    with _client(lambda _req: httpx.Response(200, json=payload)) as client:
        mentions = fetch_mentions(user_id="42", bearer_token="tok", client=client)
    assert mentions == [
        Mention(tweet_id="100", author_id="u1", author_handle="alpha", text="@bot early"),
        Mention(tweet_id="300", author_id="u2", author_handle="bravo", text="@bot late"),
    ]


def test_fetch_mentions_passes_since_id_and_paginates():
    seen_params: list[dict[str, str]] = []
    pages = [
        {
            "data": [{"id": "200", "author_id": "u1", "text": "second"}],
            "includes": {"users": [{"id": "u1", "username": "alpha"}]},
            "meta": {"next_token": "page2"},
        },
        {
            "data": [{"id": "150", "author_id": "u1", "text": "first"}],
            "includes": {"users": [{"id": "u1", "username": "alpha"}]},
            "meta": {},
        },
    ]

    def handler(req: httpx.Request) -> httpx.Response:
        seen_params.append(dict(req.url.params))
        return httpx.Response(200, json=pages[len(seen_params) - 1])

    with _client(handler) as client:
        mentions = fetch_mentions(user_id="42", bearer_token="tok", since_id="99", client=client)
    assert [m.tweet_id for m in mentions] == ["150", "200"]
    assert seen_params[0]["since_id"] == "99"
    assert "pagination_token" not in seen_params[0]
    assert seen_params[1]["pagination_token"] == "page2"


def test_fetch_mentions_sends_bearer_and_surfaces_errors():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["Authorization"] == "Bearer tok"
        return httpx.Response(429, text="rate limited")

    with _client(handler) as client, pytest.raises(XApiError):
        fetch_mentions(user_id="42", bearer_token="tok", client=client)


def test_fetch_mentions_empty_timeline():
    with _client(lambda _req: httpx.Response(200, json={"meta": {}})) as client:
        assert fetch_mentions(user_id="42", bearer_token="tok", client=client) == []


# ── OAuth 1.0a signing ─────────────────────────────────────────────────────


def test_oauth1_signature_matches_x_docs_worked_example():
    # The full worked example from X's "Creating a signature" developer doc:
    # given these exact params and secrets, the doc's expected signature is
    # hCtSmYh+iHYCEqBWrE7C7hYmtUk= — byte-for-byte.
    params = {
        "status": "Hello Ladies + Gentlemen, a signed OAuth request!",
        "include_entities": "true",
        "oauth_consumer_key": "xvz1evFS4wEEPTGEFPHBog",
        "oauth_nonce": "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": "1318622958",
        "oauth_token": "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        "oauth_version": "1.0",
    }
    signature = oauth1_signature(
        "POST",
        "https://api.twitter.com/1.1/statuses/update.json",
        params,
        consumer_secret="kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        token_secret="LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    )
    assert signature == "hCtSmYh+iHYCEqBWrE7C7hYmtUk="


# ── post_reply ─────────────────────────────────────────────────────────────


def _reply_kwargs() -> dict[str, str]:
    return {
        "consumer_key": "ck",
        "consumer_secret": "cs",
        "access_token": "at",
        "access_token_secret": "ats",
    }


def test_post_reply_sends_oauth_header_and_returns_id():
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["auth"] = req.headers["Authorization"]
        captured["payload"] = json.loads(req.content)
        return httpx.Response(201, json={"data": {"id": "888"}})

    with _client(handler) as client:
        reply_id = post_reply(
            text="Vidit: saved",
            in_reply_to_tweet_id="123",
            client=client,
            **_reply_kwargs(),
        )
    assert reply_id == "888"
    auth = captured["auth"]
    assert isinstance(auth, str) and auth.startswith("OAuth ")
    assert 'oauth_consumer_key="ck"' in auth
    assert "oauth_signature=" in auth
    assert captured["payload"] == {
        "text": "Vidit: saved",
        "reply": {"in_reply_to_tweet_id": "123"},
    }


def test_post_reply_surfaces_api_error():
    with (
        _client(lambda _req: httpx.Response(403, text="nope")) as client,
        pytest.raises(XApiError),
    ):
        post_reply(text="x", in_reply_to_tweet_id="1", client=client, **_reply_kwargs())
