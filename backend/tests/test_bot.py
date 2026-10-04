"""Integration tests for the bot pipeline: a mention becomes a detection.

Every X surface is mocked through ``MockTransport`` (syndication by tweet id,
the paid mentions read, the reply write); the DB and the assemble step are
real. The grammar itself is pinned by ``tests/ingest_contract``.
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
    REQUEST_NOT_POSSIBLE,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    WARNING_MESSAGES,
    tags_bot,
)
from app.services.tweet_ingest.syndication import _cache_clear
from app.services.tweet_ingest.urls import TELEGRAM_HOST_RE
from tests._fixtures import TINY_MP4
from tests.ingest_contract.loader import load_body, load_chased, load_embed, load_expected

BOT_USER_ID = "999000"
HANDLE = f"hawk{uuid.uuid4().hex[:8]}"
OTHER_HANDLE = f"kite{uuid.uuid4().hex[:8]}"

# Mention ids sit above any snowflake X will mint this century: the poll's
# ``since_id`` is the ledger max over the whole table, so a real mention left
# in a shared dev database would starve the cursor tests.
FOREIGN_ID = "9100000000000000001"
TAGGED_ID = "9100000000000000003"
NO_COORD_ID = "9100000000000000004"
TWO_POST_PARENT_ID = "9100000000000000011"
TWO_POST_TAGGED_ID = "9100000000000000012"
TWO_POST_TAGGED_TWICE_ID = "9100000000000000013"
FOREIGN_PARENT_TAG_ID = "9100000000000000014"
# The tagged post X refuses to serve unauthenticated: the mock answers the tombstone.
TOMBSTONE_ID = "9100000000000000017"
# A colleague's post tagging the bot, the analyst's reply under it (X opens it
# with the parent's mentions), and the same with the tag typed after the analyst's words.
INHERITED_PARENT_ID = "9100000000000000021"
INHERITED_REPLY_ID = "9100000000000000022"
TYPED_UNDER_FOREIGN_ID = "9100000000000000023"
# The bare tag under the analyst's own coordinate post (parent tags nobody): typed.
BARE_TAG_ID = "9100000000000000024"
# The analyst's follow-up under their own tagging post: the tag came with the prefix.
OWN_FOLLOW_UP_ID = "9100000000000000025"
# A reply whose parent syndication serves to nobody.
ORPHAN_REPLY_ID = "9100000000000000026"
# Absent from ``BODIES``, so the mock answers 404.
UNREADABLE_PARENT_ID = "9100000000000000027"
SOURCE_ID = "9100000000000000042"
# Request branch: a mirror post with footage and no coordinate. REPOST is the
# same mirror posted twice, OTHER a second analyst mirroring the same clip.
MIRROR_TG_ID = "9110000000000000001"
MIRROR_TG_REPOST_ID = "9110000000000000002"
MIRROR_X_ID = "9110000000000000003"
MIRROR_X_SOURCE_ID = "9110000000000000004"
MIRROR_TG_OTHER_ID = "9110000000000000005"
# The same mirror re-posted with a coordinate (a geolocation).
MIRROR_TG_GEO_ID = "9110000000000000006"
# The mirror naming a host the chase does not read, with and without the analyst's own clip.
MIRROR_YT_ID = "9110000000000000007"
MIRROR_YT_NO_VIDEO_ID = "9110000000000000008"

# Mirror posts and the Telegram embed come from the contract catalogue; only
# id, date, handle and bot tag are overridden.
_MIRROR_TYPOLOGY = "mirror_telegram_no_coord"
_MIRROR_BODY = load_body(_MIRROR_TYPOLOGY)
_TELEGRAM_POST = _MIRROR_BODY["entities"]["urls"][0]["expanded_url"]
_MIRROR_X_TYPOLOGY = "mirror_x_status_no_coord"
_MIRROR_X_BODY = load_body(_MIRROR_X_TYPOLOGY)
_MIRROR_X_SOURCE_BODY = load_chased(
    _MIRROR_X_TYPOLOGY, load_expected(_MIRROR_X_TYPOLOGY)["chased_status_id"]
)
_MIRROR_OTHER_TYPOLOGY = "mirror_other_host_no_coord"
_MIRROR_OTHER_BODY = load_body(_MIRROR_OTHER_TYPOLOGY)
_OTHER_HOST_SOURCE = _MIRROR_OTHER_BODY["entities"]["urls"][0]["expanded_url"]


def _telegram_embed() -> str:
    """The catalogue's Telegram embed. Raises so a typology without one fails loudly here."""
    embed = load_embed(_MIRROR_TYPOLOGY)
    if embed is None:
        raise RuntimeError(f"{_MIRROR_TYPOLOGY} ships no embed.html")
    return embed


