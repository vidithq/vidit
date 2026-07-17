"""Tests for the X Account Activity webhook: CRC, signature, queue, drain.

Same house style as ``test_bot``: every X surface is mocked (syndication via
``MockTransport``, the write side captured), the DB and the queue + drain are
real. The endpoint tests drive the FastAPI app through ``TestClient``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.bot_mention import BotMention
from app.models.bot_webhook_event import BotWebhookEvent
from app.models.event import Event
from app.models.user import User
from app.services.bot import drain_webhook_events, run_bot_once
from app.services.tweet_ingest.syndication import _cache_clear

client = TestClient(app)

WEBHOOK_PATH = "/api/v1/webhooks/x"
BOT_USER_ID = "999000"
CONSUMER_SECRET = "test-consumer-secret"
HANDLE = f"owl{uuid.uuid4().hex[:8]}"

COORD_ID = "9400000000000000001"
BARE_ID = "9400000000000000002"

BODIES = {
    COORD_ID: {
        "id_str": COORD_ID,
        "created_at": "2026-07-18T10:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot archive 55.751200, 37.617600 near the bridge",
    },
    BARE_ID: {
        "id_str": BARE_ID,
        "created_at": "2026-07-18T11:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot nothing to see here",
    },
}


def _sign(body: bytes) -> str:
    digest = hmac.new(CONSUMER_SECRET.encode(), body, hashlib.sha256).digest()
    return "sha256=" + base64.b64encode(digest).decode("ascii")


def _tweet_create_event(
    tweet_id: str,
    *,
    author_id: str = "u1",
    handle: str = HANDLE,
    text: str | None = None,
    mentions_bot: bool = True,
    **extra: object,
) -> dict:
    return {
        "id_str": tweet_id,
        "user": {"id_str": author_id, "screen_name": handle},
        "text": text if text is not None else BODIES[tweet_id]["text"],
        "entities": {"user_mentions": [{"id_str": BOT_USER_ID if mentions_bot else "424242"}]},
        **extra,
    }


def _post_payload(payload: dict, signature: str | None = None) -> httpx.Response:
    body = json.dumps(payload).encode()
    return client.post(
        WEBHOOK_PATH,
        content=body,
        headers={
            "content-type": "application/json",
            "x-twitter-webhooks-signature": signature if signature is not None else _sign(body),
        },
    )


def _queued_mentions(db) -> list[dict]:
    rows = (
        db.query(BotWebhookEvent)
        .filter(BotWebhookEvent.status == "queued")
        .order_by(BotWebhookEvent.created_at)
        .all()
    )
    return [row.mention for row in rows]


def _syndication_client() -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        body = BODIES.get(req.url.params.get("id", ""))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _write_client(posted: list[dict[str, object]], liked: list[dict[str, object]]) -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/likes"):
            liked.append(json.loads(req.content))
            return httpx.Response(200, json={"data": {"liked": True}})
        posted.append(json.loads(req.content))
        return httpx.Response(201, json={"data": {"id": "888"}})

    return httpx.Client(transport=httpx.MockTransport(handler))


async def _drain(db):
    posted: list[dict[str, object]] = []
    liked: list[dict[str, object]] = []
    with _syndication_client() as syn, _write_client(posted, liked) as write:
        outcome = await drain_webhook_events(db, syndication_client=syn, x_write_client=write)
    return outcome, posted, liked


@pytest.fixture
def db():
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _webhook_settings(monkeypatch):
    _cache_clear()
    monkeypatch.setattr(settings, "x_bot_bearer_token", "tok")
    monkeypatch.setattr(settings, "x_bot_user_id", BOT_USER_ID)
    monkeypatch.setattr(settings, "x_api_consumer_key", "ck")
    monkeypatch.setattr(settings, "x_api_consumer_secret", CONSUMER_SECRET)
    monkeypatch.setattr(settings, "x_bot_access_token", "at")
    monkeypatch.setattr(settings, "x_bot_access_token_secret", "ats")


@pytest.fixture
def linked_owner(db):
    user = User(
        username=f"analyst{uuid.uuid4().hex[:8]}",
        email=f"analyst-{uuid.uuid4().hex}@example.com",
        password_hash="x",
        x_handle=HANDLE,
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture(autouse=True)
def _cleanup():
    from app.database import SessionLocal

    yield
    session = SessionLocal()
    try:
        session.query(BotWebhookEvent).delete(synchronize_session=False)
        session.query(BotMention).filter(BotMention.mention_tweet_id.in_(list(BODIES))).delete(
            synchronize_session=False
        )
        owner = session.query(User).filter(User.x_handle == HANDLE).first()
        if owner is not None:
            session.query(Event).filter(Event.owner_id == owner.id).delete(
                synchronize_session=False
            )
            session.query(User).filter(User.id == owner.id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


# ── CRC challenge ──────────────────────────────────────────────────────────


def test_crc_challenge_pinned_vector():
    # Known vector: HMAC-SHA256("test-consumer-secret", "test-crc-token"),
    # base64, sha256= prefix, pinned so the responder can't drift silently.
    resp = client.get(WEBHOOK_PATH, params={"crc_token": "test-crc-token"})
    assert resp.status_code == 200
    assert resp.json() == {"response_token": "sha256=1Fg22hsV/J0MPCeiX/iZqLqDkZ0S28yOOMIljrsAX9M="}


def test_crc_challenge_without_credentials_is_503(monkeypatch):
    monkeypatch.setattr(settings, "x_api_consumer_secret", "")
    resp = client.get(WEBHOOK_PATH, params={"crc_token": "x"})
    assert resp.status_code == 503


# ── Signature gate ─────────────────────────────────────────────────────────


def test_post_with_valid_signature_queues(db, monkeypatch):
    resp = _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )
    assert resp.status_code == 200
    assert resp.json() == {"queued": 1}
    (mention,) = _queued_mentions(db)
    assert mention["tweet_id"] == COORD_ID
    assert mention["author_handle"] == HANDLE


def test_post_with_bad_signature_is_401_and_queues_nothing(db):
    body = {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    resp = _post_payload(body, signature="sha256=" + base64.b64encode(b"0" * 32).decode())
    assert resp.status_code == 401
    assert _queued_mentions(db) == []


def test_post_with_missing_signature_is_401(db):
    body = json.dumps({"for_user_id": BOT_USER_ID}).encode()
    resp = client.post(WEBHOOK_PATH, content=body, headers={"content-type": "application/json"})
    assert resp.status_code == 401


# ── Payload parsing ────────────────────────────────────────────────────────


def test_extended_tweet_full_text_wins_over_truncated_text(db):
    event = _tweet_create_event(
        COORD_ID,
        text="@viditbot archive 55.751200, 37.6…",
        truncated=True,
        extended_tweet={"full_text": BODIES[COORD_ID]["text"]},
    )
    resp = _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    assert resp.json() == {"queued": 1}
    (mention,) = _queued_mentions(db)
    assert mention["text"] == BODIES[COORD_ID]["text"]


def test_foreign_for_user_id_is_ignored_with_200(db):
    resp = _post_payload(
        {"for_user_id": "someone-else", "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )
    assert resp.status_code == 200
    assert resp.json() == {"queued": 0}
    assert _queued_mentions(db) == []


def test_bot_authored_event_is_skipped(db):
    event = _tweet_create_event(COORD_ID, author_id=BOT_USER_ID, handle="viditbot")
    resp = _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    assert resp.json() == {"queued": 0}


def test_non_mention_event_is_skipped(db):
    # The subscription also delivers the account's timeline activity; only
    # events whose entities carry the bot's user id are mentions.
    event = _tweet_create_event(COORD_ID, mentions_bot=False)
    resp = _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    assert resp.json() == {"queued": 0}


def test_reply_carries_in_reply_to_user_id(db):
    event = _tweet_create_event(BARE_ID, in_reply_to_user_id_str=BOT_USER_ID)
    _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    (mention,) = _queued_mentions(db)
    assert mention["in_reply_to_user_id"] == BOT_USER_ID


# ── Queue drain through the shared pipeline ────────────────────────────────


async def test_drain_creates_draft_likes_and_replies(db, linked_owner):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )

    outcome, posted, liked = await _drain(db)

    assert outcome.events_created == 1
    assert liked == [{"tweet_id": COORD_ID}]  # the like HTTP call went out
    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": COORD_ID}
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == COORD_ID).one()
    assert ledger.outcome == "created"
    assert ledger.reply_tweet_id == "888"
    row = db.query(BotWebhookEvent).one()
    assert row.status == "done"
    assert row.attempts == 1


async def test_drain_failure_path_posts_format_hint_to_linked_author(db, linked_owner):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(BARE_ID)]}
    )

    outcome, posted, liked = await _drain(db)

    assert outcome.no_detection == 1
    assert liked == [{"tweet_id": BARE_ID}]
    (payload,) = posted
    text = payload["text"]
    assert isinstance(text, str)
    assert "no coordinates" in text.lower()
    assert "48.858370, 2.294481" in text


async def test_drain_unlinked_author_is_fully_silent(db):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )

    outcome, posted, liked = await _drain(db)

    assert outcome.no_account == 1
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == COORD_ID).one()
    assert ledger.outcome == "no_account"


async def test_webhook_then_poll_is_already_handled(db, linked_owner):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )
    await _drain(db)

    def poll_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [{"id": COORD_ID, "author_id": "u1", "text": BODIES[COORD_ID]["text"]}],
                "includes": {"users": [{"id": "u1", "username": HANDLE}]},
                "meta": {},
            },
        )

    with (
        httpx.Client(transport=httpx.MockTransport(poll_handler)) as read,
        _syndication_client() as syn,
    ):
        outcome = await run_bot_once(db, syndication_client=syn, x_read_client=read)

    assert outcome.already_handled == 1
    assert outcome.events_created == 0
    assert db.query(BotMention).filter(BotMention.mention_tweet_id == COORD_ID).count() == 1


async def test_poison_row_lands_failed_after_attempt_budget(db):
    # A row whose attempts budget is already spent is buried, not retried.
    row = BotWebhookEvent(mention={"nonsense": True}, attempts=3)
    db.add(row)
    db.commit()

    outcome, posted, liked = await _drain(db)

    assert outcome.mentions_seen == 0
    db.refresh(row)
    assert row.status == "failed"
