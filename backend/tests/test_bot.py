"""Integration tests for the bot pipeline — mention → self-thread → detected.

Every X surface is mocked: syndication bodies through one ``MockTransport``
(dispatched by tweet id), the paid mentions read and reply write through
another. The DB and the assemble step are real, same as ``test_detection``.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest

from app.config import settings
from app.database import SessionLocal
from app.models.bot_mention import BotMention
from app.models.event import STATUS_DETECTED, Event
from app.models.user import User
from app.services.bot import (
    BotNotConfigured,
    compose_reply,
    run_bot_once,
)
from app.services.tweet_ingest.syndication import _cache_clear

BOT_USER_ID = "999000"
HANDLE = f"hawk{uuid.uuid4().hex[:8]}"

FOREIGN_ID = "9300000000000000001"
PARENT_ID = "9300000000000000002"
TAGGED_ID = "9300000000000000003"
BARE_ID = "9300000000000000004"

# A three-hop chain: a foreign tweet (whose coordinate must never leak into
# the detection), the analyst's coordinate-bearing reply to it, and the
# analyst's tag on their own reply.
BODIES = {
    FOREIGN_ID: {
        "id_str": FOREIGN_ID,
        "created_at": "2026-03-11T10:00:00.000Z",
        "user": {"screen_name": "other_analyst"},
        "text": "look at 11.111111, 22.222222 maybe?",
    },
    PARENT_ID: {
        "id_str": PARENT_ID,
        "created_at": "2026-03-11T11:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "Geolocated 55.751200, 37.617600 near the bridge",
        "in_reply_to_status_id_str": FOREIGN_ID,
    },
    TAGGED_ID: {
        "id_str": TAGGED_ID,
        "created_at": "2026-03-11T12:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot archive this",
        "in_reply_to_status_id_str": PARENT_ID,
    },
    BARE_ID: {
        "id_str": BARE_ID,
        "created_at": "2026-03-11T13:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot nothing to see here",
    },
}


def _syndication_client() -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        body = BODIES.get(req.url.params.get("id", ""))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _mentions_client(mention_ids: list[str], seen_params: list[dict[str, str]]) -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        seen_params.append(dict(req.url.params))
        data = [{"id": mid, "author_id": "u1", "text": BODIES[mid]["text"]} for mid in mention_ids]
        return httpx.Response(
            200,
            json={
                "data": data,
                "includes": {"users": [{"id": "u1", "username": HANDLE}]},
                "meta": {},
            },
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


def _write_client(posted: list[dict[str, object]]) -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        posted.append(json.loads(req.content))
        return httpx.Response(201, json={"data": {"id": "777"}})

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _bot_settings(monkeypatch):
    _cache_clear()
    monkeypatch.setattr(settings, "x_bot_bearer_token", "tok")
    monkeypatch.setattr(settings, "x_bot_user_id", BOT_USER_ID)
    monkeypatch.setattr(settings, "x_api_consumer_key", "ck")
    monkeypatch.setattr(settings, "x_api_consumer_secret", "cs")
    monkeypatch.setattr(settings, "x_bot_access_token", "at")
    monkeypatch.setattr(settings, "x_bot_access_token_secret", "ats")


@pytest.fixture
def linked_owner(db):
    """A live Vidit account whose ``x_handle`` an admin linked to HANDLE,
    the only thing the bot will attribute to (it never mints users)."""
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
    yield
    session = SessionLocal()
    try:
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


async def _run(db, mention_ids, seen_params=None, posted=None):
    seen_params = seen_params if seen_params is not None else []
    posted = posted if posted is not None else []
    with (
        _syndication_client() as syn,
        _mentions_client(mention_ids, seen_params) as read,
        _write_client(posted) as write,
    ):
        outcome = await run_bot_once(
            db, syndication_client=syn, x_read_client=read, x_write_client=write
        )
    return outcome, seen_params, posted


async def test_mention_creates_detected_draft_with_self_only_rollup(db, linked_owner):
    outcome, _, posted = await _run(db, [TAGGED_ID])

    assert outcome.events_created == 1
    assert outcome.replies_posted == 1

    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    # The head of the rolled-up self-thread (the analyst's coordinate tweet),
    # canonicalised with the real handle even though the walk fetched it
    # through the handle-less /i/web/ form.
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{PARENT_ID}"
    assert event.source_url is None
    # The foreign parent stayed out: its coordinate never became an event.
    assert "11.111111" not in json.dumps(event.proof)

    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TAGGED_ID).one()
    assert ledger.outcome == "created"
    assert ledger.events_created == 1
    assert ledger.reply_tweet_id == "777"

    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": TAGGED_ID}
    text = payload["text"]
    assert isinstance(text, str)
    assert str(event.id) in text
    assert "No source" in text  # sourceless draft → warning surfaced
    # The linkless contract: no URL, no auto-linkable domain in the reply.
    assert "http" not in text and ".app" not in text and ".com" not in text


async def test_rerun_is_idempotent_and_advances_since_id(db, linked_owner):
    await _run(db, [TAGGED_ID])
    outcome, seen_params, posted = await _run(db, [TAGGED_ID])

    assert outcome.already_handled == 1
    assert outcome.events_created == 0
    assert posted == []
    # The second pull resumed from the ledger's max mention id.
    assert seen_params[0]["since_id"] == TAGGED_ID
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 1


async def test_unlinked_handle_records_no_account_and_creates_nothing(db):
    # No Vidit account carries HANDLE: the mention is ledgered and that is
    # all. No user row minted, no draft, no reply.
    outcome, _, posted = await _run(db, [TAGGED_ID])

    assert outcome.no_account == 1
    assert outcome.events_created == 0
    assert outcome.replies_posted == 0
    assert posted == []
    assert db.query(User).filter(User.x_handle == HANDLE).first() is None
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TAGGED_ID).one()
    assert ledger.outcome == "no_account"
    assert ledger.events_created == 0
    assert ledger.reply_tweet_id is None


async def test_deactivated_linked_owner_records_no_account(db, linked_owner):
    # A suspended account must not accrue drafts or billed replies.
    linked_owner.is_active = False
    db.commit()

    outcome, _, posted = await _run(db, [TAGGED_ID])

    assert outcome.no_account == 1
    assert outcome.events_created == 0
    assert posted == []


async def test_coordinate_less_mention_records_silently(db):
    outcome, _, posted = await _run(db, [BARE_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert posted == []  # no reply: answering nothing-mentions would loop
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == BARE_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id is None


async def test_self_mention_is_ledgered_so_cursor_advances(db):
    # The bot's own posts surface in its mentions timeline. They must not be
    # processed, but they MUST land in the ledger: since_id is the ledger max,
    # so an unledgered self-mention would be re-fetched (re-billed) every run.
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [{"id": BARE_ID, "author_id": BOT_USER_ID, "text": "own reply"}],
                "includes": {"users": [{"id": BOT_USER_ID, "username": "viditbot"}]},
                "meta": {},
            },
        )

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as read,
        _syndication_client() as syn,
    ):
        outcome = await run_bot_once(db, syndication_client=syn, x_read_client=read)

    assert outcome.events_created == 0
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == BARE_ID).one()
    assert ledger.outcome == "self"
    assert ledger.reply_tweet_id is None


async def test_unconfigured_bot_refuses_to_run(db, monkeypatch):
    monkeypatch.setattr(settings, "x_bot_bearer_token", "")
    with pytest.raises(BotNotConfigured):
        await run_bot_once(db)


def test_compose_reply_is_linkless_and_carries_warnings():
    event_id = str(uuid.uuid4())
    text = compose_reply([event_id], missing_source=True, duplicate_media=True)
    assert event_id in text
    assert "No source quote or footage link" in text
    assert "already exists" in text
    assert "link in bio" in text
    assert "http" not in text and "vidit.app" not in text
    assert len(text) <= 280


def test_compose_reply_counts_extra_drafts():
    ids = [str(uuid.uuid4()) for _ in range(3)]
    text = compose_reply(ids, missing_source=False, duplicate_media=False)
    assert "3 geolocation drafts" in text
    assert ids[0] in text
    assert "(+2 more)" in text
    assert len(text) <= 280