def _mirror_body(tweet_id: str, created_at: str, handle: str = HANDLE) -> dict:
    """The catalogue's mirror post, re-anchored on one mention."""
    return {
        **_MIRROR_BODY,
        "id_str": tweet_id,
        "created_at": created_at,
        "user": {"screen_name": handle},
        "text": f"@viditbot\n{_MIRROR_BODY['text']}",
    }


def _other_host_mirror(tweet_id: str, created_at: str, *, with_video: bool) -> dict:
    """The catalogue's other-host mirror; ``with_video=False`` drops the only footage it offers."""
    body = {
        **_MIRROR_OTHER_BODY,
        "id_str": tweet_id,
        "created_at": created_at,
        "user": {"screen_name": HANDLE},
        "text": f"@viditbot\n{_MIRROR_OTHER_BODY['text']}",
    }
    if not with_video:
        del body["mediaDetails"]
    return body


_SOURCE_URL = f"https://x.com/warfootage/status/{SOURCE_ID}"
_STRUCT_TEXT = (
    "@viditbot\n"
    "Strike on the vehicle depot\n"
    "48.123456, 37.654321\n"
    "https://t.co/src\n"
    "Smoke plume matches the skyline"
)
_SOURCE_ENTITIES = {"urls": [{"url": "https://t.co/src", "expanded_url": _SOURCE_URL}]}

# The foreign post is never read: acquisition stops at the same author.
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
    # Two-post format. Media-less: the assemble step's CDN fetch opens a real
    # socket (the media split is unit-tested in test_detect.py).
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
    # Tagged under someone else's post: acquisition must not join that parent.
    FOREIGN_PARENT_TAG_ID: {
        "id_str": FOREIGN_PARENT_TAG_ID,
        "created_at": "2026-03-11T19:15:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot relay this",
        "in_reply_to_status_id_str": FOREIGN_ID,
    },
    # A readable post whose own body X will not serve: the tombstone alone must stop it.
    TOMBSTONE_ID: {
        "id_str": TOMBSTONE_ID,
        "created_at": "2026-03-11T21:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": _STRUCT_TEXT,
        "entities": _SOURCE_ENTITIES,
    },
    # A colleague's tagging post and the analyst's reply: X wrote the first four
    # mentions (bot third), the analyst only the sentence after, with no coordinate.
    INHERITED_PARENT_ID: {
        "id_str": INHERITED_PARENT_ID,
        "created_at": "2026-03-13T08:00:00.000Z",
        "user": {"screen_name": "other_analyst"},
        "text": "@viditbot 48.123456, 37.654321 depot strike",
    },
    INHERITED_REPLY_ID: {
        "id_str": INHERITED_REPLY_ID,
        "created_at": "2026-03-13T08:05:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": (
            "@other_analyst @geoconfirmed @viditbot @uacontrolmap "
            "The guy who opens the window is on the third floor"
        ),
        "in_reply_to_status_id_str": INHERITED_PARENT_ID,
    },
    # Same position, with the tag typed after the analyst's geolocation.
    TYPED_UNDER_FOREIGN_ID: {
        "id_str": TYPED_UNDER_FOREIGN_ID,
        "created_at": "2026-03-13T08:10:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": (
            "@other_analyst Strike on the vehicle depot\n"
            "48.123456, 37.654321\n"
            "https://t.co/src\n"
            "@ViditBot"
        ),
        "entities": _SOURCE_ENTITIES,
        "in_reply_to_status_id_str": INHERITED_PARENT_ID,
    },
    # Bare tag under the analyst's own coordinate post: it climbs.
    BARE_TAG_ID: {
        "id_str": BARE_TAG_ID,
        "created_at": "2026-03-13T08:15:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@ViditBot",
        "in_reply_to_status_id_str": TWO_POST_PARENT_ID,
    },
    OWN_FOLLOW_UP_ID: {
        "id_str": OWN_FOLLOW_UP_ID,
        "created_at": "2026-03-13T08:20:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@viditbot one more angle on it",
        "in_reply_to_status_id_str": TAGGED_ID,
    },
    ORPHAN_REPLY_ID: {
        "id_str": ORPHAN_REPLY_ID,
        "created_at": "2026-03-13T08:25:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "@other_analyst @viditbot agreed, that is the tower",
        "in_reply_to_status_id_str": UNREADABLE_PARENT_ID,
    },
    SOURCE_ID: {
        "id_str": SOURCE_ID,
        "created_at": "2026-03-10T09:00:00.000Z",
        "user": {"screen_name": "warfootage"},
        "text": "original footage",
    },
    MIRROR_TG_ID: _mirror_body(MIRROR_TG_ID, "2026-03-12T08:30:00.000Z"),
    MIRROR_TG_REPOST_ID: _mirror_body(MIRROR_TG_REPOST_ID, "2026-03-12T08:45:00.000Z"),
    MIRROR_TG_OTHER_ID: _mirror_body(
        MIRROR_TG_OTHER_ID, "2026-03-12T09:10:00.000Z", handle=OTHER_HANDLE
    ),
    MIRROR_TG_GEO_ID: {
        **_mirror_body(MIRROR_TG_GEO_ID, "2026-03-14T11:00:00.000Z"),
        "text": f"@viditbot\n{_MIRROR_BODY['text']}\n48.123456, 37.654321",
    },
    # Other-host mirror: with the analyst's upload, then without.
    MIRROR_YT_ID: _other_host_mirror(MIRROR_YT_ID, "2026-03-12T10:00:00.000Z", with_video=True),
    MIRROR_YT_NO_VIDEO_ID: _other_host_mirror(
        MIRROR_YT_NO_VIDEO_ID, "2026-03-12T10:30:00.000Z", with_video=False
    ),
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
    MIRROR_X_SOURCE_ID: {**_MIRROR_X_SOURCE_BODY, "id_str": MIRROR_X_SOURCE_ID},
}


