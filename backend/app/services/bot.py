"""The @ViditBot pipeline: a tag on X becomes a detection and a reply.

Two paths insert a mention as a ``queued`` ``bot_mentions`` row
(:func:`enqueue_mentions`, ``ON CONFLICT (mention_post_id) DO NOTHING``):

* **Webhook (nominal)**: the X Account Activity webhook delivers the mention to
  ``routers/webhooks``.
* **Catch-up (reconciliation)**: the import worker pulls the mentions timeline
  at start and every :data:`CATCH_UP_INTERVAL` (:func:`catch_up`). While the
  webhook is live (``X_WEBHOOK_ENABLED``), a mention first queued here raises
  a "webhook gap" Sentry message so a dead webhook pages.

The worker drains the ``queued`` rows (:func:`drain_mentions`), so a mention is
processed (and billed) at most once. The catch-up's ``since_id`` derives from
the table, one interval behind the max (``_SINCE_ID_OVERLAP``) so a mention the
webhook dropped is re-read even after a newer one advanced the max.

A mention counts as a tag only when the author typed it. X prefixes a reply
with the parent's author and the parent's mentions, so :func:`_tag_is_inherited`
reads that off the text (or one syndication read of the parent); an inherited
tag lands ``inherited`` without acquiring, answering or billing.

The grammar lives in the shared engine, not here. Acquisition is
:func:`tweet_ingest.acquire_thread` (the tagged post plus the same author's
parent; a bare tag climbs the same author's parents to the coordinate post, plus
the footage post above it). ``AcquiredThread.resolve`` reads the thread
through ``tweet_ingest.resolve_threads`` and ``detection.persist_detections``
writes it, owned by the account ``detection.linked_owner`` maps the author's
handle to (the bot never mints users: an unknown handle lands
``no_account``). A thread with footage and a source link but no coordinate
opens a ``requested`` row through ``detection.open_request`` instead of
``coords_missing``; one that branch cannot serve is refused
``request_not_possible``. A coordinate-less thread whose read was cut short (a
parent X would not serve, or the climb's cap) is refused ``thread_truncated``
and opens nothing. This module is orchestration: the X API, the reply, the
queue, the budget and the drain.

Response model: the reply is the only gesture (a like would signal nothing the
reply does not, and was the most expensive call). Replies open with the
verdict glyph. A detection created or overwritten, or a request opened
(:func:`compose_request_reply`), earns the success reply. A linked author whose
tag produced nothing gets a failure reply with the diagnosis, unless the tagged
tweet replies to the bot (loop guard). An unlinked author stays silent. Reply
text is linkless (a URL costs 13x per post; the link lives in the bot bio) and
unique per mention (X 403s duplicates); the composers own both. Every reply
spends the hourly and per-author budgets (:class:`GestureBudget`, seeded from
the ledger's trailing window so the caps hold across passes).
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
import sentry_sdk
from sqlalchemy import and_, func, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.bot_mention import BotMention, BotMentionOutcome
from app.models.user import User
from app.services.detection import Outcome, linked_owner, open_request, persist_detections
from app.services.tweet_ingest import (
    COORDS_MISSING,
    POST_UNREADABLE,
    REFUSAL_MESSAGES,
    WARNING_MESSAGES,
    AcquiredThread,
    TweetImportError,
    TweetNotAccessible,
    acquire_thread,
    fetch_cdn_media,
    record_by_id,
    tags_bot,
)
from app.services.x_api import (
    Mention,
    OAuth1Credentials,
    XApiError,
    fetch_mentions,
    post_reply,
)

logger = logging.getLogger(__name__)

# X's post length cap, in X's weighted units: an over-long reply 403s the billed
# create call. Checked by :func:`_within_reply_cap`.
REPLY_MAX_WEIGHTED_LEN = 280


# Code-point ranges X weighs as 1; everything else weighs 2 (CJK, emoji, and
# the symbol block of the composer glyphs).
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

    Inputs are this module's own literals, so overflow means a code change
    slipped past the length tests. This is the backstop against X's billed
    over-length 403; the warning names the composer to shorten.
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


# Trailing window for the billed-reply ceilings (``settings.bot_max_replies_per_hour``
# and ``bot_max_replies_per_author_per_hour``); wall-clock, read from the ledger.
_GESTURE_WINDOW = timedelta(hours=1)

# How often the worker pulls the mentions timeline behind the webhook (:func:`catch_up`).
CATCH_UP_INTERVAL = timedelta(hours=1)

# Catch-up cursor lookback in snowflake id space (timestamp is above bit 22): one
# catch-up interval. Both paths feed the table max, so if the webhook drops A but
# delivers newer B, a cursor at B would never re-read A. The cost is a bounded
# number of billed re-reads per pass, absorbed by ``ON CONFLICT DO NOTHING``.
_SINCE_ID_OVERLAP = int(CATCH_UP_INTERVAL.total_seconds() * 1000) << 22

# Attempts per mention before it lands ``failed`` (poison-pill guard, like the
# archive jobs). Separate from the outcome ``failed``, which means the pipeline
# ran and raised.
_MAX_ATTEMPTS = 3

# A claimed mention left ``running`` this long belongs to a worker that died; the
# drain claims it again.
STALE_RUNNING_AFTER = timedelta(hours=1)


class BotNotConfigured(RuntimeError):
    """The mentions-read credentials are absent."""


@dataclass
class GestureBudget:
    """Windowed spend tracker for billed replies.

    Seeded from the ledger's trailing hour (:meth:`from_ledger`), so caps
    survive restarts and span passes.
    """

    replies_posted: int = 0
    _replies_by_author: dict[str, int] = dataclasses.field(default_factory=dict)

    @classmethod
    def from_ledger(cls, db: Session) -> GestureBudget:
        """A budget pre-charged with the trailing window's ledgered replies."""
        cutoff = datetime.now(UTC) - _GESTURE_WINDOW
        budget = cls()
        for handle, count in (
            db.query(BotMention.author_x_handle, func.count())
            .filter(BotMention.reply_post_id.isnot(None), BotMention.processed_at >= cutoff)
            .group_by(BotMention.author_x_handle)
        ):
            budget.replies_posted += count
            budget._replies_by_author[handle] = count
        return budget

    def reply_allowed(self, author_handle: str) -> bool:
        return (
            self.replies_posted < settings.bot_max_replies_per_hour
            and self._replies_by_author.get(author_handle, 0)
            < settings.bot_max_replies_per_author_per_hour
        )

    def note_reply(self, author_handle: str) -> None:
        self.replies_posted += 1
        self._replies_by_author[author_handle] = self._replies_by_author.get(author_handle, 0) + 1


