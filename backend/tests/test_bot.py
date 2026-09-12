"""Integration tests for the bot pipeline: a mention becomes a detection.

Every X surface is mocked: syndication bodies through one ``MockTransport``
(dispatched by tweet id), the paid mentions read and reply write through
another. The DB and the assemble step are real, same as ``test_detection``.

The bot reads the same engine as the pasted import and the archive backfill, so
what is pinned here is the orchestration around it: the acquisition of the
tagged post and its same-author parent, the ledger, the budget, and the reply.
The grammar itself is pinned by ``tests/ingest_contract``.
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
from app.models.event import STATUS_DETECTED, STATUS_REQUESTED, Event
from app.models.media import Media
from app.models.user import User
from app.services.bot import (
    REPLY_MAX_WEIGHTED_LEN,
    BotNotConfigured,
    compose_failure_reply,
    compose_reply,
    compose_request_reply,
    reply_weighted_len,
    run_bot_once,
)
from app.services.tweet_ingest import (
    DUPLICATE_MEDIA,
    FOOTAGE_UNUSABLE,
    REFUSAL_MESSAGES,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    WARNING_MESSAGES,
)
from app.services.tweet_ingest.syndication import _cache_clear
from app.services.tweet_ingest.urls import TELEGRAM_HOST_RE
from tests._fixtures import TINY_MP4
from tests.ingest_contract.loader import load_body, load_chased, load_embed, load_expected

BOT_USER_ID = "999000"
HANDLE = f"hawk{uuid.uuid4().hex[:8]}"
# A second linked analyst, for the shapes that need two owners.
OTHER_HANDLE = f"kite{uuid.uuid4().hex[:8]}"

# The mention ids sit above any snowflake X will mint this century (9.1e18 is
# year 2079), because the poll's ``since_id`` is the ledger's max id over the
# whole table: a real mention of the live bot left in a shared development
# database would otherwise outrank the fixtures and starve the two cursor
# tests below of their own rows.
FOREIGN_ID = "9100000000000000001"
TAGGED_ID = "9100000000000000003"
NO_COORD_ID = "9100000000000000004"
TWO_POST_PARENT_ID = "9100000000000000011"
TWO_POST_TAGGED_ID = "9100000000000000012"
TWO_POST_TAGGED_TWICE_ID = "9100000000000000013"
FOREIGN_PARENT_TAG_ID = "9100000000000000014"
# The tagged post X refuses to serve unauthenticated: ``_syndication_client``
# answers the tombstone body for this id, so nothing is ever read from it. Its
# ``BODIES`` entry exists only to feed the mentions payload's ``text``.
TOMBSTONE_ID = "9100000000000000017"
SOURCE_ID = "9100000000000000042"
# The request branch: a mirror post carries footage and names the original, but
# no coordinate. ``MIRROR_TG_REPOST_ID`` is the same mirror posted twice (the
# delete-and-repost habit), which is what a second request would land on, and
# ``MIRROR_TG_OTHER_ID`` is a second analyst mirroring the same channel clip.
MIRROR_TG_ID = "9110000000000000001"
MIRROR_TG_REPOST_ID = "9110000000000000002"
MIRROR_X_ID = "9110000000000000003"
MIRROR_X_SOURCE_ID = "9110000000000000004"
MIRROR_TG_OTHER_ID = "9110000000000000005"
# The same mirror, re-posted with the coordinate the analyst has since worked
# out: a geolocation, which takes the detections' path beside the open request.
MIRROR_TG_GEO_ID = "9110000000000000006"

# Both mirror posts, and the Telegram embed, come from the contract catalogue,
# the one place the shapes are written down: the bot's request tests run the
# payloads the grammar is pinned on rather than second copies of them. Only the
# identity the bot needs is overridden per body, the id, the date and the
# tagging handle, plus the bot tag the mention carries.
_MIRROR_TYPOLOGY = "mirror_telegram_no_coord"
_MIRROR_BODY = load_body(_MIRROR_TYPOLOGY)
_TELEGRAM_POST = _MIRROR_BODY["entities"]["urls"][0]["expanded_url"]
_MIRROR_X_TYPOLOGY = "mirror_x_status_no_coord"
_MIRROR_X_BODY = load_body(_MIRROR_X_TYPOLOGY)
_MIRROR_X_SOURCE_BODY = load_chased(
    _MIRROR_X_TYPOLOGY, load_expected(_MIRROR_X_TYPOLOGY)["chased_status_id"]
)


def _telegram_embed() -> str:
    """The catalogue's Telegram embed, which the chase reads over the wire.

    Raises rather than asserts: the fixture is what the whole request branch
    runs on here, so a typology that stopped shipping one has to fail loudly at
    the read instead of at an opaque ``None`` three layers down.
    """
    embed = load_embed(_MIRROR_TYPOLOGY)
    if embed is None:
        raise RuntimeError(f"{_MIRROR_TYPOLOGY} ships no embed.html")
    return embed


def _mirror_body(tweet_id: str, created_at: str, handle: str = HANDLE) -> dict:
    """The catalogue's mirror post, re-anchored on one mention.

    The text, the media and the link stay the fixture's; the id, the timestamp
    and the author are what tells one mention from another, and the bot tag is
    what makes the post a mention at all.
    """
    return {
        **_MIRROR_BODY,
        "id_str": tweet_id,
        "created_at": created_at,
        "user": {"screen_name": handle},
        "text": f"@viditbot\n{_MIRROR_BODY['text']}",
    }


_SOURCE_URL = f"https://x.com/warfootage/status/{SOURCE_ID}"
_STRUCT_TEXT = (
    "@viditbot\n"
    "Strike on the vehicle depot\n"
    "48.123456, 37.654321\n"
    "https://t.co/src\n"
    "Smoke plume matches the skyline"
)
_SOURCE_ENTITIES = {"urls": [{"url": "https://t.co/src", "expanded_url": _SOURCE_URL}]}

# A foreign coordinate tweet the analyst tags the bot under, and the tagged
# posts themselves. The foreign post is never read: the acquisition stops at
# the same author.
BODIES = {
    FOREIGN_ID: {
        "id_str": FOREIGN_ID,
        "created_at": "2026-03-11T10:00:00.000Z",
        "user": {"screen_name": "other_analyst"},
        "text": "look at 11.111111, 22.222222 maybe?",
    },
    TAGGED_ID: {
        "id_str": TAGGED_ID,
        "created_at": "2026-03-11T12:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": _STRUCT_TEXT,
        "entities": _SOURCE_ENTITIES,
    },
    NO_COORD_ID: {
        "id_str": NO_COORD_ID,
        "created_at": "2026-03-11T13:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot nothing to see here",
    },
    # The two-post field format: the coordinate on the analyst's post, the
    # source link on their own reply where the bot is tagged. Media-less on
    # purpose: the assemble step's CDN fetch opens a real socket, so the media
    # split stays unit-tested (test_detect.py); this proves the wiring.
    TWO_POST_PARENT_ID: {
        "id_str": TWO_POST_PARENT_ID,
        "created_at": "2026-03-11T19:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "Depot strike geolocated\n48.123456, 37.654321\nMatched the tower skyline",
    },
    TWO_POST_TAGGED_ID: {
        "id_str": TWO_POST_TAGGED_ID,
        "created_at": "2026-03-11T19:05:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot footage saved below https://t.co/tk",
        "entities": {
            "urls": [
                {"url": "https://t.co/tk", "expanded_url": "https://www.tiktok.com/@war/video/7"}
            ]
        },
        "in_reply_to_status_id_str": TWO_POST_PARENT_ID,
    },
    TWO_POST_TAGGED_TWICE_ID: {
        "id_str": TWO_POST_TAGGED_TWICE_ID,
        "created_at": "2026-03-11T19:10:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot tagging again https://t.co/tk",
        "entities": {
            "urls": [
                {"url": "https://t.co/tk", "expanded_url": "https://www.tiktok.com/@war/video/7"}
            ]
        },
        "in_reply_to_status_id_str": TWO_POST_PARENT_ID,
    },
    # The analyst tags the bot under someone ELSE's post: the acquisition must
    # not join that parent, whatever it contains.
    FOREIGN_PARENT_TAG_ID: {
        "id_str": FOREIGN_PARENT_TAG_ID,
        "created_at": "2026-03-11T19:15:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot relay this",
        "in_reply_to_status_id_str": FOREIGN_ID,
    },
    # A perfectly readable post whose own body X will not serve: the tombstone
    # alone must stop it, so the text is deliberately valid.
    TOMBSTONE_ID: {
        "id_str": TOMBSTONE_ID,
        "created_at": "2026-03-11T21:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": _STRUCT_TEXT,
        "entities": _SOURCE_ENTITIES,
    },
    # The linked status, chased for its post date (no media, so the assemble
    # step fetches nothing).
    SOURCE_ID: {
        "id_str": SOURCE_ID,
        "created_at": "2026-03-10T09:00:00.000Z",
        "user": {"screen_name": "warfootage"},
        "text": "original footage",
    },
    # The mirror posts: footage, the original's link, no coordinate.
    MIRROR_TG_ID: _mirror_body(MIRROR_TG_ID, "2026-03-12T08:30:00.000Z"),
    MIRROR_TG_REPOST_ID: _mirror_body(MIRROR_TG_REPOST_ID, "2026-03-12T08:45:00.000Z"),
    MIRROR_TG_OTHER_ID: _mirror_body(
        MIRROR_TG_OTHER_ID, "2026-03-12T09:10:00.000Z", handle=OTHER_HANDLE
    ),
    MIRROR_TG_GEO_ID: {
        **_mirror_body(MIRROR_TG_GEO_ID, "2026-03-14T11:00:00.000Z"),
        "text": f"@viditbot\n{_MIRROR_BODY['text']}\n48.123456, 37.654321",
    },
    MIRROR_X_ID: {
        **_MIRROR_X_BODY,
        "id_str": MIRROR_X_ID,
        "user": {"screen_name": HANDLE},
        "text": f"@viditbot\n{_MIRROR_X_BODY['text']}",
        "entities": {
            "urls": [
                {
                    "url": _MIRROR_X_BODY["entities"]["urls"][0]["url"],
                    "expanded_url": f"https://x.com/front_owl/status/{MIRROR_X_SOURCE_ID}",
                }
            ]
        },
    },
    # The status the X mirror points at, chased for its date and its video.
    MIRROR_X_SOURCE_ID: {**_MIRROR_X_SOURCE_BODY, "id_str": MIRROR_X_SOURCE_ID},
}


def _syndication_client() -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        if TELEGRAM_HOST_RE.match(req.url.host.lower()) is not None:
            # The Telegram chase reads a public embed rather than syndication;
            # one client carries both upstreams, as it does in production.
            return httpx.Response(200, text=_telegram_embed())
        tweet_id = req.url.params.get("id", "")
        if tweet_id == TOMBSTONE_ID:
            # X's 200-with-no-tweet for a post readable only behind a login
            # (age-restricted, withheld): the shape conflict footage lands in.
            return httpx.Response(200, json={"__typename": "TweetTombstone", "tombstone": {}})
        body = BODIES.get(tweet_id)
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _mentions_client(
    mention_ids: list[str],
    seen_params: list[dict[str, str]],
    reply_to: dict[str, str] | None = None,
    handle: str = HANDLE,
) -> httpx.Client:
    """The paid mentions read, every mention authored by ``handle``."""

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
                "includes": {"users": [{"id": "u1", "username": handle}]},
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


def _linked_account(db, handle: str) -> User:
    """A live Vidit account whose ``x_handle`` an admin linked to ``handle``,
    the only thing the bot will attribute to (it never mints users)."""
    user = User(
        username=f"analyst{uuid.uuid4().hex[:8]}",
        email=f"analyst-{uuid.uuid4().hex}@example.com",
        password_hash="x",
        x_handle=handle,
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def linked_owner(db):
    return _linked_account(db, HANDLE)


@pytest.fixture
def other_linked_owner(db):
    """A second linked analyst, for what only two owners can show: the request
    dedup is owner-scoped, so the same footage reaches Vidit twice only when two
    accounts mirror it."""
    return _linked_account(db, OTHER_HANDLE)


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    session = SessionLocal()
    try:
        session.query(BotMention).filter(BotMention.mention_tweet_id.in_(list(BODIES))).delete(
            synchronize_session=False
        )
        for handle in (HANDLE, OTHER_HANDLE):
            owner = session.query(User).filter(User.x_handle == handle).first()
            if owner is None:
                continue
            session.query(Event).filter(Event.owner_id == owner.id).delete(
                synchronize_session=False
            )
            session.query(User).filter(User.id == owner.id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


async def _run(
    db, mention_ids, seen_params=None, posted=None, liked=None, reply_to=None, handle=HANDLE
):
    seen_params = seen_params if seen_params is not None else []
    posted = posted if posted is not None else []
    liked = liked if liked is not None else []
    with (
        _syndication_client() as syn,
        _mentions_client(mention_ids, seen_params, reply_to, handle) as read,
        _write_client(posted, liked) as write,
    ):
        outcome = await run_bot_once(
            db, syndication_client=syn, x_read_client=read, x_write_client=write
        )
    return outcome, seen_params, posted, liked


async def test_a_tagged_post_creates_a_detection(db, linked_owner):
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.events_created == 1
    assert outcome.replies_posted == 1
    # The like ack is gone: the reply is the only gesture.
    assert liked == []

    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TAGGED_ID}"
    # The title is the first line carrying text beyond coordinates and links,
    # the bot tag having left the line it opened.
    assert event.title == "Strike on the vehicle depot"
    point = to_shape(event.event_coords)
    assert point.y == pytest.approx(48.123456)
    assert point.x == pytest.approx(37.654321)
    # The sole candidate link is the source, chased through syndication for its
    # post date.
    assert event.source_url == _SOURCE_URL
    assert event.source_posted_at is not None
    assert event.source_posted_at.date().isoformat() == "2026-03-10"

    # The proof is the post as written: the coordinate line stays, the bot tag
    # and the wrappers of attached media go, and nothing arrives from a chain
    # the acquisition never read.
    proof = json.dumps(event.proof)
    assert "Smoke plume matches the skyline" in proof
    assert "48.123456" in proof
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
    assert str(event.id)[:8] in text  # the shortened ref
    assert str(event.id) not in text  # never the full UUID (a third of the reply)
    # The mocked source tweet carries no media, so the footage warning fires;
    # its date resolved, so the date warning must not.
    assert "No footage from the source" in text
    assert "post date" not in text and "already on Vidit" not in text
    # The linkless contract: no URL, no auto-linkable domain in the reply.
    assert "http" not in text and ".app" not in text and ".com" not in text


async def test_the_two_post_field_format_lands_one_detection(db, linked_owner):
    # The coordinate on the analyst's post, the source link on their own reply
    # where the bot is tagged. The TikTok link is outside the chase vocabulary,
    # so it is stored link-only; provenance anchors on the parent.
    outcome, _, posted, _ = await _run(db, [TWO_POST_TAGGED_ID])

    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TWO_POST_PARENT_ID}"
    assert event.title == "Depot strike geolocated"
    assert event.source_url == "https://www.tiktok.com/@war/video/7"
    assert event.source_posted_at is None

    proof = json.dumps(event.proof)
    assert "Matched the tower skyline" in proof  # the parent's line
    assert "footage saved below" in proof  # the reply's line joins it
    assert "viditbot" not in proof

    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TWO_POST_TAGGED_ID).one()
    assert ledger.outcome == "created"
    (payload,) = posted  # the success reply answers the tagged reply
    assert payload["reply"] == {"in_reply_to_tweet_id": TWO_POST_TAGGED_ID}
    # Link-only source: no post date came back, so the reply warns.
    assert "post date" in payload["text"]


async def test_tagging_either_post_shares_the_parent_idempotency_key(db, linked_owner):
    # detected_from_url anchors on the parent, so a second tag on the reply and
    # a tag on the parent itself both collapse onto the first detection. Each of the
    # two later tags reads a different slice of the thread, so it overwrites the
    # detection rather than matching it unchanged: an answered tag, ledgered
    # ``updated``, not the silent ``skipped``.
    outcome, _, posted, _ = await _run(
        db, [TWO_POST_TAGGED_ID, TWO_POST_TAGGED_TWICE_ID, TWO_POST_PARENT_ID]
    )

    assert outcome.events_created == 1
    assert outcome.events_updated == 2
    assert outcome.skipped == 0
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 1
    assert [p["text"].splitlines()[0].split(" · ")[0] for p in posted] == [
        "✅ 1 detection saved",
        "✅ 1 detection updated",
        "✅ 1 detection updated",
    ]


async def test_a_tag_under_a_foreign_parent_reads_only_the_tag(db, linked_owner):
    # The same-author guard: tagging the bot under someone else's post must not
    # read that post, whatever it contains.
    outcome, _, posted, _ = await _run(db, [FOREIGN_PARENT_TAG_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    (payload,) = posted  # the linked author still gets the diagnosis
    assert payload["text"].startswith("❌ Nothing saved\n⚠ No coordinate in the post\n")


async def test_tombstoned_tagged_post_earns_a_reply_not_a_page(db, linked_owner, monkeypatch):
    """X age-gates exactly the footage this bot reads, so a tagged post it
    won't serve unauthenticated recurs. Nothing was readable and nothing here
    is broken: the mention ledgers ``no_detection``, the linked author gets a
    reply naming the restriction instead of a wrong format diagnosis, and
    Sentry hears nothing.
    """
    import app.services.bot as bot_service

    captured: list[BaseException] = []
    monkeypatch.setattr(bot_service.sentry_sdk, "capture_exception", captured.append)

    outcome, _, posted, _ = await _run(db, [TOMBSTONE_ID])

    assert outcome.no_detection == 1
    assert outcome.failed == 0
    assert outcome.events_created == 0
    assert captured == []
    (payload,) = posted
    assert payload["text"] == (
        "❌ Nothing saved\n"
        "⚠ Post not readable on X (age-restricted, withheld or gone)\n"
        "Guide in bio (m00017)"
    )
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TOMBSTONE_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id == "777"


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
    # The webhook dropped TAGGED_ID but delivered the newer NO_COORD_ID, so the
    # ledger max leapfrogged the dropped mention. The poll's since_id sits
    # one overlap behind the max, so a since_id-honouring API still serves
    # TAGGED_ID and the mention is recovered.
    db.add(BotMention(mention_tweet_id=NO_COORD_ID, author_handle=HANDLE, outcome="no_detection"))
    db.commit()

    def handler(req: httpx.Request) -> httpx.Response:
        since = int(req.url.params["since_id"])
        data = [
            {"id": mid, "author_id": "u1", "text": BODIES[mid]["text"]}
            for mid in (TAGGED_ID, NO_COORD_ID)
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
    # all. No user row minted, no detection, no reply, no like.
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
    # A suspended account must not accrue detections or billed gestures.
    linked_owner.is_active = False
    db.commit()

    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.no_account == 1
    assert outcome.events_created == 0
    assert posted == []
    assert liked == []


async def test_a_persist_that_raised_on_every_detection_answers_the_analyst(
    db, linked_owner, monkeypatch
):
    """The verdict a linked analyst used to get in silence.

    A post the engine read fine, whose every detection raised mid-persist, ledgers
    ``failed`` so an operator can retry it by deleting the row. The paste
    returns that verdict and the archive counts it, so the bot answers too:
    there is no code to name, which is exactly the reply's unexpected case, and
    it points at the maintainers rather than reciting a format lesson."""
    import app.services.detection as detection_mod

    async def _boom(*args, **kwargs):
        raise RuntimeError("storage is down")

    monkeypatch.setattr(detection_mod, "_persist_one", _boom)
    outcome, _, posted, _ = await _run(db, [TAGGED_ID])

    assert outcome.failed == 1
    assert outcome.events_created == 0
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == TAGGED_ID).one()
    assert ledger.outcome == "failed"

    (payload,) = posted
    assert payload["text"].startswith("❌ Nothing saved\n⚠ Unexpected case. Reach out to @vidithq")
    assert ledger.reply_tweet_id is not None
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).all() == []


async def test_non_conforming_mention_from_unlinked_author_records_silently(db):
    # No linked account: no failure reply, no like; a stranger's formatless
    # tag costs nothing.
    outcome, _, posted, liked = await _run(db, [NO_COORD_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == NO_COORD_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id is None


async def test_non_conforming_mention_from_linked_author_gets_failure_reply(db, linked_owner):
    outcome, _, posted, liked = await _run(db, [NO_COORD_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    assert outcome.replies_posted == 1
    assert liked == []
    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": NO_COORD_ID}
    text = payload["text"]
    assert isinstance(text, str)
    assert text.startswith("❌ Nothing saved\n⚠ No coordinate in the post\n")
    assert "(m00004)" in text  # the anti-duplicate mention tail
    # Same linkless contract as the success reply.
    assert "http" not in text and ".app" not in text and ".com" not in text
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == NO_COORD_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id == "777"


async def test_failure_reply_loop_guard_on_replies_to_the_bot(db, linked_owner):
    # The tagged tweet is itself a reply to the bot (a courtesy answer to the
    # bot's own reply auto-mentions it): the failure reply must not fire, or
    # every thanks would earn an answer forever.
    outcome, _, posted, liked = await _run(db, [NO_COORD_ID], reply_to={NO_COORD_ID: BOT_USER_ID})

    assert outcome.no_detection == 1
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == NO_COORD_ID).one()
    assert ledger.reply_tweet_id is None


@pytest.mark.parametrize("cap", ["bot_max_replies_per_hour", "bot_max_replies_per_author_per_hour"])
async def test_reply_budget_cap_skips_reply_but_detection_still_lands(
    db, linked_owner, monkeypatch, cap
):
    # Either cap spent, in total or on this one author: detection is unbilled,
    # so the detection still lands and only the gesture is skipped. The caps
    # are settings (BOT_MAX_REPLIES_PER_HOUR /
    # BOT_MAX_REPLIES_PER_AUTHOR_PER_HOUR), so an operator raises them for a
    # traffic spike without a code change.
    monkeypatch.setattr(settings, cap, 0)
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert posted == []
    assert liked == []
    assert outcome.replies_posted == 0
    assert outcome.events_created == 1


# ── The request branch ────────────────────────────────────────────────────


@pytest.fixture
def _stub_cdn(monkeypatch):
    """Serve any fetched media as a tiny mp4, so the branch runs offline.

    The bot hands ``open_request`` the same ``fetch_cdn_media`` the detections
    use, read off this module's namespace, so one patch covers both.
    """

    async def _fetch(parsed):
        return TINY_MP4, "video/mp4"

    monkeypatch.setattr("app.services.bot.fetch_cdn_media", _fetch)
    return _fetch


def _request_row(db, owner: User) -> Event:
    (row,) = db.query(Event).filter(Event.owner_id == owner.id).all()
    return row


@pytest.mark.parametrize(
    ("mention_id", "source_url"),
    [
        (MIRROR_TG_ID, _TELEGRAM_POST),
        (MIRROR_X_ID, f"https://x.com/front_owl/status/{MIRROR_X_SOURCE_ID}"),
    ],
)
async def test_a_coordinate_less_mirror_post_opens_a_request(
    db, linked_owner, _stub_cdn, mention_id, source_url
):
    """The branch, on both technologies the chase reads.

    The analyst mirrored someone else's footage and wrote no coordinate, which
    used to be a flat refusal. The row is a request the way a person's request
    is one: owned by and credited to the analyst, stamped ``requested_at``,
    carrying the original as its source and the footage as its one
    ``role=source`` media, with no coordinate. What the machine adds is the
    provenance, so a second tag recognises it.
    """
    outcome, _, posted, liked = await _run(db, [mention_id])

    assert outcome.requests_opened == 1
    assert outcome.events_created == 0
    assert outcome.replies_posted == 1
    assert liked == []

    row = _request_row(db, linked_owner)
    assert row.status == STATUS_REQUESTED
    assert row.event_coords is None
    assert row.requested_at is not None
    assert row.owner_id == linked_owner.id == row.requested_by_id
    # The chased original, never the mirroring post: the provenance link is
    # where the tag was read, the source is what it points at.
    assert row.source_url == source_url
    assert row.detected_from_url == f"https://x.com/{HANDLE}/status/{mention_id}"
    assert row.detected_via == "bot"
    assert row.detected_from_tweet_id == int(mention_id)
    assert row.detected_thread_tweet_ids == [int(mention_id)]
    # The fifth provenance column, stamped by the same helper a detection's are
    # (``events.stamp_provenance``): when the analyst posted the mirror, which is
    # neither when the event happened nor when the source posted the clip.
    assert row.detected_post_at is not None
    assert row.detected_post_at != row.source_posted_at
    # The chase served a date, so the reply carries no date warning.
    assert row.source_posted_at is not None

    (media,) = db.query(Media).filter(Media.event_id == row.id).all()
    assert media.role == "source"
    assert media.media_type == "video"

    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == mention_id).one()
    assert ledger.outcome == "requested"
    assert ledger.events_created == 0
    assert ledger.reply_tweet_id == "777"

    (payload,) = posted
    assert payload["reply"] == {"in_reply_to_tweet_id": mention_id}
    text = payload["text"]
    assert isinstance(text, str)
    assert text.startswith("\u2705 Request opened, no coordinate found \u00b7 ref ")
    assert str(row.id)[:8] in text
    assert "post date" not in text
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    # The linkless contract holds on this reply too.
    assert "http" not in text and ".app" not in text and ".com" not in text and ".me" not in text


async def test_the_same_mirror_posted_twice_opens_one_request(db, linked_owner, _stub_cdn):
    """The delete-and-repost shape, and re-tagging generally: the second mention
    matches the row the first opened (on its source, here) and the bot stays
    silent, the verdict every other dedup earns."""
    await _run(db, [MIRROR_TG_ID])
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_REPOST_ID])

    assert outcome.requests_opened == 0
    assert outcome.skipped == 1
    assert posted == []
    assert len(db.query(Event).filter(Event.owner_id == linked_owner.id).all()) == 1
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_REPOST_ID).one()
    assert ledger.outcome == "skipped"
    assert ledger.reply_tweet_id is None


async def test_a_second_owner_mirroring_the_same_clip_is_told_it_is_a_duplicate(
    db, linked_owner, other_linked_owner, _stub_cdn
):
    """The duplicate check is the detections' own, run over the request's stored
    footage.

    Two analysts mirror the same channel clip, which is what mirroring does. The
    request dedup is owner-scoped, so the second one is a row of its own, and
    the comparison that flags a detection's media flags this one's: the reply
    carries the ``duplicate_media`` sentence, from the table every surface reads.
    """
    await _run(db, [MIRROR_TG_ID])
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_OTHER_ID], handle=OTHER_HANDLE)

    assert outcome.requests_opened == 1
    row = _request_row(db, other_linked_owner)
    assert row.status == STATUS_REQUESTED
    assert row.owner_id == other_linked_owner.id

    (payload,) = posted
    text = payload["text"]
    assert WARNING_MESSAGES[DUPLICATE_MEDIA] in text
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN


async def test_a_request_shaped_post_from_an_unlinked_author_stays_silent(db, _stub_cdn):
    """The bot never mints users, and that rule is what the request branch is
    measured against too: a tag that would have opened a request, from a handle
    no account carries, is ledgered ``no_account`` and nothing else."""
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_ID])

    assert outcome.no_account == 1
    assert outcome.requests_opened == 0
    assert posted == []
    assert db.query(User).filter(User.x_handle == HANDLE).first() is None
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_ID).one()
    assert ledger.outcome == "no_account"


async def test_footage_that_will_not_fetch_falls_back_to_the_refusal(db, linked_owner, monkeypatch):
    """A request carries its poster's evidence from the start, so a footage
    fetch that comes back with nothing leaves the branch nothing to write. The
    mention then earns the answer it has always had, the \u274c reply naming
    ``coords_missing``, rather than silence."""

    async def _nothing(parsed):
        return None

    monkeypatch.setattr("app.services.bot.fetch_cdn_media", _nothing)
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_ID])

    assert outcome.requests_opened == 0
    assert outcome.no_detection == 1
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).all() == []

    (payload,) = posted
    assert payload["text"].startswith("\u274c Nothing saved\n\u26a0 No coordinate in the post\n")
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_ID).one()
    assert ledger.outcome == "no_detection"


async def test_footage_the_intake_refuses_is_named_back(db, linked_owner, _stub_cdn, monkeypatch):
    """A clip over the video size cap is not a post with no coordinate.

    The fetch succeeded and the evidence intake refused what it served, so the
    reply names ``footage_unusable`` rather than sending the analyst looking for
    a coordinate they never wrote. Nothing is left behind: the row
    ``create_request`` had staged is rolled back before the ledger commits.
    """
    monkeypatch.setattr(settings, "max_video_size", 8)
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_ID])

    assert outcome.requests_opened == 0
    assert outcome.no_detection == 1
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).all() == []

    (payload,) = posted
    assert payload["text"].startswith(
        f"\u274c Nothing saved\n\u26a0 {REFUSAL_MESSAGES[FOOTAGE_UNUSABLE]}\n"
    )
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_ID).one()
    assert ledger.outcome == "no_detection"


async def test_a_coordinate_bearing_re_tag_lands_a_detection_beside_the_request(
    db, linked_owner, _stub_cdn
):
    """The dedup contract, stated by the two tags that exercise both halves.

    A coordinate-less re-tag lands on the open request and moves nothing. A
    re-tag carrying the coordinate the analyst has since worked out is a
    geolocation, so it takes the detections' path: the match skips the
    coordinate-less request, a ``detected`` row lands beside it, and the request
    stays open and its owner's to withdraw, since no machine writes into a
    human-flow row.
    """
    await _run(db, [MIRROR_TG_ID])
    outcome, _, _, _ = await _run(db, [MIRROR_TG_GEO_ID])

    assert outcome.events_created == 1
    assert outcome.requests_opened == 0

    rows = db.query(Event).filter(Event.owner_id == linked_owner.id).all()
    assert sorted(row.status for row in rows) == [STATUS_DETECTED, STATUS_REQUESTED]
    (request_row,) = [row for row in rows if row.status == STATUS_REQUESTED]
    assert request_row.closed_at is None
    assert request_row.deleted_at is None
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_GEO_ID).one()
    assert ledger.outcome == "created"


async def test_the_reply_budget_skips_the_reply_and_keeps_the_request(
    db, linked_owner, _stub_cdn, monkeypatch
):
    """Opening a request is unbilled and the reply is not, so the same rule the
    detections follow holds here: past the cap the row lands and only the
    gesture is skipped."""
    monkeypatch.setattr(settings, "bot_max_replies_per_hour", 0)
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_ID])

    assert outcome.requests_opened == 1
    assert outcome.replies_posted == 0
    assert posted == []
    assert _request_row(db, linked_owner).status == STATUS_REQUESTED
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_ID).one()
    assert ledger.outcome == "requested"
    assert ledger.reply_tweet_id is None


async def test_self_mention_is_ledgered_so_cursor_advances(db):
    # The bot's own posts surface in its mentions timeline. They must not be
    # processed, but they MUST land in the ledger: since_id is the ledger max,
    # so an unledgered self-mention would be re-fetched (re-billed) every run.
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [{"id": NO_COORD_ID, "author_id": BOT_USER_ID, "text": "own reply"}],
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
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == NO_COORD_ID).one()
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
    unknown_id = "9100000000000000009"

    def read_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [{"id": unknown_id, "author_id": "u1", "text": "@viditbot hello"}],
                "includes": {"users": [{"id": "u1", "username": HANDLE}]},
                "meta": {},
            },
        )

    def syn_handler(_req: httpx.Request) -> httpx.Response:
        # X 5xx, so the pipeline raises and the mention ledgers ``failed``. Not
        # a 404 or a tombstone: those are the analyst's own ``no_detection``,
        # which this test already covers elsewhere.
        return httpx.Response(500)

    posted: list[dict[str, object]] = []
    liked: list[dict[str, object]] = []
    try:
        with (
            httpx.Client(transport=httpx.MockTransport(syn_handler)) as syn,
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


def test_compose_reply_is_linkless_and_carries_the_warnings():
    event_id = str(uuid.uuid4())
    text = compose_reply(
        event_id,
        detections=1,
        warnings=[SOURCE_FOOTAGE_MISSING, SOURCE_DATE_UNKNOWN, DUPLICATE_MEDIA],
    )
    assert text.startswith("✅ 1 detection saved")
    assert event_id[:8] in text
    assert event_id not in text  # the ref is shortened
    assert "No footage from the source" in text
    assert "post date" in text
    assert "already on Vidit" in text
    assert "http" not in text and "vidit.app" not in text
    # The composer's own footer, still intact: ``_within_reply_cap`` truncates
    # an over-long reply, so the cap assertion below only means something
    # paired with proof that nothing was clipped.
    assert text.endswith("Review from your profile")
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    # No warning raised, no ⚠ line: the composer decides nothing itself.
    clean = compose_reply(event_id, detections=1, warnings=[])
    assert "⚠" not in clean


def test_compose_reply_carries_one_line_per_warning_and_stays_in_the_cap():
    """One ⚠ line per raised code, in the table's order, and the heaviest reply
    the pipeline can compose still fits X's cap.

    Heaviest is four codes: ``persist_detections`` drops the footage and date
    warnings on a detection that already carries the empty-source pair, the two
    halves of that pair never co-occur, and the two footage codes are the two
    answers to one question, so no pass raises the whole vocabulary. Both
    footage codes are composed here, since the fetch-failed sentence is the
    longer of the two and is what the cap has to hold.
    """
    event_id = str(uuid.uuid4())
    for footage in (SOURCE_FOOTAGE_MISSING, SOURCE_FETCH_FAILED):
        heaviest = [
            SEVERAL_COORDINATES,
            footage,
            SOURCE_DATE_UNKNOWN,
            DUPLICATE_MEDIA,
        ]
        text = compose_reply(event_id, detections=3, warnings=heaviest)
        assert text.startswith("✅ 3 detections saved")
        assert [line for line in text.splitlines() if line.startswith("⚠")] == [
            f"⚠ {WARNING_MESSAGES[code]}" for code in heaviest
        ]
        assert text.endswith("Review from your profile")
        assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN

    ambiguous = compose_reply(event_id, detections=2, warnings=[SOURCE_AMBIGUOUS, DUPLICATE_MEDIA])
    assert "Several possible sources" in ambiguous
    assert "No footage from the source" not in ambiguous and "post date" not in ambiguous
    assert reply_weighted_len(ambiguous) <= REPLY_MAX_WEIGHTED_LEN


def test_compose_failure_reply_without_diagnosis_routes_to_the_maintainers():
    text = compose_failure_reply(mention_id="2081747867450957995")
    assert text.startswith("❌ Nothing saved\n")
    # No diagnosis to point at: the one-line format summary, no recited shape.
    assert "@vidithq" in text
    assert "http" not in text and ".app" not in text and ".com" not in text
    # Footer intact (nothing clipped by the cap backstop), then the cap.
    assert text.endswith("Guide in bio (m57995)")
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN


def test_compose_failure_reply_carries_one_diagnosis_line_per_reason():
    # Each reason yields the header, its one ⚠ diagnosis line, and the
    # footer; every variant stays linkless, unique per mention, inside the cap.
    for reason, diag in REFUSAL_MESSAGES.items():
        text = compose_failure_reply(reason, mention_id="123456789")
        first, warning, footer = text.splitlines()
        assert first == "❌ Nothing saved"
        assert warning == f"⚠ {diag}"
        assert footer == "Guide in bio (m56789)"
        assert "http" not in text and ".app" not in text and ".com" not in text
        # The intact footer above is what keeps this cap check honest: a
        # reply that outgrew the cap comes back truncated, not over-long.
        assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    assert compose_failure_reply("no_such_reason", mention_id="1").startswith("❌ Nothing saved\n")


def test_compose_failure_replies_differ_across_mentions():
    # The mention tail is the anti-duplicate: same diagnosis, two mentions,
    # two distinct texts (X 403s a tweet identical to a recent one).
    a = compose_failure_reply("coords_missing", mention_id="1111100001")
    b = compose_failure_reply("coords_missing", mention_id="2222200002")
    assert a != b


def test_compose_request_reply_carries_the_warning_and_stays_in_the_cap():
    """The request reply is the ✅ reply's twin: the same ⚠ lines from the one
    copy table, the same footer, the same cap, and no link. The date warning is
    the one a request actually raises, when the chase served no date."""
    text = compose_request_reply(
        "94183d44-1a2b-4c5d-8e9f-0a1b2c3d4e5f", warnings=[SOURCE_DATE_UNKNOWN]
    )

    assert text.startswith("✅ Request opened, no coordinate found · ref 94183d44\n")
    assert f"⚠ {WARNING_MESSAGES[SOURCE_DATE_UNKNOWN]}" in text
    assert text.endswith("Review from your profile")
    assert "94183d44-1a2b" not in text  # the shortened ref, never the full UUID
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    assert "http" not in text and ".app" not in text and ".com" not in text
