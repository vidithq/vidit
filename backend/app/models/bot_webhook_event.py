import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Lifecycle of one webhook-delivered mention. ``queued``: waiting for the
# worker. ``processing``: claimed (an exception re-queues it; a worker crash
# strands it and the reconciliation poll re-delivers). ``done``: the pipeline
# ran, whatever the ledger outcome (the ledger row is the retry path for a
# ledgered ``failed``). ``failed``: attempt budget spent (poison-pill guard).
BotWebhookEventStatus = Literal["queued", "processing", "done", "failed"]


class BotWebhookEvent(Base):
    """One mention delivered by the X Account Activity webhook, queued for the
    import worker.

    The endpoint must answer fast, so it only verifies, reduces the payload to
    ``Mention`` and inserts here. Idempotency lives in the ``bot_mentions``
    ledger: a mention seen by the webhook and the reconciliation poll processes
    once.
    """

    __tablename__ = "bot_webhook_events"
    # Matches the claim query (filter on status, order by created_at).
    __table_args__ = (Index("ix_bot_webhook_events_status_created_at", "status", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The ``Mention`` dataclass as a dict, so a drain never re-reads (re-bills) the API.
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