@dataclass
class BotRunOutcome:
    """What one catch-up or drain did, for the worker's log line."""

    # Mentions the catch-up pulled, and those already in the table.
    mentions_seen: int = 0
    already_handled: int = 0
    # Mentions the drain ran through the pipeline.
    mentions_processed: int = 0
    created_event_count: int = 0
    # Mentions that opened a ``requested`` row (not counted in ``created_event_count``).
    requests_opened: int = 0
    # Mentions that only overwrote an open detection (none created, one or more updated).
    events_updated: int = 0
    replies_posted: int = 0
    # Mentions whose tag came from X's reply prefix; nothing acquired or answered.
    inherited: int = 0
    no_detection: int = 0
    no_account: int = 0
    skipped: int = 0
    failed: int = 0


def acquire_tagged_thread(
    tweet_id: str, author_handle: str, *, client: httpx.Client | None = None
) -> AcquiredThread:
    """The thread behind one mention, through :func:`tweet_ingest.acquire_thread`.

    A parent by another author never joins the thread and ends the climb, so a
    tag under someone else's post (or a courtesy reply to the bot) reads only
    itself.

    Raises ``TweetNotAccessible`` when X serves nothing for the tagged post.

    The handle is case-folded: it is the record's fallback screen name, feeds
    every provenance permalink and the own-status exclusion, so the payload's
    spelling must not leak through. Idempotency anchors on the post id
    (``event_detections.from_post_id``).
    """
    return acquire_thread(tweet_id, handle=author_handle.lower(), client=client)


def _parent_carries_tag(parent_id: str, handle: str, *, client: httpx.Client | None) -> bool:
    """Whether the post ``parent_id`` mentions the bot, or cannot be read.

    One free syndication read, only for a reply whose sole ``@ViditBot`` sits
    in X's prefix (:func:`_tag_is_inherited`). An unreadable parent (deleted,
    protected, withheld) answers ``True``: silence beats a spurious failure
    reply on someone else's thread.
    """
    try:
        parent = record_by_id(parent_id, handle=handle, client=client)
    except TweetImportError:
        return True
    return tags_bot(parent.text, settings.x_bot_handle, inherits_prefix=False)