def _syndication_client(fetched: list[str] | None = None) -> httpx.Client:
    """``fetched`` records every post id syndication was asked for, in order."""

    def handler(req: httpx.Request) -> httpx.Response:
        if TELEGRAM_HOST_RE.match(req.url.host.lower()) is not None:
            # One client carries both upstreams, as in production.
            return httpx.Response(200, text=_telegram_embed())
        tweet_id = req.url.params.get("id", "")
        if fetched is not None:
            fetched.append(tweet_id)
        if tweet_id == TOMBSTONE_ID:
            # X's 200-with-no-tweet for a login-gated post (age-restricted, withheld).
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
    parent_of: dict[str, str] | None = None,
) -> httpx.Client:
    """The paid mentions read, every mention authored by ``handle``.

    ``parent_of`` maps a mention id to its ``referenced_tweets`` parent; absent means not a reply.
    """

    def handler(req: httpx.Request) -> httpx.Response:
        seen_params.append(dict(req.url.params))
        data: list[dict[str, object]] = []
        for mid in mention_ids:
            entry: dict[str, object] = {
                "id": mid,
                "author_id": "u1",
                "text": BODIES[mid]["text"],
            }
            if reply_to and mid in reply_to:
                entry["in_reply_to_user_id"] = reply_to[mid]
            if parent_of and mid in parent_of:
                entry["referenced_tweets"] = [{"type": "replied_to", "id": parent_of[mid]}]
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
    """``liked`` captures calls to the likes endpoint; tests assert it stays empty."""

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
    """A live account whose ``x_handle`` is linked to ``handle`` (the bot never mints users)."""
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
    """A second linked analyst: request dedup is owner-scoped."""
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
    db,
    mention_ids,
    seen_params=None,
    posted=None,
    liked=None,
    reply_to=None,
    handle=HANDLE,
    parent_of=None,
    fetched=None,
):
    seen_params = seen_params if seen_params is not None else []
    posted = posted if posted is not None else []
    liked = liked if liked is not None else []
    with (
        _syndication_client(fetched) as syn,
        _mentions_client(mention_ids, seen_params, reply_to, handle, parent_of) as read,
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
    assert liked == []

    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.status == STATUS_DETECTED
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TAGGED_ID}"
    # The title is the first line with text beyond coordinates and links.
    assert event.title == "Strike on the vehicle depot"
    point = to_shape(event.event_coords)
    assert point.y == pytest.approx(48.123456)
    assert point.x == pytest.approx(37.654321)
    assert event.source_url == _SOURCE_URL
    assert event.source_posted_at is not None
    assert event.source_posted_at.date().isoformat() == "2026-03-10"

    # The proof is the post as written, minus the bot tag and media wrappers.
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
    # No media, so the footage warning fires; the date resolved, so that one does not.
    assert "The source served no footage" in text
    assert "post date" not in text and "already on Vidit" not in text
    # No auto-linkable URL in the reply.
    assert "http" not in text and ".app" not in text and ".com" not in text


