"""The @ViditBot pipeline — a tag on X becomes a ``detected`` draft + a reply.

An analyst tags the bot on the tweet that carries the coordinate. Two paths
feed the same per-mention pipeline (:func:`process_single_mention`):

* **Webhook (nominal)**: the X Account Activity webhook delivers the mention
  to ``routers/webhooks``, which queues it in ``bot_webhook_events``; the
  import worker drains the queue (:func:`drain_webhook_events`).
* **Poll (reconciliation)**: the hourly cron (``scripts/run_bot.py``) pulls
  the mentions timeline since the last processed id (:func:`run_bot_once`)
  and catches anything the webhook dropped; while the webhook is live
  (``X_WEBHOOK_ENABLED``), a mention first seen here raises a "webhook gap"
  Sentry message so a silently dead webhook pages.

The bot runs the same engine as the pasted import and the archive backfill;
nothing about the grammar lives here. Acquisition is
:func:`tweet_ingest.acquire_thread`, shared with the paste: the tagged post plus
the same author's post it replies to, one hop and no further, with the one chase
step run over the pair. ``tweet_ingest.resolve_threads`` then reads that thread
and ``detection.persist_drafts`` writes what it read, owned by the account
``detection.linked_owner`` maps the tagged author's handle to, read once per
mention (the bot never mints users: an unknown handle is ledgered
``no_account`` and produces nothing). The mention then lands in the
``bot_mentions`` ledger. What is left in this module is orchestration: the X
API, the reply, the ledger, the budget and the webhook drain.

Both paths share that ledger, so a mention is processed (and billed) at most
once whichever path sees it first; the poll's ``since_id`` derives from it,
one interval behind the max (``_SINCE_ID_OVERLAP``) so a mention the webhook
dropped is still re-read even after a newer one advanced the ledger.

Response model: the reply is the only gesture (a like at worker pickup,
seconds before the reply, would signal nothing the reply does not, and it
was the most expensive call of the mention). Replies open with the ✅/❌
verdict. A draft the tag created, or the newer parse overwrote, earns the
in-thread success reply (event ref + warnings); a linked author whose tag
produced nothing gets a failure reply carrying the diagnosis, unless the
tagged tweet is itself a reply to the bot (the loop guard: a courtesy answer
to the bot's own reply auto-mentions the bot and must not earn another
reply). An unlinked author
stays fully silent (``no_account``). All reply text is linkless by contract
(a URL 13x's the per-post price; the clickable link lives in the bot bio)
and unique per mention (X 403s duplicate content); the composers own both
invariants. Every reply spends the hourly and per-author budgets
(:class:`GestureBudget`, seeded from the ledger's trailing window so the
caps hold across passes, not per drain).
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
import sentry_sdk
from sqlalchemy import Numeric, cast, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.models.bot_mention import BotMention, BotMentionOutcome
from app.models.bot_webhook_event import BotWebhookEvent
from app.models.user import User
from app.services.detection import Outcome, linked_owner, persist_drafts
from app.services.tweet_ingest import (
    POST_UNREADABLE,
    REFUSAL_MESSAGES,
    WARNING_MESSAGES,
    AcquiredThread,
    TweetNotAccessible,
    acquire_thread,
    fetch_cdn_media,
    resolve_threads,
)
from app.services.x_api import Mention, XApiError, fetch_mentions, post_reply

logger = logging.getLogger(__name__)

# X's classic post length, in X's own units: an over-long reply would 403 the
# (billed) create call. Every composed reply is checked against it by
# :func:`_within_reply_cap`.
REPLY_MAX_WEIGHTED_LEN = 280


# The code-point ranges X weighs as 1; everything else weighs 2 (CJK, emoji
# and the symbol block the composer glyphs ✅ ❌ ⚠ live in).
_WEIGHT_ONE_RANGES = ((0x0000, 0x10FF), (0x2000, 0x200D), (0x2010, 0x201F), (0x2032, 0x2037))


def _char_weight(ch: str) -> int:
    code = ord(ch)
    return 1 if any(lo <= code <= hi for lo, hi in _WEIGHT_ONE_RANGES) else 2


def reply_weighted_len(text: str) -> int:
    """X's weighted character count for a composed reply.

    Weight 1 for code points in U+0000..U+10FF, U+2000..U+200D,
    U+2010..U+201F and U+2032..U+2037; weight 2 for everything else.
    """
    return sum(_char_weight(ch) for ch in text)


def _within_reply_cap(text: str) -> str:
    """Return a composed reply, truncated to the cap if it outgrew it.

    Every input is one of this module's own literals (the diagnosis table,
    the warning lines, a truncated ref), so an over-long reply means a code
    change slipped past the length tests, not user input. The tests are the
    gate; this is the backstop that keeps a billed create call off X's
    over-length 403, and the warning is what names the composer to shorten.
    """
    weighted = reply_weighted_len(text)
    if weighted <= REPLY_MAX_WEIGHTED_LEN:
        return text
    logger.warning(
        "Composed reply weighs %d, cap is %d; truncating: %r",
        weighted,
        REPLY_MAX_WEIGHTED_LEN,
        text,
    )
    kept: list[str] = []
    spent = 0
    for ch in text:
        spent += _char_weight(ch)
        if spent > REPLY_MAX_WEIGHTED_LEN:
            break
        kept.append(ch)
    return "".join(kept)


# Billed-spend ceilings on the write side. The mention surface is public: any
# stranger can tag the bot on a coordinate tweet, and each posted reply is
# billed. The window posts at most this many replies (success + failure), in
# total and per author; past a ceiling the draft still lands (detection is
# unbilled) but the reply is skipped and logged: a flood burns nothing but
# its own posting effort. The window is wall-clock (the trailing hour, read
# from the ledger), not per pass: the worker drains every few seconds, so a
# per-pass budget would multiply the caps hundreds of times an hour.
_MAX_REPLIES_PER_HOUR = 40
_MAX_REPLIES_PER_AUTHOR_PER_HOUR = 10
_GESTURE_WINDOW = timedelta(hours=1)

# The reconciliation poll's cursor lookback, in snowflake id space (the
# timestamp lives in the bits above 22, so this is one poll interval of ids).
# The ledger max is fed by BOTH paths: if the webhook drops mention A but
# delivers newer B, a cursor at B would never re-read A. Pulling from one
# interval behind the max re-reads the trailing window every pass; the cost
# is a bounded number of billed re-reads per pass, absorbed by the ledger as
# ``already_handled``.
_SINCE_ID_OVERLAP = (60 * 60 * 1000) << 22

# Attempt budget on one queued webhook event: past it the row lands
# ``failed`` (poison-pill guard, mirroring the archive jobs). The ledger's
# per-mention ``failed`` outcome is separate: it means the pipeline ran and
# raised; this budget covers a drain that keeps dying before the ledger row
# lands.
_WEBHOOK_MAX_ATTEMPTS = 3


class BotNotConfigured(RuntimeError):
    """The mentions-read credentials are absent — the runner cannot start."""


@dataclass
class GestureBudget:
    """Windowed spend tracker for the billed replies, the bot's only gesture.

    Seeded from the ledger's trailing hour (:meth:`from_ledger`) so the caps
    are wall-clock, surviving worker restarts and spanning drain passes; the
    in-memory counts then track the current pass on top.
    """

    replies_posted: int = 0
    _replies_by_author: dict[str, int] = dataclasses.field(default_factory=dict)

    @classmethod
    def from_ledger(cls, db: Session) -> GestureBudget:
        """A budget pre-charged with the trailing window's ledgered replies
        (rows with ``reply_tweet_id`` set)."""
        cutoff = datetime.now(UTC) - _GESTURE_WINDOW
        budget = cls()
        for handle, count in (
            db.query(BotMention.author_handle, func.count())
            .filter(BotMention.reply_tweet_id.isnot(None), BotMention.processed_at >= cutoff)
            .group_by(BotMention.author_handle)
        ):
            budget.replies_posted += count
            budget._replies_by_author[handle] = count
        return budget

    def reply_allowed(self, author_handle: str) -> bool:
        return (
            self.replies_posted < _MAX_REPLIES_PER_HOUR
            and self._replies_by_author.get(author_handle, 0) < _MAX_REPLIES_PER_AUTHOR_PER_HOUR
        )

    def note_reply(self, author_handle: str) -> None:
        self.replies_posted += 1
        self._replies_by_author[author_handle] = self._replies_by_author.get(author_handle, 0) + 1


@dataclass
class BotRunOutcome:
    """What one bot pass did, for the runner's log line."""

    mentions_seen: int = 0
    already_handled: int = 0
    events_created: int = 0
    # Mentions whose whole answer was overwriting an open draft: no row created,
    # at least one updated. Counted apart from ``events_created`` so a pass over
    # re-tagged posts does not read as an idle one.
    events_updated: int = 0
    replies_posted: int = 0
    no_detection: int = 0
    no_account: int = 0
    skipped: int = 0
    failed: int = 0


