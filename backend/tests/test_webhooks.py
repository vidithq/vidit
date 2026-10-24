"""Tests for the X Account Activity webhook: CRC, signature, queue, drain."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import or_

import app.services.bot as bot_service
from app.config import settings
from app.main import app
from app.models.bot_mention import BotMention
from app.models.event import Event
from app.models.user import User
from app.services.bot import catch_up, drain_mentions
from app.services.tweet_ingest.syndication import _cache_clear

client = TestClient(app)

WEBHOOK_PATH = "/api/v1/webhooks/x"
BOT_USER_ID = "999000"
CONSUMER_SECRET = "test-consumer-secret"
HANDLE = f"owl{uuid.uuid4().hex[:8]}"

COORD_ID = "1940000000000000001"
BARE_ID = "1940000000000000002"
BARE2_ID = "1940000000000000003"
SOURCE_ID = "1940000000000000042"

BODIES = {
    COORD_ID: {
        "id_str": COORD_ID,
        "created_at": "2026-07-18T10:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": (
            "@viditbot\n"
            "T: Strike near the bridge\n"
            "C: 55.751200, 37.617600\n"
            "S: https://t.co/src\n"
            "Shadows match the morning light"
        ),
        "entities": {
            "urls": [
                {
                    "url": "https://t.co/src",
                    "expanded_url": f"https://x.com/warfootage/status/{SOURCE_ID}",
                }
            ]
        },
    },
    SOURCE_ID: {
        "id_str": SOURCE_ID,
        "created_at": "2026-07-17T09:00:00.000Z",
        "user": {"screen_name": "warfootage"},
        "text": "original footage",
    },
    BARE_ID: {
        "id_str": BARE_ID,
        "created_at": "2026-07-18T11:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot nothing to see here",
    },
    BARE2_ID: {
        "id_str": BARE2_ID,
        "created_at": "2026-07-18T12:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot still nothing here",
    },
}


# A post id no fixture body uses, for rows the drain must refuse.
_POISON_ID = 9_199_999_999_999_999_999


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
        db.query(BotMention)
        .filter(BotMention.status == "queued")
        .order_by(BotMention.created_at)
        .all()
    )
    return [row.payload for row in rows]


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
        outcome = await drain_mentions(db, syndication_client=syn, x_write_client=write)
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
        session.query(BotMention).filter(
            or_(BotMention.mention_post_id.in_(list(BODIES)), BotMention.status != "done")
        ).delete(synchronize_session=False)
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
    # Pinned vector: HMAC-SHA256("test-consumer-secret", "test-crc-token").
    resp = client.get(WEBHOOK_PATH, params={"crc_token": "test-crc-token"})
    assert resp.status_code == 200
    assert resp.json() == {"response_token": "sha256=1Fg22hsV/J0MPCeiX/iZqLqDkZ0S28yOOMIljrsAX9M="}


def test_crc_challenge_without_credentials_is_503(monkeypatch):
    monkeypatch.setattr(settings, "x_api_consumer_secret", "")
    resp = client.get(WEBHOOK_PATH, params={"crc_token": "x"})
    assert resp.status_code == 503


def test_crc_challenge_rejects_json_shaped_token():
    # The CRC answer uses the same HMAC as the POST verifier, so it must
    # never sign anything that could be a webhook body (JSON fails the charset).
    body = json.dumps({"for_user_id": BOT_USER_ID, "tweet_create_events": []})
    resp = client.get(WEBHOOK_PATH, params={"crc_token": body})
    assert resp.status_code == 400


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


def test_post_with_non_ascii_signature_is_401(db):
    # Must mismatch cleanly, not 500 out of compare_digest. Sent as latin-1
    # bytes because the client refuses a non-ASCII str.
    body = json.dumps({"for_user_id": BOT_USER_ID}).encode()
    resp = client.post(
        WEBHOOK_PATH,
        content=body,
        headers={
            "content-type": "application/json",
            "x-twitter-webhooks-signature": "sha256=écorché".encode("latin-1"),
        },
    )
    assert resp.status_code == 401


def test_post_with_oversized_body_is_413(db):
    from app.routers import webhooks as webhooks_module

    body = b"x" * (webhooks_module.MAX_BODY_BYTES + 1)
    resp = client.post(
        WEBHOOK_PATH,
        content=body,
        headers={"content-type": "application/json", "x-twitter-webhooks-signature": _sign(body)},
    )
    assert resp.status_code == 413
    assert _queued_mentions(db) == []


def test_post_with_chunked_oversized_body_is_413(db):
    """A chunked body with no ``Content-Length`` still 413s past ``MAX_BODY_BYTES``.

    The body-size middleware enforces the webhook's 512 KiB cap before the
    route runs, not the ~120 MiB upload ceiling."""
    from app.routers import webhooks as webhooks_module

    total = webhooks_module.MAX_BODY_BYTES + 1
    chunk = b"x" * 4096

    def _chunks():
        remaining = total
        while remaining > 0:
            step = min(len(chunk), remaining)
            yield chunk[:step]
            remaining -= step

    resp = client.post(
        WEBHOOK_PATH,
        content=_chunks(),
        headers={
            "content-type": "application/json",
            "x-twitter-webhooks-signature": "sha256=irrelevant",
        },
    )
    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()
    assert str(webhooks_module.MAX_BODY_BYTES) in resp.json()["detail"]
    assert _queued_mentions(db) == []


def test_post_without_bot_user_id_is_503(db, monkeypatch):
    # An empty id would silently drop every delivery; it must be loud.
    monkeypatch.setattr(settings, "x_bot_user_id", "")
    resp = _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )
    assert resp.status_code == 503
    assert _queued_mentions(db) == []


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


def test_tag_only_in_extended_entities_is_kept(db):
    # On a truncated tweet only extended_tweet.entities carries the bot tag.
    event = _tweet_create_event(
        COORD_ID,
        text="@viditbot archive 55.751200, 37.6…",
        mentions_bot=False,
        truncated=True,
        extended_tweet={
            "full_text": BODIES[COORD_ID]["text"],
            "entities": {"user_mentions": [{"id_str": BOT_USER_ID}]},
        },
    )
    resp = _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    assert resp.json() == {"queued": 1}
    (mention,) = _queued_mentions(db)
    assert mention["text"] == BODIES[COORD_ID]["text"]


def test_delivery_over_batch_cap_is_truncated(db):
    from app.routers import webhooks as webhooks_module

    cap = webhooks_module._MAX_EVENTS_PER_DELIVERY
    events = [
        _tweet_create_event(str(9150000000000000000 + i), text="@viditbot hi")
        for i in range(cap + 1)
    ]
    resp = _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": events})
    assert resp.json() == {"queued": cap}


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
    # Timeline activity is also delivered; only the bot's entities are mentions.
    event = _tweet_create_event(COORD_ID, mentions_bot=False)
    resp = _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    assert resp.json() == {"queued": 0}


def test_reply_carries_both_reply_edges(db):
    # The queued payload names the parent post and author (loop guard, tag rule).
    event = _tweet_create_event(
        BARE_ID,
        in_reply_to_user_id_str=BOT_USER_ID,
        in_reply_to_status_id_str=COORD_ID,
    )
    _post_payload({"for_user_id": BOT_USER_ID, "tweet_create_events": [event]})
    (mention,) = _queued_mentions(db)
    assert mention["in_reply_to_user_id"] == BOT_USER_ID
    assert mention["in_reply_to_status_id"] == COORD_ID


# ── Queue drain through the shared pipeline ────────────────────────────────


async def test_drain_creates_detection_and_replies(db, linked_owner):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )

    outcome, posted, liked = await _drain(db)

    assert outcome.created_event_count == 1
    assert liked == []  # the like ack is gone: the reply is the only gesture
    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": COORD_ID}
    ledger = db.query(BotMention).filter(BotMention.mention_post_id == COORD_ID).one()
    assert ledger.outcome == "created"
    assert ledger.reply_post_id == 888
    assert (ledger.status, ledger.attempt_count, ledger.payload) == ("done", 1, None)
    assert ledger.processed_at is not None


async def test_drain_failure_path_posts_the_diagnosis_to_linked_author(db, linked_owner):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(BARE_ID)]}
    )

    outcome, posted, liked = await _drain(db)

    assert outcome.no_detection == 1
    assert liked == []
    (payload,) = posted
    text = payload["text"]
    assert isinstance(text, str)
    assert text.startswith("❌ Nothing saved\n")
    assert "\n⚠ " in text  # the diagnosis line, same shape as the success reply
    assert "Guide in bio" in text
    assert f"(m{BARE_ID[-5:]})" in text  # the anti-duplicate mention tail


async def test_drain_unlinked_author_is_fully_silent(db):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )

    outcome, posted, liked = await _drain(db)

    assert outcome.no_account == 1
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_post_id == COORD_ID).one()
    assert ledger.outcome == "no_account"


async def test_webhook_then_catch_up_is_already_handled(db, linked_owner):
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

    with httpx.Client(transport=httpx.MockTransport(poll_handler)) as read:
        outcome = catch_up(db, x_read_client=read)

    assert outcome.already_handled == 1
    drained, posted, _ = await _drain(db)
    assert drained.mentions_processed == 0 and posted == []
    assert db.query(BotMention).filter(BotMention.mention_post_id == COORD_ID).count() == 1


def test_a_redelivery_queues_the_mention_once(db):
    body = {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    assert _post_payload(body).json() == {"queued": 1}
    assert _post_payload(body).json() == {"queued": 0}
    assert len(_queued_mentions(db)) == 1


async def test_poison_row_lands_failed_after_attempt_budget(db):
    # A row whose attempts budget is already spent is buried, not retried.
    row = BotMention(
        mention_post_id=_POISON_ID,
        author_x_handle=HANDLE,
        payload={"nonsense": True},
        attempt_count=3,
    )
    db.add(row)
    db.commit()

    outcome, posted, liked = await _drain(db)

    assert outcome.mentions_processed == 0
    db.refresh(row)
    assert row.status == "failed"


async def test_a_malformed_payload_lands_failed(db):
    row = BotMention(mention_post_id=_POISON_ID, author_x_handle=HANDLE, payload={"nonsense": True})
    db.add(row)
    db.commit()

    outcome, _, _ = await _drain(db)

    assert outcome.mentions_processed == 0
    db.refresh(row)
    assert (row.status, row.attempt_count, row.outcome) == ("failed", 1, None)


async def test_a_row_left_running_by_a_dead_worker_is_claimed_again(db, linked_owner):
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )
    row = db.query(BotMention).filter(BotMention.mention_post_id == COORD_ID).one()
    row.status = "running"
    row.attempt_count = 1
    row.processed_at = datetime.now(UTC) - bot_service.STALE_RUNNING_AFTER - timedelta(minutes=1)
    db.commit()

    outcome, _, _ = await _drain(db)

    assert outcome.created_event_count == 1
    db.refresh(row)
    assert (row.status, row.attempt_count, row.outcome) == ("done", 2, "created")


def test_claim_flips_status_so_a_second_worker_skips_it(db):
    from app.database import SessionLocal

    row = BotMention(mention_post_id=_POISON_ID, author_x_handle=HANDLE, payload={})
    db.add(row)
    db.commit()

    claimed = bot_service._claim(db)
    assert claimed is not None
    assert claimed.status == "running"
    assert claimed.attempt_count == 1

    other = SessionLocal()
    try:
        assert bot_service._claim(other) is None
    finally:
        other.close()


async def test_drain_exception_requeues_the_claimed_row(db, monkeypatch):
    async def _boom(*_args, **_kwargs):
        raise RuntimeError("pipeline died")

    monkeypatch.setattr(bot_service, "_process_claimed", _boom)
    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(COORD_ID)]}
    )

    with pytest.raises(RuntimeError):
        await drain_mentions(db)

    row = db.query(BotMention).filter(BotMention.mention_post_id == COORD_ID).one()
    assert row.status == "queued"  # retryable, bounded by the attempt budget
    assert row.attempt_count == 1


async def test_gesture_budget_spans_drain_passes(db, linked_owner, monkeypatch):
    # Caps are wall-clock (trailing hour of the ledger), not per drain pass.
    monkeypatch.setattr(settings, "bot_max_replies_per_hour", 1)

    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(BARE_ID)]}
    )
    _, posted, liked = await _drain(db)
    assert len(posted) == 1  # the failure reply spent the reply budget
    assert liked == []

    _post_payload(
        {"for_user_id": BOT_USER_ID, "tweet_create_events": [_tweet_create_event(BARE2_ID)]}
    )
    outcome, posted, liked = await _drain(db)

    assert outcome.no_detection == 1  # the mention still processed
    assert posted == []  # but the hourly caps held across passes
    assert liked == []