async def test_the_two_post_field_format_lands_one_detection(db, linked_owner):
    # The TikTok link is outside the chase vocabulary: stored link-only, with
    # provenance anchored on the parent.
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
    assert "post date" in payload["text"]


async def test_tagging_either_post_shares_the_parent_idempotency_key(db, linked_owner):
    # detected_from_url anchors on the parent, so a second tag and a tag on the
    # parent both collapse onto the first detection and overwrite it (``updated``, not ``skipped``).
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
    # Same-author guard: the foreign post is never read.
    outcome, _, posted, _ = await _run(db, [FOREIGN_PARENT_TAG_ID])

    assert outcome.no_detection == 1
    assert outcome.events_created == 0
    (payload,) = posted  # the linked author still gets the diagnosis
    assert payload["text"].startswith("❌ Nothing saved\n⚠ No coordinate in the post\n")


async def test_tombstoned_tagged_post_earns_a_reply_not_a_page(db, linked_owner, monkeypatch):
    """A tombstoned tagged post ledgers ``no_detection``; the author gets a reply
    naming the restriction and Sentry hears nothing."""
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
    # Resumed from the ledger max minus the lookback overlap.
    expected = str(int(TAGGED_ID) - bot_service._SINCE_ID_OVERLAP)
    assert seen_params[0]["since_id"] == expected
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 1


async def test_poll_overlap_recovers_mention_dropped_by_webhook(db, linked_owner):
    # The webhook dropped TAGGED_ID, so the ledger max leapfrogged it; since_id
    # sits one overlap behind the max and recovers it.
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
    # No account carries HANDLE: ledgered only.
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
    """A post whose every detection raised mid-persist ledgers ``failed``; the bot
    answers with the generic reply pointing at the maintainers."""
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
    # No linked account: no failure reply, no like.
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
    assert "http" not in text and ".app" not in text and ".com" not in text
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == NO_COORD_ID).one()
    assert ledger.outcome == "no_detection"
    assert ledger.reply_tweet_id == "777"


async def test_failure_reply_loop_guard_on_replies_to_the_bot(db, linked_owner):
    # The tagged tweet is a reply to the bot; a failure reply would loop on every thanks.
    outcome, _, posted, liked = await _run(db, [NO_COORD_ID], reply_to={NO_COORD_ID: BOT_USER_ID})

    assert outcome.no_detection == 1
    assert posted == []
    assert liked == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == NO_COORD_ID).one()
    assert ledger.reply_tweet_id is None


@pytest.mark.parametrize(
    ("text", "is_reply", "typed"),
    [
        # Not a reply: X wrote no prefix, so every mention is the author's.
        ("@other_analyst @viditbot look at this", False, True),
        # The field shape: four carried mentions, the bot third, then the analyst's sentence.
        (
            "@other_analyst @geoconfirmed @viditbot @uacontrolmap "
            "The guy who opens the window is on the third floor",
            True,
            False,
        ),
        # The run reads across newlines as well as spaces.
        ("@other_analyst\n@viditbot\nagreed", True, False),
        # The whole text is the run: the parent settles it.
        ("@other_analyst @viditbot", True, False),
        ("@viditbot", True, False),
        # A mention in the middle of the text, and one at the end: the author
        # typed both.
        ("@other_analyst agreed @viditbot, that is the tower", True, True),
        ("@other_analyst that is the tower @viditbot", True, True),
        # Case is X's to render.
        ("@other_analyst the depot @ViditBot", True, True),
        ("@ViditBot @other_analyst the depot", True, False),
        # The dot-mention: X never writes a period into a prefix, so it ends the run.
        (".@ViditBot 48.123456, 37.654321", True, True),
        # Somebody else's handle, whatever its position.
        ("@other_analyst @uacontrolmap the depot", True, False),
        ("", True, False),
    ],
)
def test_tags_bot_reads_who_typed_the_tag(text, is_reply, typed):
    assert tags_bot(text, "viditbot", inherits_prefix=is_reply) is typed