async def _tag_is_inherited(mention: Mention, *, client: httpx.Client | None) -> bool:
    """Whether X wrote this mention's ``@ViditBot`` rather than its author.

    Checked in order, each spending only what the previous could not settle:

    * not a reply: typed;
    * the tag sits past the prefix (:func:`tags_bot`): typed;
    * otherwise the parent decides: if it mentions the bot, the tag was
      inherited. A reply to the bot's own post is inherited without the read.

    An inherited tag is ledgered ``inherited`` with no acquisition or reply. A
    parent that mentions no bot leaves the tag typed, so a bare ``@ViditBot``
    under the analyst's own coordinate post still works.
    """
    if mention.in_reply_to_status_id is None:
        return False
    if tags_bot(mention.text, settings.x_bot_handle, inherits_prefix=True):
        return False
    if mention.in_reply_to_user_id == settings.x_bot_user_id:
        return True
    # Blocking network I/O, offloaded like the acquisition's.
    return await asyncio.to_thread(
        _parent_carries_tag,
        mention.in_reply_to_status_id,
        mention.author_handle,
        client=client,
    )


# Ref length in the success reply: the UUID's first block, enough to find the
# detection in the queue without eating the reply.
_REPLY_REF_CHARS = 8


def _reply(
    header: str, warnings: Iterable[str], *, footer: str = "Review from your profile"
) -> str:
    """The success reply's shape: header, one warning line each, footer.

    Shared by both success composers. Sentences come from ``WARNING_MESSAGES``
    (also used by the archive email and import panel); this owns only the glyph
    and the length cap. ``footer`` differs: review for a detection, the edit
    under the profile's *Open requests* block for a request.
    """
    raised = set(warnings)
    lines = [header]
    lines.extend(f"⚠ {message}" for code, message in WARNING_MESSAGES.items() if code in raised)
    lines.append(footer)
    return _within_reply_cap("\n".join(lines))


def compose_reply(
    created_id: str, *, detections: int, warnings: Iterable[str], updated: bool = False
) -> str:
    """The in-thread reply for a mention that wrote its detections.

    ``updated`` swaps the verb when the pass overwrote an open detection
    instead of creating one.

    Linkless by contract: a bare event ref (``_REPLY_REF_CHARS``), never a URL
    (X bills links about 13x higher; the link lives in the bot bio). The ref
    also makes each reply unique against X's duplicate-content 403. The ❌ twin
    is :func:`compose_failure_reply`; the body is :func:`_reply`.
    """
    plural = "s" if detections > 1 else ""
    verb = "updated" if updated else "saved"
    return _reply(
        f"✅ {detections} detection{plural} {verb} · ref {created_id[:_REPLY_REF_CHARS]}", warnings
    )


def compose_request_reply(event_id: str, *, warnings: Iterable[str]) -> str:
    """The in-thread reply for a mention that opened a request.

    The twin of :func:`compose_reply` for a thread with footage and a source
    but no coordinate. The header names a request, so the analyst does not
    look for a coordinate the bot never read; the footer names the edit, since
    a request has no review queue. Linkless and unique via the event ref.
    """
    return _reply(
        f"✅ Geolocation request opened · ref {event_id[:_REPLY_REF_CHARS]}",
        warnings,
        footer="Edit it from your profile",
    )


# Where to go when there is nothing to diagnose (a handle is not a link).
_ADMIN_CONTACT = "@vidithq"


def compose_failure_reply(reason: str | None = None, *, mention_id: str) -> str:
    """The in-thread reply for a linked author whose tag produced nothing.

    Mirrors :func:`compose_reply`: a header, one line naming what the engine
    saw (``REFUSAL_MESSAGES``, the same sentence the paste uses), and a footer.
    No lesson or fix recipe: the rules live behind the bio link.

    Linkless (the "source link" phrase is a placeholder). Only posted to linked
    authors, never on a reply to the bot (the caller's loop guard). The
    ``mention_id`` tail makes each reply unique (X 403s a repeat) and is
    greppable in the ledger. Length must stay under ``REPLY_MAX_WEIGHTED_LEN``.
    """
    head = "❌ Nothing saved"
    ref = f" (m{mention_id[-5:]})"
    diagnosis = REFUSAL_MESSAGES.get(reason or "")
    # No code: the write path raised on every detection, which the analyst
    # can't fix, so point them at the maintainers.
    warning = f"⚠ {diagnosis}" if diagnosis else f"⚠ Unexpected case. Reach out to {_ADMIN_CONTACT}"
    return _within_reply_cap("\n".join([head, warning, f"Guide in bio{ref}"]))


