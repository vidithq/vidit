import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Lifecycle of one webhook-delivered mention. ``queued``: inserted by the
# webhook endpoint, waiting for the worker. ``done``: the worker ran the
# mention pipeline (whatever the ledger outcome, including a ledgered
# ``failed`` mention: the ledger row is the retry path, not this one);
# ``failed``: the attempt budget is spent (poison-pill guard).
BotWebhookEventStatus = Literal["queued", "done", "failed"]


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

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The ``Mention`` dataclass as a dict (tweet_id, author_id, author_handle,
    # text, in_reply_to_user_id): everything the pipeline needs, so a drain
    # never re-reads (re-bills) the paid API.
    mention: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[BotWebhookEventStatus] = mapped_column(
        String(10), nullable=False, default="queued", index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
