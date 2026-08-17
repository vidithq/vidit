"""Integration tests for the bot pipeline: a mention becomes a detected draft.

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
from app.models.event import STATUS_DETECTED, Event
from app.models.user import User
from app.services.bot import (
    REPLY_MAX_WEIGHTED_LEN,
    BotNotConfigured,
    compose_failure_reply,
    compose_reply,
    reply_weighted_len,
    run_bot_once,
)
from app.services.tweet_ingest import (
    DUPLICATE_MEDIA,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FOOTAGE_MISSING,
)
from app.services.tweet_ingest.syndication import _cache_clear

BOT_USER_ID = "999000"
HANDLE = f"hawk{uuid.uuid4().hex[:8]}"

FOREIGN_ID = "1930000000000000001"
PARENT_ID = "1930000000000000002"
TAGGED_ID = "1930000000000000003"
NO_COORD_ID = "1930000000000000004"
OUT_OF_BOUNDS_ID = "1930000000000000005"
COORD_ONLY_ID = "1930000000000000006"
MULTI_COORD_ID = "1930000000000000007"
AMBIGUOUS_ID = "1930000000000000008"
REPLY_BARE_ID = "1930000000000000010"
TWO_POST_PARENT_ID = "1930000000000000011"
TWO_POST_TAGGED_ID = "1930000000000000012"
TWO_POST_TAGGED_TWICE_ID = "1930000000000000013"
FOREIGN_PARENT_TAG_ID = "1930000000000000014"
RETWEET_ID = "1930000000000000015"
# The tagged post X refuses to serve unauthenticated: ``_syndication_client``
# answers the tombstone body for this id, so nothing is ever read from it. Its
# ``BODIES`` entry exists only to feed the mentions payload's ``text``.
TOMBSTONE_ID = "1930000000000000017"
SOURCE_ID = "1930000000000000042"

_SOURCE_URL = f"https://x.com/warfootage/status/{SOURCE_ID}"
_STRUCT_TEXT = (
    "@viditbot\n"
    "Strike on the vehicle depot\n"
    "48.123456, 37.654321\n"
    "https://t.co/src\n"
    "Smoke plume matches the skyline"
)
_SOURCE_ENTITIES = {"urls": [{"url": "https://t.co/src", "expanded_url": _SOURCE_URL}]}

# The chain: a foreign coordinate tweet, the analyst's own coordinate reply to
# it, and the analyst's tag on their own reply. The foreign ancestor is never
# read: the acquisition stops at the same author.
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
    },
    NO_COORD_ID: {
        "id_str": NO_COORD_ID,
        "created_at": "2026-03-11T13:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot nothing to see here",
    },
    OUT_OF_BOUNDS_ID: {
        "id_str": OUT_OF_BOUNDS_ID,
        "created_at": "2026-03-11T14:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot Geolocated 991.123456, 37.654321 somewhere",
    },
    # A post whose only line is a coordinate: a draft still lands, with an
    # empty title the analyst fills at review.
    COORD_ONLY_ID: {
        "id_str": COORD_ONLY_ID,
        "created_at": "2026-03-11T15:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot\n48.123456, 37.654321",
    },
    MULTI_COORD_ID: {
        "id_str": MULTI_COORD_ID,
        "created_at": "2026-03-11T15:30:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": (
            "@viditbot Air defence positions at 35.700886, 51.391665 "
            "and 35.800886, 51.491665 on the rooftops"
        ),
    },
    # Two candidate links: the source slot stays empty and both land as
    # mirrors, with a warning on the reply.
    AMBIGUOUS_ID: {
        "id_str": AMBIGUOUS_ID,
        "created_at": "2026-03-11T16:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot Depot strike 48.123456, 37.654321\nhttps://t.co/src\nhttps://t.co/tg",
        "entities": {
            "urls": [
                {"url": "https://t.co/src", "expanded_url": _SOURCE_URL},
                {"url": "https://t.co/tg", "expanded_url": "https://t.me/chan/42"},
            ]
        },
    },
    # A bare tag replying to the analyst's own coordinate tweet: the one hop
    # brings the parent in, so the coordinate lands under the parent's
    # provenance.
    REPLY_BARE_ID: {
        "id_str": REPLY_BARE_ID,
        "created_at": "2026-03-11T18:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot see above",
        "in_reply_to_status_id_str": PARENT_ID,
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
    # A hand-typed retweet: someone else's words, so it produces nothing.
    RETWEET_ID: {
        "id_str": RETWEET_ID,
        "created_at": "2026-03-11T20:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "RT @front_cam: Geolocated 48.123456, 37.654321 at the depot @viditbot",
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
}


def _syndication_client() -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
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


async def test_a_tagged_post_creates_a_draft(db, linked_owner):
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert outcome.events_created == 1
    assert outcome.replies_posted == 1
    # The like ack is gone: the reply is the only gesture.
    assert liked == []

    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TAGGED_ID}"
    # The title is the first line that is neither a coordinate alone nor a URL
    # alone, the bot tag having left the line it opened.
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


async def test_a_bare_tag_reads_the_same_authors_parent(db, linked_owner):
    # The one hop: the tagged post carries nothing, its author's own parent
    # carries the coordinate, and provenance anchors on that parent.
    outcome, _, posted, _ = await _run(db, [REPLY_BARE_ID])

    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{PARENT_ID}"
    assert event.title == "Geolocated 55.751200, 37.617600 near the bridge"
    # The foreign grandparent is never read, so its coordinate cannot leak.
    assert to_shape(event.event_coords).y == pytest.approx(55.7512)
    assert "11.111111" not in json.dumps(event.proof)
    (payload,) = posted
    assert payload["text"].startswith("✅ 1 geolocation draft saved")


async def test_the_two_post_field_format_lands_one_draft(db, linked_owner):
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
    # a tag on the parent itself both collapse onto the first draft.
    outcome, _, _, _ = await _run(
        db, [TWO_POST_TAGGED_ID, TWO_POST_TAGGED_TWICE_ID, TWO_POST_PARENT_ID]
    )

    assert outcome.events_created == 1
    assert outcome.skipped == 2
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 1


async def test_a_tag_under_a_foreign_parent_reads_only_the_tag(db, linked_owner):
    # The same-author guard: tagging the bot under someone else's post must not
    # read that post, whatever it contains.
    outcome, _, posted, _ = await _run(db, [FOREIGN_PARENT_TAG_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    (payload,) = posted  # the linked author still gets the diagnosis
    assert payload["text"].startswith("❌ Nothing saved\n⚠ No coordinate in the post\n")


async def test_a_coordinate_only_post_lands_a_titleless_draft(db, linked_owner):
    # No line qualifies as a title, so the analyst types one at review rather
    # than the mention being refused.
    outcome, _, _, _ = await _run(db, [COORD_ONLY_ID])

    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.title == ""


async def test_several_coordinates_land_one_draft_each_with_a_warning(db, linked_owner):
    outcome, _, posted, _ = await _run(db, [MULTI_COORD_ID])

    assert outcome.events_created == 2
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 2
    (payload,) = posted
    text = payload["text"]
    assert text.startswith("✅ 2 geolocation drafts saved")
    assert "Several coordinates, one draft each" in text


async def test_several_candidate_links_leave_the_source_empty_and_warn(db, linked_owner):
    outcome, _, posted, _ = await _run(db, [AMBIGUOUS_ID])

    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.source_url is None
    assert [link.url for link in event.source_links] == [_SOURCE_URL, "https://t.me/chan/42"]
    (payload,) = posted
    assert "Several possible sources" in payload["text"]


async def test_a_retweet_produces_nothing(db, linked_owner):
    # A hand-typed retweet carries someone else's words, on every entry.
    outcome, _, posted, _ = await _run(db, [RETWEET_ID])

    assert outcome.no_detection == 1
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 0
    (payload,) = posted
    assert payload["text"].startswith("❌ Nothing saved\n⚠ No coordinate in the post\n")


async def test_an_out_of_bounds_coordinate_is_named_as_such(db, linked_owner):
    outcome, _, posted, _ = await _run(db, [OUT_OF_BOUNDS_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    (payload,) = posted
    assert payload["text"].startswith("❌ Nothing saved\n⚠ Coordinate out of bounds\n")


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
    unknown_id = "1930000000000000009"

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
        drafts=1,
        warnings=[SOURCE_FOOTAGE_MISSING, SOURCE_DATE_UNKNOWN, DUPLICATE_MEDIA],
    )
    assert text.startswith("✅ 1 geolocation draft saved")
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
    clean = compose_reply(event_id, drafts=1, warnings=[])
    assert "⚠" not in clean


def test_compose_reply_carries_one_line_per_warning_and_stays_in_the_cap():
    """One ⚠ line per raised code, in the table's order, and the heaviest reply
    the pipeline can compose still fits X's cap.

    Heaviest is the four below: ``persist_drafts`` drops the footage and date
    warnings on a draft that already carries the empty-source pair, and the two
    halves of that pair never co-occur, so no pass raises all six codes.
    """
    from app.services.bot import _WARNING_LINES

    event_id = str(uuid.uuid4())
    heaviest = [
        SEVERAL_COORDINATES,
        SOURCE_FOOTAGE_MISSING,
        SOURCE_DATE_UNKNOWN,
        DUPLICATE_MEDIA,
    ]
    text = compose_reply(event_id, drafts=3, warnings=heaviest)
    assert text.startswith("✅ 3 geolocation drafts saved")
    assert [line for line in text.splitlines() if line.startswith("⚠")] == [
        _WARNING_LINES[code] for code in heaviest
    ]
    assert text.endswith("Review from your profile")
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN

    ambiguous = compose_reply(event_id, drafts=2, warnings=[SOURCE_AMBIGUOUS, DUPLICATE_MEDIA])
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
    from app.services.bot import _FAILURE_DIAGNOSES

    for reason, diag in _FAILURE_DIAGNOSES.items():
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