def acquire_tagged_thread(
    tweet_id: str, author_handle: str, *, client: httpx.Client | None = None
) -> AcquiredThread:
    """The thread behind one mention, through the shared acquisition.

    :func:`tweet_ingest.acquire_thread` reads the tagged post plus, when it
    replies to one of its author's own posts, that parent, which is the same one
    hop the pasted import reads. A parent by another author never joins the
    thread, so a tag under someone else's post reads only the tag itself, and so
    does the courtesy reply to the bot's own reply.

    Raises ``TweetNotAccessible`` when X serves nothing for the tagged post.

    The handle is case-folded before it goes in. It is the fallback the record
    keeps when the syndication body carries no screen name, and it is what every
    provenance permalink is written from and what the own-status exclusion
    compares a link against, so the mention payload's spelling of the handle
    must not reach a record as typed. The idempotency anchor itself is the post
    id (``events.detected_from_tweet_id``), which no spelling can move.
    """
    return acquire_thread(tweet_id, handle=author_handle.lower(), client=client)


# The ref shown in the success reply: the UUID's first block, enough to
# eyeball the draft in the Detections queue; the full 36 chars would eat a
# third of the reply for no extra identification value there.
_REPLY_REF_CHARS = 8


def compose_reply(
    created_id: str, *, drafts: int, warnings: Iterable[str], updated: bool = False
) -> str:
    """The in-thread reply for a mention that wrote its drafts.

    ``updated`` swaps the verb for the pass that created nothing and overwrote
    an open draft with a newer parse: the analyst is told what happened to the
    draft they already hold rather than that a second one was saved.

    Opens with the at-a-glance ✅ (the ❌ twin lives in
    :func:`compose_failure_reply`). Linkless by contract: a bare event ref
    (shortened to ``_REPLY_REF_CHARS``), never a URL or auto-linkable domain (X
    bills link posts about 13x higher; the clickable link lives in the bot bio).
    The ref also makes each reply unique, so X's duplicate-content 403 cannot eat
    it.

    One ⚠ line per warning the pass raised, worded by ``WARNING_MESSAGES`` and
    read in its order. The reply owns the glyph and the length discipline, never
    the sentence: the same sentence reaches the archive's outcome email and the
    import panel, so the three surfaces cannot describe one code differently.
    Which warnings a draft carries is the engine's and the write path's answer
    (``detection.persist_drafts``), not the reply's.
    """
    plural = "s" if drafts > 1 else ""
    verb = "updated" if updated else "saved"
    lines = [f"✅ {drafts} geolocation draft{plural} {verb} · ref {created_id[:_REPLY_REF_CHARS]}"]
    raised = set(warnings)
    lines.extend(f"⚠ {message}" for code, message in WARNING_MESSAGES.items() if code in raised)
    lines.append("Review from your profile")
    return _within_reply_cap("\n".join(lines))