def bot_credentials() -> OAuth1Credentials:
    """The bot account's OAuth 1.0a user context, read from settings."""
    return OAuth1Credentials(
        consumer_key=settings.x_api_consumer_key,
        consumer_secret=settings.x_api_consumer_secret,
        access_token=settings.x_bot_access_token,
        access_token_secret=settings.x_bot_access_token_secret,
    )


def _post_reply_failsoft(mention: Mention, text: str, *, client: httpx.Client | None) -> str | None:
    """Post the reply if write credentials are set; ``None`` otherwise or on failure.

    The detection is already durable, so a lost reply never fails the mention.
    """
    if not settings.x_api_consumer_key:
        return None
    try:
        return post_reply(
            text=text,
            in_reply_to_tweet_id=mention.tweet_id,
            credentials=bot_credentials(),
            client=client,
        )
    except XApiError as exc:
        logger.warning("Bot reply failed for mention %s: %s", mention.tweet_id, exc)
        # Duplicate-content 403 (e.g. re-processing after a restore) is expected.
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
        # Blocking I/O; offloaded to keep the event loop serving siblings.
        acquired = await asyncio.to_thread(
            acquire_tagged_thread,
            mention.tweet_id,
            mention.author_handle,
            client=syndication_client,
        )
    except TweetNotAccessible:
        # Deleted, protected, age-restricted or withheld posts (conflict footage
        # is often age-gated). Not an outage: ledger ``no_detection`` so the
        # failure reply answers, instead of ``failed`` + a false Sentry alert.
        return "no_detection", 0, None, POST_UNREADABLE
    # Only the bot asks for the engine's request-draft exit.
    resolution = acquired.resolve(with_requests=True)
    if owner is None:
        # The engine runs, writing nothing, so ``no_account`` marks only
        # mentions where a link would have produced a detection or request.
        if resolution.detections or resolution.requests:
            return "no_account", 0, None, None
        return "no_detection", 0, None, resolution.reason
    assembled = await persist_detections(
        db,
        owner=owner,
        resolution=resolution,
        via="bot",
        fetch_media=fetch_cdn_media,
    )
    if assembled.reason == COORDS_MISSING and resolution.requests:
        # Footage and a source but no coordinate: open a request. A draft that
        # writes nothing falls through to the failure reply below.
        opened = await open_request(
            db,
            owner=owner,
            draft=resolution.requests[0],
            fetch_media=fetch_cdn_media,
        )
        if opened is not None and opened.created is not None:
            request_reply_id: str | None = None
            if reply_allowed:
                # Same budget as a detection's reply; a second allowance would
                # exceed the cap the ledger reads back.
                request_reply_id = _post_reply_failsoft(
                    mention,
                    compose_request_reply(str(opened.created), warnings=opened.warnings),
                    client=x_write_client,
                )
            else:
                logger.warning(
                    "Reply budget reached; request opened without reply for mention %s",
                    mention.tweet_id,
                )
            return "requested", 0, request_reply_id, None
        if opened is not None and opened.existing is not None:
            # The analyst already holds a row for it; silent like other dedups.
            return "skipped", 0, None, None
        if opened is not None and opened.refusal is not None:
            # Name the footage refusal (size cap, unreadable bytes), or "no
            # coordinate" would send the analyst after the wrong fix.
            return "no_detection", 0, None, opened.refusal
    if assembled.reason is not None:
        if assembled.reason == COORDS_MISSING and resolution.request_reason is not None:
            # Source but no footage: "attach the clip" rather than "add the
            # coordinate". Other coordinate-less threads keep ``coords_missing``.
            return "no_detection", 0, None, resolution.request_reason
        return "no_detection", 0, None, assembled.reason
    if not assembled.created and not assembled.updated:
        # ``skipped`` is dedup; a persist that raised on every detection is
        # ``failed``, which stays on the operator's retry path (delete the row).
        return ("failed" if assembled.failed else "skipped"), 0, None, None
    reply_id: str | None = None
    if reply_allowed:
        reply_id = _post_reply_failsoft(mention, _success_reply(assembled), client=x_write_client)
    else:
        logger.warning(
            "Reply budget reached; detection written without reply for mention %s",
            mention.tweet_id,
        )
    if assembled.created:
        return "created", len(assembled.created), reply_id, None
    # An edited, already-imported post: the newer parse landed on the open
    # detection, which earns the success reply and its own verdict.
    return "updated", 0, reply_id, None