def test_tags_bot_without_the_prefix_rule_answers_the_parent_question():
    # Asks whether the parent mentions the bot anywhere, its own inherited prefix included.
    assert tags_bot("@other_analyst @viditbot relayed", "viditbot", inherits_prefix=False) is True
    assert tags_bot("48.123456, 37.654321 depot", "viditbot", inherits_prefix=False) is False


async def test_a_reply_that_only_inherits_the_tag_is_not_a_mention(db, linked_owner):
    # A colleague's post tagged the bot and X opened the analyst's reply with its
    # mentions; no coordinate in the thread. That must not earn a ❌ for a tag they never typed.
    fetched: list[str] = []
    outcome, _, posted, liked = await _run(
        db,
        [INHERITED_REPLY_ID],
        parent_of={INHERITED_REPLY_ID: INHERITED_PARENT_ID},
        fetched=fetched,
    )

    assert outcome.inherited == 1
    assert outcome.no_detection == 0
    assert outcome.events_created == 0
    assert posted == []
    assert liked == []
    # One syndication read (the parent's), no billed call.
    assert fetched == [INHERITED_PARENT_ID]
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).count() == 0
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == INHERITED_REPLY_ID).one()
    assert ledger.outcome == "inherited"
    assert ledger.reply_tweet_id is None


async def test_a_tag_typed_under_someone_elses_post_is_processed(db, linked_owner):
    # Tag typed after the analyst's words: read as a tag; the foreign parent joins nothing.
    outcome, _, posted, _ = await _run(
        db,
        [TYPED_UNDER_FOREIGN_ID],
        parent_of={TYPED_UNDER_FOREIGN_ID: INHERITED_PARENT_ID},
    )

    assert outcome.inherited == 0
    assert outcome.events_created == 1
    assert outcome.replies_posted == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TYPED_UNDER_FOREIGN_ID}"
    point = to_shape(event.event_coords)
    assert point.y == pytest.approx(48.123456)
    ledger = (
        db.query(BotMention).filter(BotMention.mention_tweet_id == TYPED_UNDER_FOREIGN_ID).one()
    )
    assert ledger.outcome == "created"
    assert posted


async def test_a_bare_tag_under_an_untagged_parent_still_climbs(db, linked_owner):
    # A bare tag under the analyst's own geolocation: the parent tags nobody, so
    # the tag is typed and the climb re-anchors on the coordinate post.
    outcome, _, posted, _ = await _run(
        db, [BARE_TAG_ID], parent_of={BARE_TAG_ID: TWO_POST_PARENT_ID}
    )

    assert outcome.inherited == 0
    assert outcome.events_created == 1
    event = db.query(Event).filter(Event.owner_id == linked_owner.id).one()
    assert event.detected_from_url == f"https://x.com/{HANDLE}/status/{TWO_POST_PARENT_ID}"
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == BARE_TAG_ID).one()
    assert ledger.outcome == "created"
    assert posted


async def test_a_follow_up_under_the_analysts_own_tagged_post_inherits(db, linked_owner):
    # The post above already tagged the bot and was answered: this prefix is not a second tag.
    outcome, _, posted, _ = await _run(
        db, [OWN_FOLLOW_UP_ID], parent_of={OWN_FOLLOW_UP_ID: TAGGED_ID}
    )

    assert outcome.inherited == 1
    assert outcome.events_created == 0
    assert posted == []
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == OWN_FOLLOW_UP_ID).one()
    assert ledger.outcome == "inherited"


async def test_an_unreadable_parent_reads_as_an_inherited_tag(db, linked_owner):
    # Parent deleted or protected: silence beats a ❌ for a tag that may not have been meant.
    fetched: list[str] = []
    outcome, _, posted, _ = await _run(
        db,
        [ORPHAN_REPLY_ID],
        parent_of={ORPHAN_REPLY_ID: UNREADABLE_PARENT_ID},
        fetched=fetched,
    )

    assert outcome.inherited == 1
    assert posted == []
    assert fetched == [UNREADABLE_PARENT_ID]
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == ORPHAN_REPLY_ID).one()
    assert ledger.outcome == "inherited"


