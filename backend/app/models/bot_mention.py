import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt, literal_check

# What one mention did with a tagged tweet. ``created``: at least one
# ``detected`` row landed. ``updated``: no row created, but a newer parse
# overwrote an open detection (earns the success reply). ``no_detection``: no
# coordinate (a linked author gets the failure reply unless the tagged tweet
# replies to the bot, the ``services/bot`` loop guard). ``no_account``: no live
# account carries the author's ``x_handle``; nothing created or posted.
# ``skipped``: every detection deduped and moved nothing. ``requested``: no
# coordinate but footage and a source link, so a ``requested`` row opened
# (``services/bot``). ``inherited``: X's reply prefix carried the tag from the
# parent, so nothing was acquired or answered. ``self``: the bot's own post;
# held only by existing rows, since the enqueue drops the bot's own posts
# (``services/bot``). ``failed``: processing raised (captured to Sentry).
BotMentionOutcome = Literal[
    "created",
    "updated",
    "requested",
    "inherited",
    "no_detection",
    "no_account",
    "skipped",
    "self",
    "failed",
]


# Where a mention stands in the worker's queue. ``queued``: waiting for the
# worker. ``running``: claimed; a row left ``running`` past
# ``services/bot.STALE_RUNNING_AFTER`` is claimed again. ``done``: the pipeline
# ran, whatever its ``outcome``. ``failed``: the payload was malformed, or the
# attempt budget is spent (poison-pill guard).
BotMentionStatus = Literal["queued", "running", "done", "failed"]


class BotMention(Base):
    """One @-mention of the bot: the queue the worker drains and the ledger it leaves.

    The webhook and the daily catch-up both insert one row per mention with
    ``ON CONFLICT (mention_post_id) DO NOTHING``, so a mention seen by both is
    processed, and billed, once.
    """

    __tablename__ = "bot_mentions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The tagged post's id (X snowflake). UNIQUE is the idempotency guarantee.
    mention_post_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    # Normalized handle (lowercase, no @), for forensics, not a FK: attribution
    # goes through ``users.x_handle``.
    author_x_handle: Mapped[str] = mapped_column(String(50))
    # The ``x_api.Mention`` as a dict, so the drain never re-reads (re-bills) the
    # API. Cleared once the row is ``done``.
    payload: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[BotMentionStatus] = mapped_column(String(10), default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    # Set exactly when ``done``.
    outcome: Mapped[BotMentionOutcome | None] = mapped_column(String(20))
    created_event_count: Mapped[int] = mapped_column(Integer, default=0)
    # The bot's in-thread reply, if posted. NULL when none was owed, credentials
    # are absent, the budget was spent, or the post failed (fail-soft).
    reply_post_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[CreatedAt]
    # When the worker last took the row: its claim while ``running``, its finish
    # once ``done`` or ``failed``.
    processed_at: Mapped[datetime | None]

    __table_args__ = (
        literal_check("status", BotMentionStatus, "ck_bot_mentions_status_valid"),
        literal_check("outcome", BotMentionOutcome, "ck_bot_mentions_outcome_valid", nullable=True),
        CheckConstraint(
            "(status = 'done') = (outcome IS NOT NULL)", name="ck_bot_mentions_outcome_done"
        ),
        # The claim walk, oldest first.
        Index(
            "ix_bot_mentions_claim",
            "created_at",
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )


class BotCatchUpCursor(Base):
    """Where the mentions catch-up stands: one row, written after each pull.

    The next pull reads from ``newest_post_id``, and the worker skips a pull
    while ``pulled_at`` is at or after the latest ``services/bot.CATCH_UP_SLOT``.
    """

    __tablename__ = "bot_catch_up_cursor"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    # The newest mention id a pull returned: the next pull's ``since_id``.
    newest_post_id: Mapped[int | None] = mapped_column(BigInteger)
    pulled_at: Mapped[datetime]

    __table_args__ = (CheckConstraint("id = 1", name="ck_bot_catch_up_cursor_single_row"),)