def _success_reply(assembled: Outcome) -> str:
    """The composed success reply for one mention's outcome.

    The ref is the first row written, created before updated; the
    ``several_coordinates`` warning covers multi-row threads.
    """
    written = assembled.created or assembled.updated
    return compose_reply(
        str(written[0]),
        detections=len(written),
        warnings=assembled.warnings,
        updated=not assembled.created,
    )


# Verdicts that earn a linked author a failure reply: ``no_detection`` (named by
# code) and ``failed`` (the unexpected case). ``created`` / ``updated`` post the
# success reply, ``requested`` posts its own inside the pipeline, and
# ``skipped`` is a dedup, not a failure.
_ANSWERED_VERDICTS = ("no_detection", "failed")


def _finish(
    db: Session,
    row_id: uuid.UUID,
    *,
    outcome: BotMentionOutcome,
    created_event_count: int = 0,
    reply_post_id: str | None = None,
) -> None:
    """Land a processed mention ``done`` with its outcome, and clear its payload."""
    row = db.get(BotMention, row_id)
    assert row is not None  # the claim committed it; nothing deletes a running row
    row.status = "done"
    row.outcome = outcome
    row.created_event_count = created_event_count
    row.reply_post_id = int(reply_post_id) if reply_post_id is not None else None
    row.payload = None
    row.processed_at = datetime.now(UTC)
    db.commit()


async def _process_claimed(
    db: Session,
    row_id: uuid.UUID,
    mention: Mention,
    *,
    syndication_client: httpx.Client | None,
    x_write_client: httpx.Client | None,
    budget: GestureBudget,
    outcome: BotRunOutcome,
) -> BotMentionOutcome:
    """Run one claimed mention through the pipeline and response model, and land its row.

    A processing exception lands ``failed`` (captured to Sentry) so the drain moves on.
    """
    created: int = 0
    reply_id: str | None = None
    if mention.author_id == settings.x_bot_user_id:
        # The bot's own posts can appear in its timeline: recorded, never processed.
        verdict: BotMentionOutcome = "self"
    elif await _tag_is_inherited(mention, client=syndication_client):
        # Unanswered, since a failure reply would refuse a tag nobody made.
        verdict = "inherited"
    else:
        # The one handle-to-account read: the detections' owner and the failure-reply gate.
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
            verdict, created, reply_id = "failed", 0, None
        else:
            if (
                verdict in _ANSWERED_VERDICTS
                and owner is not None
                and mention.in_reply_to_user_id != settings.x_bot_user_id
                and budget.reply_allowed(mention.author_handle)
            ):
                # The ``in_reply_to_user_id`` guard breaks the loop where a courtesy
                # answer to the bot's own reply (which auto-mentions it) earns another.
                reply_id = _post_reply_failsoft(
                    mention,
                    compose_failure_reply(failure_reason, mention_id=mention.tweet_id),
                    client=x_write_client,
                )
    _finish(db, row_id, outcome=verdict, created_event_count=created, reply_post_id=reply_id)
    outcome.created_event_count += created
    if reply_id is not None:
        budget.note_reply(mention.author_handle)
        outcome.replies_posted += 1
    if verdict == "updated":
        outcome.events_updated += 1
    elif verdict == "requested":
        outcome.requests_opened += 1
    elif verdict == "inherited":
        outcome.inherited += 1
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
    # The overlap re-reads the trailing interval (see _SINCE_ID_OVERLAP).
    latest = db.query(func.max(BotMention.mention_post_id)).scalar()
    return str(max(int(latest) - _SINCE_ID_OVERLAP, 1)) if latest is not None else None


def is_configured() -> bool:
    """Whether the mentions-read credentials are set, so the catch-up can run."""
    return bool(settings.x_bot_bearer_token and settings.x_bot_user_id)


def enqueue_mentions(db: Session, mentions: list[Mention]) -> list[Mention]:
    """Insert each mention as a ``queued`` row unless its post is already in the table; one
    commit. Returns the mentions inserted.

    Shared by the webhook, which must answer X fast, and the catch-up. ``ON CONFLICT DO
    NOTHING`` makes a redelivery, or a mention both paths saw, a no-op.
    """
    if not mentions:
        return []
    inserted = set(
        db.scalars(
            insert(BotMention)
            .values(
                [
                    {
                        "id": uuid.uuid4(),
                        "mention_post_id": int(m.tweet_id),
                        "author_x_handle": m.author_handle,
                        "payload": dataclasses.asdict(m),
                        "status": "queued",
                        "attempt_count": 0,
                        "created_event_count": 0,
                        "created_at": datetime.now(UTC),
                    }
                    for m in mentions
                ]
            )
            .on_conflict_do_nothing(index_elements=["mention_post_id"])
            .returning(BotMention.mention_post_id)
        ).all()
    )
    db.commit()
    return [m for m in mentions if int(m.tweet_id) in inserted]