@pytest.mark.parametrize("cap", ["bot_max_replies_per_hour", "bot_max_replies_per_author_per_hour"])
async def test_reply_budget_cap_skips_reply_but_detection_still_lands(
    db, linked_owner, monkeypatch, cap
):
    # Either cap spent: detection is unbilled, so it still lands and only the gesture is skipped.
    monkeypatch.setattr(settings, cap, 0)
    outcome, _, posted, liked = await _run(db, [TAGGED_ID])

    assert posted == []
    assert liked == []
    assert outcome.replies_posted == 0
    assert outcome.events_created == 1


@pytest.fixture
def _stub_cdn(monkeypatch):
    """Serve any fetched media as a tiny mp4 so the branch runs offline."""

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
    """The branch on both chase technologies.

    The row is owned by the analyst, stamped ``requested_at``, carries the
    original as source and the footage as its one ``role=source`` media, with
    no coordinate. Provenance lets a second tag recognise it.
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
    # The chased original, not the mirroring post.
    assert row.source_url == source_url
    assert row.detected_from_url == f"https://x.com/{HANDLE}/status/{mention_id}"
    assert row.detected_via == "bot"
    assert row.detected_from_tweet_id == int(mention_id)
    assert row.detected_thread_tweet_ids == [int(mention_id)]
    # Fifth provenance column (``events.stamp_provenance``): when the analyst posted the mirror.
    assert row.detected_post_at is not None
    assert row.detected_post_at != row.source_posted_at
    # The chase served a date: no date warning.
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
    assert text.startswith("\u2705 Geolocation request opened \u00b7 ref ")
    assert str(row.id)[:8] in text
    assert "post date" not in text
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    assert "http" not in text and ".app" not in text and ".com" not in text and ".me" not in text


async def test_the_same_mirror_posted_twice_opens_one_request(db, linked_owner, _stub_cdn):
    """A repost matches the row the first mention opened (on its source); the bot stays silent."""
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
    """Two analysts mirroring one clip get a row each (dedup is owner-scoped), and
    the reply carries ``duplicate_media``."""
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
    """A request-shaped tag from an unlinked handle is ledgered ``no_account`` and nothing else."""
    outcome, _, posted, _ = await _run(db, [MIRROR_TG_ID])

    assert outcome.no_account == 1
    assert outcome.requests_opened == 0
    assert posted == []
    assert db.query(User).filter(User.x_handle == HANDLE).first() is None
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_TG_ID).one()
    assert ledger.outcome == "no_account"


async def test_footage_that_will_not_fetch_falls_back_to_the_refusal(db, linked_owner, monkeypatch):
    """A footage fetch that returns nothing falls back to the ❌ ``coords_missing`` reply, not silence."""

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


async def test_a_mirror_of_a_clip_on_another_host_opens_a_request(db, linked_owner, _stub_cdn):
    """The analyst's upload is the footage; nothing chased the video, so the reply warns of the missing source date."""
    outcome, _, posted, _ = await _run(db, [MIRROR_YT_ID])

    assert outcome.requests_opened == 1
    row = _request_row(db, linked_owner)
    assert row.status == STATUS_REQUESTED
    assert row.source_url == _OTHER_HOST_SOURCE
    assert row.source_posted_at is None

    (media,) = db.query(Media).filter(Media.event_id == row.id).all()
    assert media.role == "source"
    assert media.media_type == "video"

    (payload,) = posted
    text = payload["text"]
    assert isinstance(text, str)
    assert text.startswith("\u2705 Geolocation request opened \u00b7 ref ")
    assert WARNING_MESSAGES[SOURCE_DATE_UNKNOWN] in text
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_YT_ID).one()
    assert ledger.outcome == "requested"


async def test_a_mirror_carrying_no_clip_of_its_own_is_told_to_attach_one(
    db, linked_owner, _stub_cdn
):
    """A YouTube mirror without the upload: ``coords_missing`` would send the
    analyst hunting for a coordinate they did not write, so the reply names what to attach."""
    outcome, _, posted, _ = await _run(db, [MIRROR_YT_NO_VIDEO_ID])

    assert outcome.requests_opened == 0
    assert outcome.no_detection == 1
    assert db.query(Event).filter(Event.owner_id == linked_owner.id).all() == []

    (payload,) = posted
    text = payload["text"]
    assert isinstance(text, str)
    assert text.startswith(
        f"\u274c Nothing saved\n\u26a0 {REFUSAL_MESSAGES[REQUEST_NOT_POSSIBLE]}\n"
    )
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    ledger = db.query(BotMention).filter(BotMention.mention_tweet_id == MIRROR_YT_NO_VIDEO_ID).one()
    assert ledger.outcome == "no_detection"


