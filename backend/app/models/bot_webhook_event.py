import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Lifecycle of one webhook-delivered mention. ``queued``: inserted by the
# webhook endpoint, waiting for the worker. ``processing``: claimed by a
# worker (a second worker's ``queued`` filter skips it; an exception
# re-queues it, a hard worker crash strands it and the reconciliation poll
# re-delivers the mention). ``done``: the worker ran the mention pipeline
# (whatever the ledger outcome, including a ledgered ``failed`` mention: the
# ledger row is the retry path, not this one); ``failed``: the attempt
# budget is spent (poison-pill guard).
BotWebhookEventStatus = Literal["queued", "processing", "done", "failed"]


class BotWebhookEvent(Base):
    """One mention delivered by the X Account Activity webhook, queued for
    the import worker.

    The webhook endpoint must answer fast, so it only verifies the signature,
    reduces the payload to the internal ``Mention`` shape, and inserts here;
    the always-on import worker drains the queue and runs the shared mention
    pipeline. Idempotency lives in the ``bot_mentions`` ledger, not here: a
    mention seen by both the webhook and the reconciliation poll processes
    once whichever path claims it first.
    """

    __tablename__ = "bot_webhook_events"
    # Composite to match the claim query (filter on status, order by
    # created_at) in one index scan.
    __table_args__ = (Index("ix_bot_webhook_events_status_created_at", "status", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The ``Mention`` dataclass as a dict (tweet_id, author_id, author_handle,
    # text, in_reply_to_user_id): everything the pipeline needs, so a drain
    # never re-reads (re-bills) the paid API.
    mention: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[BotWebhookEventStatus] = mapped_column(
        String(10), nullable=False, default="queued"
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
