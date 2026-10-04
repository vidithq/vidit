import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# What one mention did with a tagged tweet. ``created``: at least one
# ``detected`` row landed. ``updated``: no row created, but a newer parse
# overwrote an open detection (earns the success reply). ``no_detection``: no
# coordinate (a linked author gets the failure reply unless the tagged tweet
# replies to the bot, the ``services/bot`` loop guard). ``no_account``: no live
# account carries the author's ``x_handle``; nothing created or posted.
# ``skipped``: every detection deduped and moved nothing. ``requested``: no
# coordinate but footage and a source link, so a ``requested`` row opened
# (``services/bot``). ``inherited``: X's reply prefix carried the tag from the
# parent, so nothing was acquired or answered. ``self``: the bot's own post,
# recorded so the ``since_id`` cursor advances. ``failed``: processing raised
# (captured to Sentry; delete the row to retry).
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


class BotMention(Base):
    """One processed @-mention of the bot, the poll's idempotency ledger.

    Every mention is recorded whatever its outcome, so a run never re-processes
    or re-bills a seen tweet: ``since_id`` derives from the max
    ``mention_tweet_id`` (minus ``services/bot._SINCE_ID_OVERLAP``).
    """

    __tablename__ = "bot_mentions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The tagged tweet's id (X snowflake). UNIQUE is the idempotency guarantee;
    # max() over the numeric cast is the poll cursor.
    mention_tweet_id: Mapped[str] = mapped_column(String(25), unique=True, nullable=False)
    # Normalized handle (lowercase, no @), for forensics, not a FK: attribution
    # goes through ``users.x_handle``.
    author_handle: Mapped[str] = mapped_column(String(50), nullable=False)
    outcome: Mapped[BotMentionOutcome] = mapped_column(String(20), nullable=False)
    events_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # The bot's in-thread reply, if posted. NULL when none was owed, credentials
    # are absent, the budget was spent, or the post failed (fail-soft).
    reply_tweet_id: Mapped[str | None] = mapped_column(String(25), nullable=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
