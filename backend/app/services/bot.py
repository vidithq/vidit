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

The pipeline per mention: rebuild the tagged tweet's *self*-thread through
the free syndication path (:func:`_self_thread_records`), run the shared
detection spine (``stitch → detect``), persist through
``assemble_detections`` owned by the existing Vidit account whose
admin-linked ``x_handle`` matches the tagged author (the bot never mints
users: an unknown handle is ledgered ``no_account`` and produces nothing),
then record the mention in the ``bot_mentions`` ledger.

Both paths share that ledger, so a mention is processed (and billed) at most
once whichever path sees it first; the poll's ``since_id`` derives from it,
so a fresh run resumes exactly where the last one stopped.

Response model: the bot **likes** the tagged tweet as a receipt ack when the
author is a linked live account (``no_account`` stays fully silent); a
created draft earns the in-thread success reply (event ref + warnings); a
linked author whose thread yields no coordinate gets a failure reply stating
the expected format, unless the tagged tweet is itself a reply to the bot
(the loop guard: a courtesy answer to the bot's own reply auto-mentions the
bot and must not earn another reply). All reply text is linkless by contract
(a URL 13x's the per-post price; the clickable link lives in the bot bio); the
composers own that invariant. Every like and reply spends the per-pass
and per-author budgets (:class:`GestureBudget`).
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
from app.models.bot_webhook_event import BotWebhookEvent
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
from app.services.x_api import Mention, XApiError, fetch_mentions, like_post, post_reply

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
# stranger can tag the bot on a coordinate tweet, and each posted gesture is
# billed. A pass posts at most this many replies (success + failure) and this
# many likes, in total and per author; past a ceiling the draft still lands
# (detection is unbilled) but the gesture is skipped and logged: a flood
# burns nothing but its own posting effort.
_MAX_REPLIES_PER_PASS = 20
_MAX_REPLIES_PER_AUTHOR_PER_PASS = 3
_MAX_LIKES_PER_PASS = 20
_MAX_LIKES_PER_AUTHOR_PER_PASS = 3

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
    """Per-pass spend tracker for the billed gestures (replies + likes)."""

    replies_posted: int = 0
    likes_posted: int = 0
    _replies_by_author: dict[str, int] = dataclasses.field(default_factory=dict)
    _likes_by_author: dict[str, int] = dataclasses.field(default_factory=dict)

    def reply_allowed(self, author_handle: str) -> bool:
        return (
            self.replies_posted < _MAX_REPLIES_PER_PASS
            and self._replies_by_author.get(author_handle, 0) < _MAX_REPLIES_PER_AUTHOR_PER_PASS
        )

    def note_reply(self, author_handle: str) -> None:
        self.replies_posted += 1
        self._replies_by_author[author_handle] = self._replies_by_author.get(author_handle, 0) + 1

    def like_allowed(self, author_handle: str) -> bool:
        return (
            self.likes_posted < _MAX_LIKES_PER_PASS
            and self._likes_by_author.get(author_handle, 0) < _MAX_LIKES_PER_AUTHOR_PER_PASS
        )

    def note_like(self, author_handle: str) -> None:
        self.likes_posted += 1
        self._likes_by_author[author_handle] = self._likes_by_author.get(author_handle, 0) + 1


@dataclass
class BotRunOutcome:
    """What one bot pass did, for the runner's log line."""

    mentions_seen: int = 0
    already_handled: int = 0
    events_created: int = 0
    replies_posted: int = 0
    likes_posted: int = 0
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


def compose_failure_reply() -> str:
    """The in-thread reply for a linked author whose thread yielded no
    coordinate: why nothing landed, plus the expected format.

    Same linkless contract as :func:`compose_reply`: no URL, no auto-linkable
    domain. Only posted to linked authors, and never on a tag that is itself
    a reply to the bot (the caller's loop guard).
    """
    return (
        "Vidit: no coordinates found in this thread. Write them in the post "
        "text (like 48.858370, 2.294481), add the source as a quote, and tag "
        "me again."
    )[:_REPLY_MAX_CHARS]


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


def _like_failsoft(mention: Mention, *, client: httpx.Client | None) -> bool:
    """Like the tagged tweet if write credentials are configured; same
    fail-soft contract as the reply: a lost like is a logged degradation,
    never a reason to fail the mention."""
    if not settings.x_api_consumer_key:
        return False
    try:
        like_post(
            user_id=settings.x_bot_user_id,
            tweet_id=mention.tweet_id,
            consumer_key=settings.x_api_consumer_key,
            consumer_secret=settings.x_api_consumer_secret,
            access_token=settings.x_bot_access_token,
            access_token_secret=settings.x_bot_access_token_secret,
            client=client,
        )
    except XApiError as exc:
        logger.warning("Bot like failed for mention %s: %s", mention.tweet_id, exc)
        sentry_sdk.capture_exception(exc)
        return False
    return True


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
        _record(db, mention, outcome="self")
        return "self"
    # The receipt ack: like the tagged tweet, linked live authors only (an
    # unlinked author stays fully silent, whatever the thread yields).
    author_linked = _linked_owner(db, mention.author_handle) is not None
    if author_linked and budget.like_allowed(mention.author_handle):
        if _like_failsoft(mention, client=x_write_client):
            budget.note_like(mention.author_handle)
            outcome.likes_posted += 1
    elif author_linked:
        logger.warning("Like budget reached; mention %s not liked", mention.tweet_id)
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
        _record(db, mention, outcome="failed")
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
    _record(
        db,
        mention,
        outcome=verdict,
        events_created=created,
        reply_tweet_id=reply_id,
    )
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
    budget = GestureBudget()
    for mention in mentions:
        verdict = await process_single_mention(
            db,
            mention,
            syndication_client=syndication_client,
            x_write_client=x_write_client,
            budget=budget,
            outcome=outcome,
        )
        if settings.x_webhook_enabled and verdict in ("created", "no_detection", "no_account"):
            message = f"webhook gap: mention {mention.tweet_id} arrived via reconciliation"
            logger.warning(message)
            sentry_sdk.capture_message(message)
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

    Same ``FOR UPDATE SKIP LOCKED`` pattern as the archive jobs, without a
    ``running`` state: the claim bumps ``attempts`` and commits (releasing
    the lock), and concurrency safety is the ledger's job: two workers
    racing the same mention would both run the pipeline, and the second
    records ``already_handled``. Rows past the attempt budget land
    ``failed`` (poison-pill guard).
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
    directly. One :class:`GestureBudget` spans the pass, same ceilings as a
    poll pass. A pipeline exception leaves the row ``queued`` for a later
    pass (bounded by the attempt budget); the nominal outcomes, including a
    ledgered ``failed`` mention, land the row ``done``; the ledger row is
    the retry path from there.
    """
    outcome = BotRunOutcome()
    budget = GestureBudget()
    while (event := _claim_webhook_event(db)) is not None:
        mention = _mention_from_payload(event.mention)
        if mention is None:
            logger.warning("Dropping malformed webhook event %s: %r", event.id, event.mention)
            event.status = "failed"
            db.commit()
            continue
        outcome.mentions_seen += 1
        await process_single_mention(
            db,
            mention,
            syndication_client=syndication_client,
            x_write_client=x_write_client,
            budget=budget,
            outcome=outcome,
        )
        event.status = "done"
        db.commit()
    return outcome
