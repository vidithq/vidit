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

The pipeline per mention accepts one strict structure — a title, one
decimal coordinate pair, a source link, remaining lines becoming the proof
text — spelled bare (the shape carries the fields, the primary form) or
with explicit ``T:`` / ``C:`` / ``S:`` markers, and delivered in two forms:

* **Inline**: the tagged tweet itself carries the markers
  (:func:`tweet_ingest.detect_structured`; at most one extra syndication
  fetch resolves the ``S:`` target's media and post date).
* **Relay**: the tagged tweet is the analyst's direct reply to their own
  marker tweet, carrying the re-uploaded footage as attached media — for an
  ``S:`` link the chase vocabulary cannot fetch (TikTok, Instagram, an
  article). One fetch resolves the parent, which must be the same author's
  conforming tweet; the reply's media becomes the source media
  (:func:`tweet_ingest.detect_relay`).

That one-hop parent fetch is the only ancestor read: there is no free-text
parent rollup (the archive backfill keeps its own self-thread stitching, the
bot does not share it), and free-text coordinate detection is deliberately
not a fallback here. The detection persists
through ``assemble_detections`` owned by the existing Vidit account whose
admin-linked ``x_handle`` matches the tagged author (the bot never mints
users: an unknown handle is ledgered ``no_account`` and produces nothing),
then the mention lands in the ``bot_mentions`` ledger.

Both paths share that ledger, so a mention is processed (and billed) at most
once whichever path sees it first; the poll's ``since_id`` derives from it,
one interval behind the max (``_SINCE_ID_OVERLAP``) so a mention the webhook
dropped is still re-read even after a newer one advanced the ledger.

Response model: the reply is the only gesture (a like at worker pickup,
seconds before the reply, would signal nothing the reply does not, and it
was the most expensive call of the mention). A created draft earns the
in-thread success reply (event ref + warnings); a linked author whose
tagged tweet misses any part of the format gets a failure reply teaching
it, unless the tagged tweet is itself a reply to the bot (the loop guard:
a courtesy answer to the bot's own reply auto-mentions the bot and must
not earn another reply). An unlinked author stays fully silent
(``no_account``). All reply text is linkless by contract (a URL 13x's the
per-post price; the clickable link lives in the bot bio); the composers own
that invariant. Every reply spends the hourly and per-author budgets
(:class:`GestureBudget`, seeded from the ledger's trailing window so the
caps hold across passes, not per drain).
"""

from __future__ import annotations

import dataclasses
import logging
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
from app.models.event import Event
from app.models.media import Media
from app.models.user import User
from app.services.detection import assemble_detections
from app.services.tweet_ingest import (
    TweetRecord,
    detect_relay,
    detect_structured,
    fetch_cdn_media,
    fetch_relay_parent,
    record_from_syndication,
)
from app.services.x_api import Mention, XApiError, fetch_mentions, post_reply

logger = logging.getLogger(__name__)

# X's classic post length. Replies are composed under it and hard-truncated
# as a belt: an over-long reply would 403 the (billed) create call. The cap
# counts Python code points while X counts weighted characters (the ⚠ glyph
# weighs 2), so composed text must stay well under it — today's worst case is
# ~230 code points / ~235 weighted.
_REPLY_MAX_CHARS = 280

# Billed-spend ceilings on the write side. The mention surface is public: any
# stranger can tag the bot on a coordinate tweet, and each posted reply is
# billed. The window posts at most this many replies (success + failure), in
# total and per author; past a ceiling the draft still lands (detection is
# unbilled) but the reply is skipped and logged: a flood burns nothing but
# its own posting effort. The window is wall-clock (the trailing hour, read
# from the ledger), not per pass: the worker drains every few seconds, so a
# per-pass budget would multiply the caps hundreds of times an hour.
_MAX_REPLIES_PER_HOUR = 20
_MAX_REPLIES_PER_AUTHOR_PER_HOUR = 3
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
    replies_posted: int = 0
    no_detection: int = 0
    no_account: int = 0
    skipped: int = 0
    failed: int = 0


def _tagged_record(mention: Mention, *, client: httpx.Client | None = None) -> TweetRecord:
    """Exactly the tagged tweet, one syndication fetch.

    The markers live either here (inline form) or on the direct parent (relay
    form, fetched separately by :func:`tweet_ingest.fetch_relay_parent`); a
    coordinate living anywhere else in the thread does not count. The archive
    backfill keeps its own self-thread stitching untouched (its threads are
    same-author by construction, see docs/ingestion.md).
    """
    return record_from_syndication(
        f"https://x.com/{mention.author_handle}/status/{mention.tweet_id}",
        client=client,
    )


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


def compose_failure_reply() -> str:
    """The in-thread reply for a linked author whose tag produced nothing:
    why nothing landed, the format itself, and the relay escape hatch.

    Same linkless contract as :func:`compose_reply`: no URL, no auto-linkable
    domain (the "source link" line is a placeholder phrase, not a link; the
    full guide lives behind the bio link). Teaches the bare shape (the
    primary form; the ``T:`` / ``C:`` / ``S:`` markers stay accepted without
    being advertised here); the source-rule clause covers the analyst whose
    lines are right but whose source is missing, ambiguous, or their own
    post; the relay sentence covers footage the chase cannot fetch. Only
    posted to linked authors, and never on a tag that is itself a reply to
    the bot (the caller's loop guard). Composed length must stay well under
    ``_REPLY_MAX_CHARS``.
    """
    return (
        "Vidit: nothing saved. Tag me on one post shaped as three lines:\n"
        "the title\n"
        "22.703889, -83.297222\n"
        "the source link, alone on its line, never your own post\n"
        "Other lines join the proof note. Can't link the footage? Tag me in a "
        "direct reply carrying it. Guide in bio."
    )


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
    record = _tagged_record(mention, client=syndication_client)
    detections = detect_structured(
        record, bot_handle=settings.x_bot_handle, client=syndication_client
    )
    if not detections:
        # The relay form: a tag in a direct reply to the author's own marker
        # tweet, the reply's media relaying the footage. One parent fetch,
        # same-author guarded; anything short of a conforming parent keeps
        # the ``no_detection`` verdict.
        parent = fetch_relay_parent(record, client=syndication_client)
        if parent is not None:
            detections = detect_relay(
                record, parent, bot_handle=settings.x_bot_handle, client=syndication_client
            )
    if not detections:
        return "no_detection", 0, None
    # After the detection step on purpose: an unknown handle with a
    # non-conforming tweet ledgers ``no_detection``, so ``no_account`` isolates
    # the mentions where a link would actually have produced a draft.
    owner = _linked_owner(db, record.handle)
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
    # Read once for the failure-reply gate: an unlinked author stays fully
    # silent, whatever the tweet yields.
    author_linked = _linked_owner(db, mention.author_handle) is not None
    try:
        verdict, created, reply_id = await _process_mention(
            db,
            mention,
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
        verdict == "no_detection"
        and author_linked
        and mention.in_reply_to_user_id != settings.x_bot_user_id
        and budget.reply_allowed(mention.author_handle)
    ):
        # The failure reply: tell a linked analyst why nothing landed. The
        # ``in_reply_to_user_id`` guard breaks the loop where a courtesy
        # answer to the bot's own reply (which auto-mentions the bot) would
        # earn another reply, forever.
        reply_id = _post_reply_failsoft(mention, compose_failure_reply(), client=x_write_client)
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
    if verdict == "no_detection":
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