# Where an analyst goes when the bot has nothing to diagnose. A handle mention
# is not a link, so it keeps the reply's linkless contract.
_ADMIN_CONTACT = "@vidithq"


def compose_failure_reply(reason: str | None = None, *, mention_id: str) -> str:
    """The in-thread reply for a linked author whose tag produced nothing.

    Mirrors :func:`compose_reply`'s shape so the two verdicts read as one
    voice: the ❌ header, one ⚠ line naming what the engine saw, and the
    footer. No recited lesson and no fix recipe: the rules live behind the bio
    link. The diagnosis is ``REFUSAL_MESSAGES``, the same sentence the paste
    answers with for the same code.

    Same linkless contract as :func:`compose_reply`: no URL, no auto-linkable
    domain (the "source link" phrase is a placeholder, not a link). Only
    posted to linked authors, and never on a tag that is itself a reply to
    the bot (the caller's loop guard). The ``mention_id`` tail makes every
    reply unique (X 403s a tweet identical to a recent one, which ate two
    failure replies on 2026-07-27) and lets the operator grep the ledger.
    Composed length must stay under ``REPLY_MAX_WEIGHTED_LEN``.
    """
    head = "❌ Nothing saved"
    ref = f" (m{mention_id[-5:]})"
    diagnosis = REFUSAL_MESSAGES.get(reason or "")
    # No code to name: the engine refused nothing, the write path raised on
    # every draft. Not the analyst's format to fix, so route them to the
    # maintainers instead of reciting a lesson.
    warning = f"⚠ {diagnosis}" if diagnosis else f"⚠ Unexpected case. Reach out to {_ADMIN_CONTACT}"
    return _within_reply_cap("\n".join([head, warning, f"Guide in bio{ref}"]))


