"""The @ViditBot pipeline — a tag on X becomes a ``detected`` draft + a reply.

An analyst tags the bot on the tweet that carries the coordinate. One run:

1. pulls the bot's mentions since the last processed id (``services/x_api``,
   the only paid X surface),
2. rebuilds each tagged tweet's *self*-thread through the free syndication
   path (see :func:`_self_thread_records`),
3. runs the shared detection spine (``stitch → detect``) and persists through
   ``assemble_detections``, owned by the existing Vidit account whose
   admin-linked ``x_handle`` matches the tagged author (the bot never mints
   users: an unknown handle is ledgered ``no_account`` and produces nothing),
4. replies in-thread with a bare event ref plus warnings, then records the
   mention in the ``bot_mentions`` ledger.

The ledger row is written whatever the outcome, so a mention is processed
(and billed) at most once; ``since_id`` derives from the ledger, so a fresh
run resumes exactly where the last one stopped.

Reply policy: the bot replies only when a draft was actually created. A
mention that yields nothing (no coordinate, or all duplicates) is recorded
silently — replying to it would make every courtesy answer to the bot's own
reply (which auto-mentions the bot) trigger another reply, a loop. Reply text
is linkless by contract (a URL 13x's the per-post price; the clickable link
lives in the bot bio) — ``compose_reply`` owns that invariant.
"""

from __future__ import annotations

import dataclasses
import logging
from dataclasses import dataclass

import httpx
import sentry_sdk
from sqlalchemy import Numeric, cast, func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.bot_mention import BotMention, BotMentionOutcome
from app.models.event import Event
from app.models.media import Media
from app.models.user import User
from app.services.detection import assemble_detections
from app.services.tweet_ingest import (
    TweetImportError,
    TweetRecord,
    detect,
    fetch_cdn_media,
    record_from_syndication,
    stitch,
)
from app.services.x_api import Mention, XApiError, fetch_mentions, post_reply

logger = logging.getLogger(__name__)

# Bound on the parent chase: each hop is one syndication fetch, and a
# legitimate self-thread deeper than this is vanishingly rare. Past the cap
# the walk stops and the thread is what was gathered so far.
_MAX_PARENT_WALK = 10

# X's classic post length. Replies are composed under it and hard-truncated
# as a belt: an over-long reply would 403 the (billed) create call. The cap
# counts Python code points while X counts weighted characters (the ⚠ glyph
# weighs 2), so composed text must stay well under it — today's worst case is
# ~210 code points / ~215 weighted.
_REPLY_MAX_CHARS = 280

# Billed-spend ceilings on the write side. The mention surface is public: any
# stranger can tag the bot on a coordinate tweet, and each created draft costs
# one billed reply. A pass posts at most this many replies in total and per
# author; past a ceiling the draft still lands (detection is unbilled) but the
# reply is skipped and logged — a flood burns nothing but its own posting
# effort.
_MAX_REPLIES_PER_PASS = 20
_MAX_REPLIES_PER_AUTHOR_PER_PASS = 3


class BotNotConfigured(RuntimeError):
    """The mentions-read credentials are absent — the runner cannot start."""


@dataclass
class BotRunOutcome:
    """What one bot pass did, for the runner's log line."""

    mentions_seen: int = 0
    already_handled: int = 0
    events_created: int = 0
    replies_posted: int = 0
    no_detection: int = 0
    no_account: int = 0
    skipped: int = 0
    failed: int = 0


def _self_thread_records(
    mention: Mention, *, client: httpx.Client | None = None
) -> list[TweetRecord]:
    """The tagged tweet plus its same-author ancestors, one fetch per hop.

    The archive's self-threads are safe by construction (the export holds only
    the analyst's own tweets); the bot has no such guarantee — its only source
    is syndication walked one parent at a time. So each parent is fetched and
    its author checked explicitly, and the walk stops at the first author that
    differs from the tagged tweet's, *before* that parent's text is folded in
    (the no-cross-author-rollup rule, see docs/ingestion.md). A parent that
    fails to fetch also stops the walk: the thread gathered so far still
    processes.
    """
    tagged = record_from_syndication(
        f"https://x.com/{mention.author_handle}/status/{mention.tweet_id}",
        client=client,
    )
    records = [tagged]
    author = tagged.handle.lower()
    current = tagged
    for _ in range(_MAX_PARENT_WALK):
        parent_id = current.in_reply_to_status_id
        if parent_id is None:
            break
        try:
            parent = record_from_syndication(
                f"https://x.com/i/web/status/{parent_id}", client=client
            )
        except TweetImportError:
            break
        if parent.handle.lower() != author:
            # Also covers the degraded case where the syndication body carried
            # no screen_name (handle stays the "i" URL sentinel): the author
            # is never "i", so the walk stops rather than fold in a record it
            # can't attribute.
            break
        # The /i/web/ acquire canonicalised a handle-less permalink; the
        # response carried the real handle (it passed the author check), so
        # rebuild the canonical form — the head's permalink anchors
        # ``detected_from_url``.
        parent = dataclasses.replace(
            parent,
            permalink=f"https://x.com/{parent.handle}/status/{parent.tweet_id}",
        )
        records.append(parent)
        current = parent
    return records