async def test_footage_the_intake_refuses_is_named_back(db, linked_owner, _stub_cdn, monkeypatch):
    """A clip over the video size cap names ``footage_unusable``; the staged row is rolled back before the ledger commits."""
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
    """A coordinate-less re-tag lands on the open request and moves nothing.

    A re-tag with a coordinate is a geolocation: it takes the detections' path
    and lands a ``detected`` row beside the request, which stays its owner's.
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
    """Opening a request is unbilled: past the reply cap the row lands and only the gesture is skipped."""
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
    # The bot's own posts are ledgered, not processed: since_id is the ledger
    # max, so an unledgered self-mention is re-fetched (re-billed) every run.
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
    # While the webhook is live, a mention the poll processes fresh means the webhook missed it: page.
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
    # Every fresh verdict is a gap, including a mention whose pipeline raised.
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
        # X 5xx: the pipeline raises and the mention ledgers ``failed`` (a 404 or tombstone is ``no_detection``).
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
    assert "The source served no footage" in text
    assert "post date" in text
    assert "already on Vidit" in text
    assert "http" not in text and "vidit.app" not in text
    # Footer intact: ``_within_reply_cap`` truncates, so the cap check needs proof nothing was clipped.
    assert text.endswith("Review from your profile")
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    clean = compose_reply(event_id, detections=1, warnings=[])
    assert "⚠" not in clean


def test_compose_reply_carries_one_line_per_warning_and_stays_in_the_cap():
    """One ⚠ line per raised code, in table order, and the heaviest reply fits X's cap.

    Heaviest is four codes: the footage codes answer one question and the
    empty-source pair never co-occur. Both footage codes are composed because
    the fetch-failed sentence is the longer one.
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
    assert "The source served no footage" not in ambiguous and "post date" not in ambiguous
    assert reply_weighted_len(ambiguous) <= REPLY_MAX_WEIGHTED_LEN


def test_compose_failure_reply_without_diagnosis_routes_to_the_maintainers():
    text = compose_failure_reply(mention_id="2081747867450957995")
    assert text.startswith("❌ Nothing saved\n")
    assert "@vidithq" in text
    assert "http" not in text and ".app" not in text and ".com" not in text
    # Footer intact, then the cap.
    assert text.endswith("Guide in bio (m57995)")
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN


def test_compose_failure_reply_carries_one_diagnosis_line_per_reason():
    # Header, one ⚠ diagnosis line and footer; linkless, unique per mention, inside the cap.
    for reason, diag in REFUSAL_MESSAGES.items():
        text = compose_failure_reply(reason, mention_id="123456789")
        first, warning, footer = text.splitlines()
        assert first == "❌ Nothing saved"
        assert warning == f"⚠ {diag}"
        assert footer == "Guide in bio (m56789)"
        assert "http" not in text and ".app" not in text and ".com" not in text
        # The intact footer keeps this honest: an over-cap reply comes back truncated.
        assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    assert compose_failure_reply("no_such_reason", mention_id="1").startswith("❌ Nothing saved\n")


def test_compose_failure_replies_differ_across_mentions():
    # Same diagnosis, two distinct texts (X 403s a tweet identical to a recent one).
    a = compose_failure_reply("coords_missing", mention_id="1111100001")
    b = compose_failure_reply("coords_missing", mention_id="2222200002")
    assert a != b


def test_compose_request_reply_carries_the_warning_and_stays_in_the_cap():
    """The request reply carries the same ⚠ lines, footer and cap as the ✅ reply, with no link."""
    text = compose_request_reply(
        "94183d44-1a2b-4c5d-8e9f-0a1b2c3d4e5f", warnings=[SOURCE_DATE_UNKNOWN]
    )

    assert text.startswith("✅ Geolocation request opened · ref 94183d44\n")
    assert f"⚠ {WARNING_MESSAGES[SOURCE_DATE_UNKNOWN]}" in text
    assert text.endswith("Edit it from your profile")
    assert "94183d44-1a2b" not in text  # the shortened ref, never the full UUID
    assert reply_weighted_len(text) <= REPLY_MAX_WEIGHTED_LEN
    assert "http" not in text and ".app" not in text and ".com" not in text