def _record(
    db: Session,
    mention: Mention,
    *,
    outcome: BotMentionOutcome,
    events_created: int = 0,
    reply_tweet_id: str | None = None,
) -> bool:
    """Insert the ledger row; ``False`` when the mention_tweet_id UNIQUE lost
    a race (another worker ledgered it between the existence check and here),
    which the caller counts as ``already_handled`` instead of aborting."""
    db.add(
        BotMention(
            mention_tweet_id=mention.tweet_id,
            author_handle=mention.author_handle,
            outcome=outcome,
            events_created=events_created,
            reply_tweet_id=reply_tweet_id,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


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
        # X's duplicate-content 403 means this exact text was recently posted
        # by the account: an expected refusal (e.g. re-processing after a
        # restore), not an outage worth paging.
        if "duplicate content" not in str(exc).lower():
            sentry_sdk.capture_exception(exc)
        return None


async def _process_mention(
    db: Session,
    mention: Mention,
    *,
    owner: User | None,
    syndication_client: httpx.Client | None,
    x_write_client: httpx.Client | None,
    reply_allowed: bool,
) -> tuple[BotMentionOutcome, int, str | None, str | None]:
    try:
        # Blocking network I/O; a thread keeps the event loop serving siblings
        # while X answers, the same offload the pasted import takes.
        acquired = await asyncio.to_thread(
            acquire_tagged_thread,
            mention.tweet_id,
            mention.author_handle,
            client=syndication_client,
        )
    except TweetNotAccessible:
        # X serves the tagged post to no unauthenticated reader: a syndication
        # 404 (deleted, protected) or the tombstone body it answers for an
        # age-restricted or withheld post. Conflict footage is exactly what X
        # age-gates, so this recurs. Nothing was readable, and nothing here is
        # broken: ledger ``no_detection`` and let the failure reply say so,
        # rather than raise into the pass's ``failed`` + Sentry capture, where
        # the analyst would get no answer and an operator a false outage.
        return "no_detection", 0, None, POST_UNREADABLE
    if owner is None:
        # The engine runs here too, writing nothing: a mention from an unknown
        # handle whose post carries no coordinate ledgers ``no_detection``, so
        # ``no_account`` isolates the mentions where a link would actually have
        # produced a draft.
        resolution = resolve_threads([acquired.records])
        if resolution.drafts:
            return "no_account", 0, None, None
        return "no_detection", 0, None, resolution.reason
    assembled = await persist_drafts(
        db,
        owner=owner,
        resolution=resolve_threads([acquired.records]),
        via="bot",
        fetch_media=fetch_cdn_media,
    )
    if assembled.reason is not None:
        return "no_detection", 0, None, assembled.reason
    if not assembled.created and not assembled.updated:
        # ``skipped`` is the dedup verdict; a persist that raised on every
        # detection is a transient failure, and ``failed`` keeps it on the
        # operator's retry path (delete the ledger row) instead of burying it
        # as an already-imported tweet.
        return ("failed" if assembled.failed else "skipped"), 0, None, None
    reply_id: str | None = None
    if reply_allowed:
        reply_id = _post_reply_failsoft(mention, _success_reply(assembled), client=x_write_client)
    else:
        logger.warning(
            "Reply budget reached; draft written without reply for mention %s",
            mention.tweet_id,
        )
    if assembled.created:
        return "created", len(assembled.created), reply_id, None
    # A tag on a post the analyst already imported, edited since: the newer
    # parse landed on the open draft. The tag was answered, so it earns the
    # success reply and its own ledger verdict rather than the silent
    # ``skipped`` a tag that moved nothing gets.
    return "updated", 0, reply_id, None


def _success_reply(assembled: Outcome) -> str:
    """The composed ✅ reply for one mention's outcome.

    The ref reads the first row the pass wrote, the created drafts first: a
    thread carrying several coordinates lands several, and the
    ``several_coordinates`` warning is what tells the analyst so. A pass that
    created nothing and overwrote an open draft names that draft instead, and
    says it updated rather than saved.
    """
    written = assembled.created or assembled.updated
    return compose_reply(
        str(written[0]),
        drafts=len(written),
        warnings=assembled.warnings,
        updated=not assembled.created,
    )


# The verdicts a linked author gets an answer for when their tag produced no
# draft. ``no_detection`` is the engine's refusal, named back by code;
# ``failed`` is the write path raising on every draft, which names no code and
# reads as the reply's unexpected case. A tag that answers neither either wrote
# a row (``created`` / ``updated``, both the ✅ reply) or deduplicated onto a row
# it moved nothing on (``skipped``, which is not a failure to report), and an
# unlinked author stays fully silent whatever the tweet yielded.
_ANSWERED_VERDICTS = ("no_detection", "failed")


async def process_single_mention(
    db: Session,
    mention: Mention,
    *,
    syndication_client: httpx.Client | None = None,
    x_write_client: httpx.Client | None = None,
    budget: GestureBudget,
    outcome: BotRunOutcome,
) -> str:
    """Run one mention through the full pipeline + response model; shared by
    the poll pass and the webhook drain. Returns the ledger verdict, or
    ``"already_handled"`` (the poll's gap detector reads it).

    The ledger existence check up front is what makes the two paths safe
    together: whichever sees the mention first records it, the other counts
    it ``already_handled``. Everything after is recorded in the ledger
    whatever happens; a processing exception ledgers ``failed`` (captured to
    Sentry) so the caller's loop moves on.
    """
    exists = db.query(BotMention.id).filter(BotMention.mention_tweet_id == mention.tweet_id).first()
    if exists is not None:
        outcome.already_handled += 1
        return "already_handled"
    # The bot's own posts can surface in its mentions timeline (a reply in a
    # conversation it participates in mentions it); never self-process, but
    # ledger it, or the poll's ``since_id`` cursor stalls below it and every
    # subsequent pull re-reads (re-bills) it until a newer analyst mention
    # lands.
    if mention.author_id == settings.x_bot_user_id:
        if not _record(db, mention, outcome="self"):
            outcome.already_handled += 1
            return "already_handled"
        return "self"
    # The one handle-to-account read of the mention: the account every draft is
    # attributed to, and the failure-reply gate, since an unlinked author stays
    # fully silent whatever the tweet yields.
    owner = linked_owner(db, mention.author_handle)
    try:
        verdict, created, reply_id, failure_reason = await _process_mention(
            db,
            mention,
            owner=owner,
            syndication_client=syndication_client,
            x_write_client=x_write_client,
            reply_allowed=budget.reply_allowed(mention.author_handle),
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Bot mention %s failed", mention.tweet_id)
        sentry_sdk.capture_exception(exc)
        if not _record(db, mention, outcome="failed"):
            outcome.already_handled += 1
            return "already_handled"
        outcome.failed += 1
        return "failed"
    if (
        verdict in _ANSWERED_VERDICTS
        and owner is not None
        and mention.in_reply_to_user_id != settings.x_bot_user_id
        and budget.reply_allowed(mention.author_handle)
    ):
        # The failure reply: tell a linked analyst why nothing landed. The
        # ``in_reply_to_user_id`` guard breaks the loop where a courtesy
        # answer to the bot's own reply (which auto-mentions the bot) would
        # earn another reply, forever.
        reply_id = _post_reply_failsoft(
            mention,
            compose_failure_reply(failure_reason, mention_id=mention.tweet_id),
            client=x_write_client,
        )
    if not _record(
        db,
        mention,
        outcome=verdict,
        events_created=created,
        reply_tweet_id=reply_id,
    ):
        outcome.already_handled += 1
        return "already_handled"
    outcome.events_created += created
    if reply_id is not None:
        budget.note_reply(mention.author_handle)
        outcome.replies_posted += 1
    if verdict == "updated":
        outcome.events_updated += 1
    elif verdict == "no_detection":
        outcome.no_detection += 1
    elif verdict == "no_account":
        outcome.no_account += 1
    elif verdict == "skipped":
        outcome.skipped += 1
    elif verdict == "failed":
        outcome.failed += 1
    return verdict


def _since_id(db: Session) -> str | None:
    # NUMERIC, not BIGINT: an X snowflake fits a signed 64-bit today, but the
    # cursor must not be the thing that breaks the day one doesn't. The
    # overlap subtraction makes the poll re-read the trailing interval (see
    # _SINCE_ID_OVERLAP): a mention the webhook dropped stays reachable even
    # after a newer webhook-delivered one advanced the ledger max.
    latest = db.query(func.max(cast(BotMention.mention_tweet_id, Numeric))).scalar()
    return str(max(int(latest) - _SINCE_ID_OVERLAP, 1)) if latest is not None else None


async def run_bot_once(
    db: Session,
    *,
    syndication_client: httpx.Client | None = None,
    x_read_client: httpx.Client | None = None,
    x_write_client: httpx.Client | None = None,
) -> BotRunOutcome:
    """One poll pass, the reconciliation net behind the webhook: pull new
    mentions, process each, record each.

    Mentions process oldest first, each recorded in its own transaction, so a
    mid-pull crash resumes cleanly: everything before the crash is in the
    ledger, everything after is newer than the next run's ``since_id``. A
    per-mention failure is recorded as ``failed`` (captured to Sentry) and the
    loop moves on — delete the ledger row to retry that mention.

    While the webhook is live (``X_WEBHOOK_ENABLED``), every mention here
    should already be in the ledger; one that is not means the webhook missed
    it, so a Sentry message fires (the gap detector: a silently dead webhook
    must page, not degrade into hourly latency forever).
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
    budget = GestureBudget.from_ledger(db)
    for mention in mentions:
        verdict = await process_single_mention(
            db,
            mention,
            syndication_client=syndication_client,
            x_write_client=x_write_client,
            budget=budget,
            outcome=outcome,
        )
        # Any FRESH verdict means the webhook missed this mention; only a
        # ledger hit (already_handled) or the bot's own post is nominal.
        if settings.x_webhook_enabled and verdict not in ("already_handled", "self"):
            message = f"webhook gap: mention {mention.tweet_id} arrived via reconciliation"
            logger.warning(message)
            sentry_sdk.capture_message(message, level="warning")
    return outcome


# ── The webhook queue: enqueue in the request, drain in the worker ─────────


def enqueue_webhook_mentions(db: Session, mentions: list[Mention]) -> int:
    """Insert webhook-delivered mentions as ``queued`` rows; one commit.

    Called by the webhook endpoint, which must answer X fast: no dedup, no
    pipeline work here. A redelivery inserts a second row and the drain's
    ledger check absorbs it (``already_handled``).
    """
    for mention in mentions:
        db.add(BotWebhookEvent(mention=dataclasses.asdict(mention)))
    db.commit()
    return len(mentions)


def _claim_webhook_event(db: Session) -> BotWebhookEvent | None:
    """Claim the oldest queued webhook event, or ``None`` when drained.

    Same ``FOR UPDATE SKIP LOCKED`` pattern as the archive jobs: the claim
    flips the row to ``processing``, bumps ``attempts`` and commits
    (releasing the lock), so a concurrent worker's ``queued`` filter skips
    it rather than double-running the pipeline. The drain re-queues on
    exception; a worker killed hard mid-claim strands the row in
    ``processing``, and the hourly reconciliation poll re-delivers the
    mention (its ledger row never landed), so nothing is lost. Rows past
    the attempt budget land ``failed`` (poison-pill guard).
    """
    while True:
        event = (
            db.query(BotWebhookEvent)
            .filter(BotWebhookEvent.status == "queued")
            .order_by(BotWebhookEvent.created_at)
            .with_for_update(skip_locked=True)
            .first()
        )
        if event is None:
            return None
        if event.attempts >= _WEBHOOK_MAX_ATTEMPTS:
            event.status = "failed"
            db.commit()
            continue
        event.status = "processing"
        event.attempts += 1
        db.commit()
        return event


def _mention_from_payload(payload: dict) -> Mention | None:
    tweet_id = payload.get("tweet_id")
    author_id = payload.get("author_id")
    author_handle = payload.get("author_handle")
    text = payload.get("text")
    reply_to = payload.get("in_reply_to_user_id")
    if (
        not isinstance(tweet_id, str)
        or not isinstance(author_id, str)
        or not isinstance(author_handle, str)
    ):
        return None
    return Mention(
        tweet_id=tweet_id,
        author_id=author_id,
        author_handle=author_handle,
        text=text if isinstance(text, str) else "",
        in_reply_to_user_id=reply_to if isinstance(reply_to, str) else None,
    )


async def drain_webhook_events(
    db: Session,
    *,
    syndication_client: httpx.Client | None = None,
    x_write_client: httpx.Client | None = None,
) -> BotRunOutcome:
    """Drain the webhook queue through the shared mention pipeline.

    Called by the import worker between archive drains; tests call it
    directly. The :class:`GestureBudget` is seeded from the ledger's
    trailing hour, so the gesture ceilings hold across passes. A pipeline
    exception re-queues the claimed row for a later pass (bounded by the
    attempt budget) and propagates (the worker backs off); the nominal
    outcomes, including a ledgered ``failed`` mention, land the row
    ``done``; the ledger row is the retry path from there.
    """
    outcome = BotRunOutcome()
    budget = GestureBudget.from_ledger(db)
    while (event := _claim_webhook_event(db)) is not None:
        mention = _mention_from_payload(event.mention)
        if mention is None:
            logger.warning("Dropping malformed webhook event %s: %r", event.id, event.mention)
            event.status = "failed"
            db.commit()
            continue
        outcome.mentions_seen += 1
        try:
            await process_single_mention(
                db,
                mention,
                syndication_client=syndication_client,
                x_write_client=x_write_client,
                budget=budget,
                outcome=outcome,
            )
        except Exception:
            db.rollback()
            event.status = "queued"
            db.commit()
            raise
        event.status = "done"
        db.commit()
    return outcome
