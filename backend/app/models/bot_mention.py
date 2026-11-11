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


BotMentionStatus = Literal["queued", "running", "done", "failed"]


class BotMention(Base):
    __tablename__ = "bot_mentions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mention_post_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    author_x_handle: Mapped[str] = mapped_column(String(50))
    payload: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[BotMentionStatus] = mapped_column(String(10), default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[BotMentionOutcome | None] = mapped_column(String(20))
    created_event_count: Mapped[int] = mapped_column(Integer, default=0)
    reply_post_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[CreatedAt]
    processed_at: Mapped[datetime | None]

    __table_args__ = (
        literal_check("status", BotMentionStatus, "ck_bot_mentions_status_valid"),
        literal_check("outcome", BotMentionOutcome, "ck_bot_mentions_outcome_valid", nullable=True),
        CheckConstraint(
            "(status = 'done') = (outcome IS NOT NULL)", name="ck_bot_mentions_outcome_done"
        ),
        Index(
            "ix_bot_mentions_claim",
            "created_at",
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )


class BotCatchUpCursor(Base):
    __tablename__ = "bot_catch_up_cursor"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    newest_post_id: Mapped[int | None] = mapped_column(BigInteger)
    pulled_at: Mapped[datetime]

    __table_args__ = (CheckConstraint("id = 1", name="ck_bot_catch_up_cursor_single_row"),)
