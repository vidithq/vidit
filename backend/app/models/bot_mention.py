import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# What one mention pull did with a tagged tweet. ``created`` — at least one
# ``detected`` row landed; ``no_detection`` — the thread yielded no coordinate
# (recorded silently, no reply, so a courtesy reply to the bot can't loop it
# into answering itself); ``skipped`` — every detection deduped against an
# existing row; ``failed`` — processing raised (captured to Sentry; delete the
# row to retry that mention on the next run).
BotMentionOutcome = Literal["created", "no_detection", "skipped", "failed"]


class BotMention(Base):
    """One processed @-mention of the bot — the poll's idempotency ledger.

    A mention is recorded whatever its outcome, so a run never re-processes
    (and never re-bills) a tweet it has already seen: the next pull's
    ``since_id`` is the max ``mention_tweet_id`` here, and mentions already
    present are skipped even if the API re-serves them.
    """

    __tablename__ = "bot_mentions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The tagged tweet's id (X snowflake, numeric string). UNIQUE is the
    # idempotency guarantee; max() over the numeric cast is the poll cursor.
    mention_tweet_id: Mapped[str] = mapped_column(String(25), unique=True, nullable=False)
    # The tagging analyst's handle, normalized (lowercase, no leading @) —
    # operator forensics, not a FK: the assembled profile lives in ``users``.
    author_handle: Mapped[str] = mapped_column(String(50), nullable=False)
    outcome: Mapped[BotMentionOutcome] = mapped_column(String(20), nullable=False)
    events_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # The bot's in-thread reply, when one was posted. NULL when nothing was
    # created, reply credentials are absent, or the post failed (fail-soft:
    # the detection is durable even when the reply isn't).
    reply_tweet_id: Mapped[str | None] = mapped_column(String(25), nullable=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
