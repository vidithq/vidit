"""Integration tests for the bot pipeline: mention → strict format → detected.

Every X surface is mocked: syndication bodies through one ``MockTransport``
(dispatched by tweet id), the paid mentions read and reply write through
another. The DB and the assemble step are real, same as ``test_detection``.

The bot accepts one strict structure in two spellings (bare shape or
T:/C:/S: markers) and two delivery forms — inline (the structure on the
tagged tweet) and relay (the structure on the parent the tagged reply
answers, the reply carrying the footage); the free-text coordinate
vocabulary stays the archive path's and is proven NOT to work here.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest
from geoalchemy2.shape import to_shape

from app.config import settings
from app.database import SessionLocal
from app.models.bot_mention import BotMention
from app.models.event import STATUS_DETECTED, Event
from app.models.user import User
from app.services.bot import (
    BotNotConfigured,
    compose_failure_reply,
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
FREETEXT_ID = "9300000000000000005"
MISSING_T_ID = "9300000000000000006"
MISSING_C_ID = "9300000000000000007"
MISSING_S_ID = "9300000000000000008"
REPLY_BARE_ID = "9300000000000000010"
RELAY_PARENT_ID = "9300000000000000011"
RELAY_TAGGED_ID = "9300000000000000012"
RELAY_TAGGED_TWICE_ID = "9300000000000000013"
FOREIGN_PARENT_TAG_ID = "9300000000000000014"
BARE_FMT_ID = "9300000000000000015"
SOURCE_ID = "9300000000000000042"

_SOURCE_URL = f"https://x.com/warfootage/status/{SOURCE_ID}"
_STRUCT_TEXT = (
    "@viditbot\n"
    "t: Strike on the vehicle depot\n"
    "C: 48.123456, 37.654321\n"
    "s: https://t.co/src\n"
    "Smoke plume matches the skyline"
)
_SOURCE_ENTITIES = {"urls": [{"url": "https://t.co/src", "expanded_url": _SOURCE_URL}]}

# The chain: a foreign coordinate tweet, the analyst's free-text coordinate
# reply to it, and the analyst's strict-format tag on their own reply. Neither
# ancestor coordinate may leak into the detection: the bot reads exactly the
# tagged tweet.
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
        "text": _STRUCT_TEXT,
        "entities": _SOURCE_ENTITIES,
        "in_reply_to_status_id_str": PARENT_ID,
    },
    BARE_ID: {
        "id_str": BARE_ID,
        "created_at": "2026-03-11T13:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot nothing to see here",
    },
    # The pre-strict-format shape: coordinate and source in free text, no
    # markers. The archive vocabulary, deliberately rejected on the bot path.
    FREETEXT_ID: {
        "id_str": FREETEXT_ID,
        "created_at": "2026-03-11T14:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot Geolocated 55.751200, 37.617600 near the bridge https://t.co/src",
        "entities": _SOURCE_ENTITIES,
    },
    MISSING_T_ID: {
        "id_str": MISSING_T_ID,
        "created_at": "2026-03-11T15:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot\nC: 48.123456, 37.654321\nS: https://t.co/src",
        "entities": _SOURCE_ENTITIES,
    },
    MISSING_C_ID: {
        "id_str": MISSING_C_ID,
        "created_at": "2026-03-11T16:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot\nT: Strike on the depot\nS: https://t.co/src",
        "entities": _SOURCE_ENTITIES,
    },
    MISSING_S_ID: {
        "id_str": MISSING_S_ID,
        "created_at": "2026-03-11T17:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot\nT: Strike on the depot\nC: 48.123456, 37.654321",
    },
    # A bare tag replying to the analyst's own coordinate tweet: under the old
    # parent rollup this would have detected; single-tweet reading must not.
    REPLY_BARE_ID: {
        "id_str": REPLY_BARE_ID,
        "created_at": "2026-03-11T18:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot see above",
        "in_reply_to_status_id_str": PARENT_ID,
    },
    # The relay pair: the analyst's marker tweet whose S: link is outside the
    # chase vocabulary (TikTok, host ``other``), and the analyst's direct
    # reply tagging the bot. Media-less on purpose: the assemble step's CDN
    # fetch opens a real socket, so the media split stays unit-tested
    # (test_detect.py); this proves the wiring.
    RELAY_PARENT_ID: {
        "id_str": RELAY_PARENT_ID,
        "created_at": "2026-03-11T19:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": (
            "T: Depot strike geolocated\n"
            "C: 48.123456, 37.654321\n"
            "S: https://t.co/tk\n"
            "Matched the tower skyline"
        ),
        "entities": {
            "urls": [
                {"url": "https://t.co/tk", "expanded_url": "https://www.tiktok.com/@war/video/7"}
            ]
        },
    },
    RELAY_TAGGED_ID: {
        "id_str": RELAY_TAGGED_ID,
        "created_at": "2026-03-11T19:05:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot footage saved below",
        "in_reply_to_status_id_str": RELAY_PARENT_ID,
    },
    RELAY_TAGGED_TWICE_ID: {
        "id_str": RELAY_TAGGED_TWICE_ID,
        "created_at": "2026-03-11T19:10:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot tagging again",
        "in_reply_to_status_id_str": RELAY_PARENT_ID,
    },
    # The analyst tags the bot under someone ELSE's post: the same-author
    # guard must refuse the relay, whatever the parent contains.
    FOREIGN_PARENT_TAG_ID: {
        "id_str": FOREIGN_PARENT_TAG_ID,
        "created_at": "2026-03-11T19:15:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot relay this",
        "in_reply_to_status_id_str": FOREIGN_ID,
    },
    # The bare form: same structure, no marker prefixes. The shape carries
    # the fields (title line, whole-line coordinate pair, whole-line source
    # link), the trailing prose becoming the proof.
    BARE_FMT_ID: {
        "id_str": BARE_FMT_ID,
        "created_at": "2026-03-11T20:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": (
            "@viditbot\n"
            "Strike on the vehicle depot\n"
            "48.123456, 37.654321\n"
            "https://t.co/src\n"
            "Smoke plume matches the skyline"
        ),
        "entities": _SOURCE_ENTITIES,
    },
    # The S: link's target, chased for its post date (no media, so the
    # assemble step fetches nothing).
    SOURCE_ID: {
        "id_str": SOURCE_ID,
        "created_at": "2026-03-10T09:00:00.000Z",
        "user": {"screen_name": "warfootage"},
        "text": "original footage",
    },
}


def _syndication_client() -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        body = BODIES.get(req.url.params.get("id", ""))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _mentions_client(
    mention_ids: list[str],
    seen_params: list[dict[str, str]],
    reply_to: dict[str, str] | None = None,
) -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        seen_params.append(dict(req.url.params))
        data: list[dict[str, str]] = []
        for mid in mention_ids:
            entry = {"id": mid, "author_id": "u1", "text": BODIES[mid]["text"]}
            if reply_to and mid in reply_to:
                entry["in_reply_to_user_id"] = reply_to[mid]
            data.append(entry)
        return httpx.Response(
            200,
            json={
                "data": data,
                "includes": {"users": [{"id": "u1", "username": HANDLE}]},
                "meta": {},
            },
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


def _write_client(posted: list[dict[str, object]], liked: list[dict[str, object]]) -> httpx.Client:
    """``liked`` captures any call to the likes endpoint: the like ack was
    removed from the response model, so tests assert it stays empty."""

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/likes"):
            liked.append(json.loads(req.content))
            return httpx.Response(200, json={"data": {"liked": True}})
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


async def _run(db, mention_ids, seen_params=None, posted=None, liked=None, reply_to=None):
    seen_params = seen_params if seen_params is not None else []
    posted = posted if posted is not None else []
    liked = liked if liked is not None else []
    with (
        _syndication_client() as syn,
        _mentions_client(mention_ids, seen_params, reply_to) as read,
        _write_client(posted, liked) as write,
    ):
        outcome = await run_bot_once(
            db, syndication_client=syn, x_read_client=read, x_write_client=write
        )
    return outcome, seen_params, posted, liked


async def test_conforming_mention_creates_draft_from_markers(db, linked_owner):
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.events_created == 1
    assert outcome.replies_posted == 1
    # The like ack is gone: the reply is the only gesture.
    assert liked == []

    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    # Single-tweet read: provenance is the tagged tweet itself, never a parent.
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TAGGED_ID}"
    # Title from T:, coordinate from C: (marker case-insensitive: t: / s:).
    assert event.title == "Strike on the vehicle depot"
    point = to_shape(event.event_coords)
    assert point.y == pytest.approx(48.123456)
    assert point.x == pytest.approx(37.654321)
    # Source from S:, chased through syndication for its post date.
    assert event.source_url == _SOURCE_URL
    assert event.source_posted_at is not None
    assert event.source_posted_at.date().isoformat() == "2026-03-10"

    # Proof = the non-marker lines only: no markers, no raw coordinate, no
    # bot tag, no shortlink, and nothing from the parent chain.
    proof = json.dumps(event.proof)
    assert "Smoke plume matches the skyline" in proof
    assert "T:" not in proof and "t:" not in proof
    assert "48.123456" not in proof
    assert "viditbot" not in proof
    assert "t.co" not in proof
    assert "55.751200" not in proof and "11.111111" not in proof

    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TAGGED_ID).one()
    assert ledger.outcome == "created"
    assert ledger.events_created == 1
    assert ledger.reply_tweet_id == "777"

    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": TAGGED_ID}
    text = payload["text"]
    assert isinstance(text, str)
    assert str(event.id) in text
    assert "No source" not in text  # the S: source landed, no warning
    # The linkless contract: no URL, no auto-linkable domain in the reply.
    assert "http" not in text and ".app" not in text and ".com" not in text


async def test_parent_rollup_is_gone_on_the_bot_path(db, linked_owner):
    # The tagged tweet is a bare reply to the analyst's own FREE-TEXT
    # coordinate tweet. The old self-thread walk would have rolled the parent
    # in and detected; the relay form fetches the parent but holds it to the
    # same strict markers, so free text keeps failing.
    outcome, _, posted, _ = await _run(db, [REPLY_BARE_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 0
    (payload,) = posted  # the linked author gets the format lesson
    assert "Shape, one per line" in payload["text"]


async def test_bare_mention_creates_draft_from_the_shape(db, linked_owner):
    # The unprefixed form end to end: title, coordinate, and source read
    # from the shape alone; the S: link chased for its post date.
    outcome, _, posted, _ = await _run(db, [BARE_FMT_ID])

    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.title == "Strike on the vehicle depot"
    point = to_shape(event.event_coords)
    assert point.y == pytest.approx(48.123456)
    assert point.x == pytest.approx(37.654321)
    assert event.source_url == _SOURCE_URL
    assert event.source_posted_at is not None

    proof = json.dumps(event.proof)
    assert "Smoke plume matches the skyline" in proof
    assert "Strike on the vehicle depot" not in proof  # the title line is consumed
    assert "48.123456" not in proof and "t.co" not in proof

    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": BARE_FMT_ID}


async def test_relay_mention_creates_draft_from_the_parent(db, linked_owner):
    # The relay form: markers on the parent, the tag in the analyst's direct
    # reply. The S: link (TikTok, outside the chase vocabulary) is stored
    # link-only; provenance anchors on the parent, not the tagged reply.
    outcome, _, posted, _ = await _run(db, [RELAY_TAGGED_ID])

    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{RELAY_PARENT_ID}"
    assert event.title == "Depot strike geolocated"
    assert event.source_url == "https://www.tiktok.com/@war/video/7"
    assert event.source_posted_at is None

    proof = json.dumps(event.proof)
    assert "Matched the tower skyline" in proof  # the parent's proof line
    assert "footage saved below" in proof  # the reply's caption joins it
    assert "viditbot" not in proof

    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == RELAY_TAGGED_ID).one()
    assert ledger.outcome == "created"
    (payload,) = posted  # the success reply answers the tagged reply
    assert payload["reply"] == {"in_reply_to_tweet_id": RELAY_TAGGED_ID}


async def test_relay_and_inline_share_the_parent_idempotency_key(db, linked_owner):
    # detected_from_url anchors on the parent, so a second relay tag and an
    # inline mention of the parent itself both collapse onto the first draft.
    outcome, _, _, _ = await _run(db, [RELAY_TAGGED_ID, RELAY_TAGGED_TWICE_ID, RELAY_PARENT_ID])

    assert outcome.events_created == 1
    assert outcome.skipped == 2
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 1


async def test_relay_under_a_foreign_parent_is_refused(db, linked_owner):
    # The same-author guard: tagging the bot under someone else's post must
    # not relay anything onto it, whatever the parent contains.
    outcome, _, posted, _ = await _run(db, [FOREIGN_PARENT_TAG_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    (payload,) = posted  # the linked author still gets the format lesson
    assert "Shape, one per line" in payload["text"]


async def test_free_text_coordinates_are_not_a_fallback(db, linked_owner):
    # Coordinate + source, correct by the archive's free-text vocabulary,
    # but no markers: the bot must refuse and teach the format.
    outcome, _, posted, liked = await _run(db, [FREETEXT_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert liked == []  # no like ack, on any path
    (payload,) = posted
    text = payload["text"]
    assert isinstance(text, str)
    assert "Shape, one per line" in text and "22.703889, -83.297222" in text
    # Same linkless contract as the success reply.
    assert "http" not in text and ".app" not in text and ".com" not in text
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == FREETEXT_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id == "777"


@pytest.mark.parametrize("mention_id", [MISSING_T_ID, MISSING_C_ID, MISSING_S_ID])
async def test_each_missing_marker_fails_the_mention(db, linked_owner, mention_id):
    outcome, _, posted, _ = await _run(db, [mention_id])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert len(posted) == 1  # the failure reply teaching the format
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == mention_id).one()
    assert ledger.outcome == "no_detection"


async def test_rerun_is_idempotent_and_advances_since_id(db, linked_owner):
    import app.services.bot as bot_service

    await _run(db, [TAGGED_ID])
    outcome, seen_params, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.already_handled == 1
    assert outcome.events_created == 0
    assert posted == []
    assert liked == []  # an already-handled mention earns no second gesture
    # The second pull resumed from the ledger's max mention id, minus the
    # lookback overlap that keeps webhook-dropped mentions reachable.
    expected = str(int(TAGGED_ID) - bot_service._SINCE_ID_OVERLAP)
    assert seen_params[0]["since_id"] == expected
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 1


async def test_poll_overlap_recovers_mention_dropped_by_webhook(db, linked_owner):
    # The webhook dropped TAGGED_ID but delivered the newer BARE_ID, so the
    # ledger max leapfrogged the dropped mention. The poll's since_id sits
    # one overlap behind the max, so a since_id-honouring API still serves
    # TAGGED_ID and the mention is recovered.
    db.add(BotMention(mention_tweet_id=BARE_ID, author_handle=HANDLE, outcome="no_detection"))
    db.commit()

    def handler(req: httpx.Request) -> httpx.Response:
        since = int(req.url.params["since_id"])
        data = [
            {"id": mid, "author_id": "u1", "text": BODIES[mid]["text"]}
            for mid in (TAGGED_ID, BARE_ID)
            if int(mid) > since
        ]
        return httpx.Response(
            200,
            json={
                "data": data,
                "includes": {"users": [{"id": "u1", "username": HANDLE}]},
                "meta": {},
            },
        )

    posted: list[dict[str, object]] = []
    liked: list[dict[str, object]] = []
    with (
        _syndication_client() as syn,
        httpx.Client(transport=httpx.MockTransport(handler)) as read,
        _write_client(posted, liked) as write,
    ):
        outcome = await run_bot_once(
            db, syndication_client=syn, x_read_client=read, x_write_client=write
        )

    assert outcome.events_created == 1  # the dropped mention processed
    assert outcome.already_handled == 1  # the ledgered one re-read, absorbed
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TAGGED_ID).one()
    assert ledger.outcome == "created"


async def test_unlinked_handle_records_no_account_and_creates_nothing(db):
    # No Vidit account carries HANDLE: the mention is ledgered and that is
    # all. No user row minted, no draft, no reply, no like.
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.no_account == 1
    assert outcome.events_created == 0
    assert outcome.replies_posted == 0
    assert posted == []
    assert liked == []
    assert db.query(User).filter(User.x_handle == HANDLE).first() is None
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TAGGED_ID).one()
    assert ledger.outcome == "no_account"
    assert ledger.events_created == 0
    assert ledger.reply_tweet_id is None


async def test_deactivated_linked_owner_records_no_account(db, linked_owner):
    # A suspended account must not accrue drafts or billed gestures.
    linked_owner.is_active = False
    db.commit()

    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.no_account == 1
    assert outcome.events_created == 0
    assert posted == []
    assert liked == []


async def test_non_conforming_mention_from_unlinked_author_records_silently(db):
    # No linked account: no failure reply, no like; a stranger's formatless
    # tag costs nothing.
    outcome, _, posted, liked = await _run(db, [BARE_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == BARE_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id is None


async def test_non_conforming_mention_from_linked_author_gets_failure_reply(db, linked_owner):
    outcome, _, posted, liked = await _run(db, [BARE_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert outcome.replies_posted == 1
    assert liked == []
    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": BARE_ID}
    text = payload["text"]
    assert isinstance(text, str)
    assert "nothing saved" in text.lower()
    assert "Shape, one per line" in text  # the format lesson
    assert "I found no coordinate line." in text  # the diagnosis opener
    # Same linkless contract as the success reply.
    assert "http" not in text and ".app" not in text and ".com" not in text
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == BARE_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id == "777"


async def test_failure_reply_loop_guard_on_replies_to_the_bot(db, linked_owner):
    # The tagged tweet is itself a reply to the bot (a courtesy answer to the
    # bot's own reply auto-mentions it): the failure reply must not fire, or
    # every thanks would earn an answer forever.
    outcome, _, posted, liked = await _run(db, [BARE_ID], reply_to={BARE_ID: BOT_USER_ID})

    assert outcome.no_detection == 1
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == BARE_ID).one()
    assert ledger.reply_tweet_id is None


async def test_reply_budget_cap_skips_reply_but_draft_still_lands(db, linked_owner, monkeypatch):
    import app.services.bot as bot_service

    monkeypatch.setattr(bot_service, "_MAX_REPLIES_PER_HOUR", 0)
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert posted == []
    assert liked == []
    assert outcome.replies_posted == 0
    assert outcome.events_created == 1  # detection is unbilled; only the gesture is skipped


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


async def test_poll_flags_webhook_gap_when_webhook_enabled(db, linked_owner, monkeypatch):
    # While the webhook is live, the poll is a reconciliation net: a mention
    # it processes fresh means the webhook missed it, and that must page.
    import app.services.bot as bot_service

    captured: list[tuple[str, str | None]] = []
    monkeypatch.setattr(settings, "x_webhook_enabled", True)
    monkeypatch.setattr(
        bot_service.sentry_sdk,
        "capture_message",
        lambda message, level=None: captured.append((message, level)),
    )

    await _run(db, [TAGGED_ID])

    assert any(
        "webhook gap" in m and TAGGED_ID in m and level == "warning" for m, level in captured
    )


async def test_gap_detector_fires_on_failed_verdict_too(db, linked_owner, monkeypatch):
    # Every fresh verdict is a gap, not only the created/no_detection family:
    # a mention whose pipeline raised still arrived via reconciliation.
    import app.services.bot as bot_service

    captured: list[tuple[str, str | None]] = []
    monkeypatch.setattr(settings, "x_webhook_enabled", True)
    monkeypatch.setattr(
        bot_service.sentry_sdk,
        "capture_message",
        lambda message, level=None: captured.append((message, level)),
    )
    unknown_id = "9300000000000000009"

    def read_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [{"id": unknown_id, "author_id": "u1", "text": "@viditbot hello"}],
                "includes": {"users": [{"id": "u1", "username": HANDLE}]},
                "meta": {},
            },
        )

    posted: list[dict[str, object]] = []
    liked: list[dict[str, object]] = []
    try:
        with (
            _syndication_client() as syn,  # 404s the unknown id, so the pipeline raises
            httpx.Client(transport=httpx.MockTransport(read_handler)) as read,
            _write_client(posted, liked) as write,
        ):
            outcome = await run_bot_once(
                db, syndication_client=syn, x_read_client=read, x_write_client=write
            )

        assert outcome.failed == 1
        assert any("webhook gap" in m and unknown_id in m for m, _ in captured)
    finally:
        db.query(BotMention).filter(BotMention.mention_tweet_id == unknown_id).delete(
            synchronize_session=False
        )
        db.commit()


async def test_poll_stays_gap_silent_while_webhook_disabled(db, linked_owner, monkeypatch):
    import app.services.bot as bot_service

    captured: list[str] = []
    monkeypatch.setattr(
        bot_service.sentry_sdk,
        "capture_message",
        lambda message, level=None: captured.append(message),
    )

    await _run(db, [TAGGED_ID])

    assert captured == []


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


def test_compose_failure_reply_teaches_the_format_linklessly():
    text = compose_failure_reply()
    # The bare shape is the lesson: title line, coordinate line, source line.
    assert "Shape, one per line" in text
    assert "22.703889, -83.297222" in text
    # The relay escape hatch, for footage the chase cannot fetch.
    assert "Tag me in a direct reply" in text
    assert "Guide in bio" in text
    assert "http" not in text and ".app" not in text and ".com" not in text
    assert len(text) <= 280


def test_compose_failure_reply_opens_with_every_diagnosis():
    # Each reason code opens the reply with its hint; every variant stays
    # linkless and inside the cap; an unknown code degrades to the plain
    # lesson rather than raising.
    from app.services.bot import _FAILURE_HINTS

    for reason, hint in _FAILURE_HINTS.items():
        text = compose_failure_reply(reason)
        assert text.startswith(f"Vidit: nothing saved. {hint}")
        assert "Shape, one per line" in text
        assert "http" not in text and ".app" not in text and ".com" not in text
        assert len(text) <= 280
    assert compose_failure_reply("no_such_reason").startswith("Vidit: nothing saved.\n")


def test_compose_reply_counts_extra_drafts():
    ids = [str(uuid.uuid4()) for _ in range(3)]
    text = compose_reply(ids, missing_source=False, duplicate_media=False)
    assert "3 geolocation drafts" in text
    assert ids[0] in text
    assert "(+2 more)" in text
    assert len(text) <= 280