def catch_up(db: Session, *, x_read_client: httpx.Client | None = None) -> BotRunOutcome:
    """Pull the mentions timeline since the last mention and queue the new ones: the net
    behind the webhook, run by the worker every :data:`CATCH_UP_INTERVAL`.

    While the webhook is live (``X_WEBHOOK_ENABLED``) a mention this pull queues fresh means
    the webhook missed it, so a Sentry message fires (the gap detector).
    """
    if not is_configured():
        raise BotNotConfigured("X_BOT_BEARER_TOKEN and X_BOT_USER_ID must be set to run the bot")
    outcome = BotRunOutcome()
    mentions = fetch_mentions(
        user_id=settings.x_bot_user_id,
        bearer_token=settings.x_bot_bearer_token,
        since_id=_since_id(db),
        client=x_read_client,
    )
    outcome.mentions_seen = len(mentions)
    fresh = enqueue_mentions(db, mentions)
    outcome.already_handled = len(mentions) - len(fresh)
    if settings.x_webhook_enabled:
        for mention in fresh:
            if mention.author_id == settings.x_bot_user_id:
                continue
            message = f"webhook gap: mention {mention.tweet_id} arrived via the catch-up"
            logger.warning(message)
            sentry_sdk.capture_message(message, level="warning")
    return outcome


def _claim(db: Session) -> BotMention | None:
    """Claim the oldest claimable mention, or ``None`` when drained.

    ``queued``, or ``running`` past :data:`STALE_RUNNING_AFTER` (a hard-killed worker's).
    ``FOR UPDATE SKIP LOCKED`` like the archive jobs: the claim sets ``running``, bumps
    ``attempt_count``, stamps ``processed_at`` and commits, so concurrent workers skip it.
    Rows past the attempt budget land ``failed``.
    """
    while True:
        now = datetime.now(UTC)
        row = (
            db.query(BotMention)
            .filter(
                or_(
                    BotMention.status == "queued",
                    and_(
                        BotMention.status == "running",
                        BotMention.processed_at < now - STALE_RUNNING_AFTER,
                    ),
                )
            )
            .order_by(BotMention.created_at)
            .with_for_update(skip_locked=True)
            .first()
        )
        if row is None:
            return None
        row.processed_at = now
        if row.attempt_count >= _MAX_ATTEMPTS:
            row.status = "failed"
            db.commit()
            continue
        row.status = "running"
        row.attempt_count += 1
        db.commit()
        return row


def _mention_from_payload(payload: dict | None) -> Mention | None:
    if payload is None:
        return None
    tweet_id = payload.get("tweet_id")
    author_id = payload.get("author_id")
    author_handle = payload.get("author_handle")
    text = payload.get("text")
    reply_to = payload.get("in_reply_to_user_id")
    reply_to_status = payload.get("in_reply_to_status_id")
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
        in_reply_to_status_id=reply_to_status if isinstance(reply_to_status, str) else None,
    )


async def drain_mentions(
    db: Session,
    *,
    syndication_client: httpx.Client | None = None,
    x_write_client: httpx.Client | None = None,
) -> BotRunOutcome:
    """Process every claimable mention through the pipeline, oldest first.

    Called by the import worker between archive drains. A pipeline exception
    lands the mention ``done`` with the outcome ``failed``. Any other exception
    re-queues the claimed row (bounded by the attempt budget) and propagates so
    the worker backs off.
    """
    outcome = BotRunOutcome()
    budget = GestureBudget.from_ledger(db)
    while (row := _claim(db)) is not None:
        row_id = row.id
        mention = _mention_from_payload(row.payload)
        if mention is None:
            logger.warning("Dropping malformed mention %s: %r", row_id, row.payload)
            row.status = "failed"
            db.commit()
            continue
        outcome.mentions_processed += 1
        try:
            await _process_claimed(
                db,
                row_id,
                mention,
                syndication_client=syndication_client,
                x_write_client=x_write_client,
                budget=budget,
                outcome=outcome,
            )
        except Exception:
            db.rollback()
            fresh = db.get(BotMention, row_id)
            if fresh is not None:
                fresh.status = "queued"
                db.commit()
            raise
    return outcome