def _linked_owner(db: Session, handle: str) -> User | None:
    """The live Vidit account linked to ``handle``, or ``None``.

    The bot never mints users: attribution requires an existing account whose
    ``x_handle`` was linked (invite-bound at registration, or the admin PATCH).
    A soft-deleted or deactivated account doesn't count: its work is hidden or
    suspended, so new drafts and billed replies must not land under it.
    """
    return (
        db.query(User)
        .filter(
            User.x_handle == handle.lower(),
            User.deleted_at.is_(None),
            User.is_active.is_(True),
        )
        .first()
    )


def _has_duplicate_media(db: Session, created: list[Event]) -> bool:
    """Whether any of the created events' media already exists elsewhere.

    Exact ``Media.sha256`` equality against every other event's media — the
    dedup warning the reply surfaces (perceptual near-duplicate matching is a
    separate value-layer feature).
    """
    event_ids = [event.id for event in created]
    hashes = [
        sha
        for (sha,) in db.query(Media.sha256).filter(
            Media.event_id.in_(event_ids), Media.sha256.isnot(None)
        )
    ]
    if not hashes:
        return False
    return (
        db.query(Media.id)
        .filter(Media.sha256.in_(hashes), Media.event_id.notin_(event_ids))
        .first()
        is not None
    )


def compose_reply(created_ids: list[str], *, missing_source: bool, duplicate_media: bool) -> str:
    """The in-thread reply for a mention that created drafts.

    Linkless by contract: a bare event ref, never a URL or auto-linkable
    domain (X bills link posts ~13x higher; the clickable link lives in the
    bot bio). Warnings surface what blocks or questions the draft.
    """
    n = len(created_ids)
    noun = "drafts" if n > 1 else "draft"
    head = f"Vidit: {n} geolocation {noun} saved · ref {created_ids[0]}"
    if n > 1:
        head += f" (+{n - 1} more)"
    lines = [head]
    if missing_source:
        lines.append("⚠ No source quote or footage link. Add one before publishing.")
    if duplicate_media:
        lines.append("⚠ This media already exists on Vidit. Possible duplicate.")
    lines.append("Review it from your profile (link in bio).")
    return "\n".join(lines)[:_REPLY_MAX_CHARS]


def _record(
    db: Session,
    mention: Mention,
    *,
    outcome: BotMentionOutcome,
    events_created: int = 0,
    reply_tweet_id: str | None = None,
) -> None:
    db.add(
        BotMention(
            mention_tweet_id=mention.tweet_id,
            author_handle=mention.author_handle,
            outcome=outcome,
            events_created=events_created,
            reply_tweet_id=reply_tweet_id,
        )
    )
    db.commit()


def _post_reply_failsoft(mention: Mention, text: str, *, client: httpx.Client | None) -> str | None:
    """Post the reply if write credentials are configured; ``None`` otherwise
    or on failure. The detection is already durable — a lost reply is a
    logged, Sentry-captured degradation, never a reason to fail the mention."""
    if not settings.x_api_consumer_key:
        return None
    try:
        return post_reply(
            text=text,
            in_reply_to_tweet_id=mention.tweet_id,
            consumer_key=settings.x_api_consumer_key,
            consumer_secret=settings.x_api_consumer_secret,
            access_token=settings.x_bot_access_token,
            access_token_secret=settings.x_bot_access_token_secret,
            client=client,
        )
    except XApiError as exc:
        logger.warning("Bot reply failed for mention %s: %s", mention.tweet_id, exc)
        sentry_sdk.capture_exception(exc)
        return None


async def _process_mention(
    db: Session,
    mention: Mention,
    *,
    syndication_client: httpx.Client | None,
    x_write_client: httpx.Client | None,
    reply_allowed: bool,
) -> tuple[BotMentionOutcome, int, str | None]:
    records = _self_thread_records(mention, client=syndication_client)
    detections = [d for thread in stitch(records) for d in detect(thread)]
    if not detections:
        return "no_detection", 0, None
    # After the detection step on purpose: an unknown handle with no coordinate
    # ledgers ``no_detection``, so ``no_account`` isolates the mentions where a
    # link would actually have produced a draft.
    owner = _linked_owner(db, records[0].handle)
    if owner is None:
        return "no_account", 0, None
    assembled = await assemble_detections(
        db, owner=owner, detections=detections, fetch_media=fetch_cdn_media
    )
    if not assembled.created:
        # ``skipped`` is the dedup verdict; a persist that raised on every
        # detection is a transient failure, and ``failed`` keeps it on the
        # operator's retry path (delete the ledger row) instead of burying it
        # as an already-imported tweet.
        return ("failed" if assembled.failed else "skipped"), 0, None
    reply_id: str | None = None
    if reply_allowed:
        reply = compose_reply(
            [str(event.id) for event in assembled.created],
            missing_source=any(event.source_url is None for event in assembled.created),
            duplicate_media=_has_duplicate_media(db, assembled.created),
        )
        reply_id = _post_reply_failsoft(mention, reply, client=x_write_client)
    else:
        logger.warning(
            "Reply budget reached; draft created without reply for mention %s",
            mention.tweet_id,
        )
    return "created", len(assembled.created), reply_id


def _since_id(db: Session) -> str | None:
    # NUMERIC, not BIGINT: an X snowflake fits a signed 64-bit today, but the
    # cursor must not be the thing that breaks the day one doesn't.
    latest = db.query(func.max(cast(BotMention.mention_tweet_id, Numeric))).scalar()
    return str(int(latest)) if latest is not None else None


async def run_bot_once(
    db: Session,
    *,
    syndication_client: httpx.Client | None = None,
    x_read_client: httpx.Client | None = None,
    x_write_client: httpx.Client | None = None,
) -> BotRunOutcome:
    """One bot pass: pull new mentions, process each, record each.

    Mentions process oldest first, each recorded in its own transaction, so a
    mid-pull crash resumes cleanly: everything before the crash is in the
    ledger, everything after is newer than the next run's ``since_id``. A
    per-mention failure is recorded as ``failed`` (captured to Sentry) and the
    loop moves on — delete the ledger row to retry that mention.
    """
    if not settings.x_bot_bearer_token or not settings.x_bot_user_id:
        raise BotNotConfigured("X_BOT_BEARER_TOKEN and X_BOT_USER_ID must be set to run the bot")
    outcome = BotRunOutcome()
    mentions = fetch_mentions(
        user_id=settings.x_bot_user_id,
        bearer_token=settings.x_bot_bearer_token,
        since_id=_since_id(db),
        client=x_read_client,
    )
    outcome.mentions_seen = len(mentions)
    author_replies: dict[str, int] = {}
    for mention in mentions:
        exists = (
            db.query(BotMention.id).filter(BotMention.mention_tweet_id == mention.tweet_id).first()
        )
        if exists is not None:
            outcome.already_handled += 1
            continue
        # The bot's own posts can surface in its mentions timeline (a reply in
        # a conversation it participates in mentions it); never self-process —
        # but ledger it, or the ``since_id`` cursor stalls below it and every
        # subsequent pull re-reads (re-bills) it until a newer analyst mention
        # lands.
        if mention.author_id == settings.x_bot_user_id:
            _record(db, mention, outcome="self")
            continue
        reply_allowed = (
            outcome.replies_posted < _MAX_REPLIES_PER_PASS
            and author_replies.get(mention.author_handle, 0) < _MAX_REPLIES_PER_AUTHOR_PER_PASS
        )
        try:
            verdict, created, reply_id = await _process_mention(
                db,
                mention,
                syndication_client=syndication_client,
                x_write_client=x_write_client,
                reply_allowed=reply_allowed,
            )
        except Exception as exc:
            db.rollback()
            logger.exception("Bot mention %s failed", mention.tweet_id)
            sentry_sdk.capture_exception(exc)
            _record(db, mention, outcome="failed")
            outcome.failed += 1
            continue
        _record(
            db,
            mention,
            outcome=verdict,
            events_created=created,
            reply_tweet_id=reply_id,
        )
        outcome.events_created += created
        if reply_id is not None:
            outcome.replies_posted += 1
            author_replies[mention.author_handle] = author_replies.get(mention.author_handle, 0) + 1
        if verdict == "no_detection":
            outcome.no_detection += 1
        elif verdict == "no_account":
            outcome.no_account += 1
        elif verdict == "skipped":
            outcome.skipped += 1
        elif verdict == "failed":
            outcome.failed += 1
    return outcome
