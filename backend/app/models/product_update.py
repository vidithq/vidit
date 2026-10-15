import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.notification import DeliveryState

ConsentSource = Literal["sign_up", "settings"]


class ProductUpdateConsent(Base):
    """One grant of consent to product update emails, kept after it is withdrawn.

    A withdrawal stamps ``withdrawn_at`` and a later grant adds a new row, so
    the history of grants and withdrawals is never overwritten. At most one row
    per analyst is current (``withdrawn_at`` NULL).
    """

    __tablename__ = "product_update_consents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[ConsentSource] = mapped_column(String(10), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "source IN ('sign_up', 'settings')", name="ck_product_update_consents_source_valid"
        ),
        Index(
            "uq_product_update_consents_current",
            "user_id",
            unique=True,
            postgresql_where="withdrawn_at IS NULL",
        ),
    )


class ProductUpdate(Base):
    """One major release announcement, written when the admin sends it."""

    __tablename__ = "product_updates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # ``MAJOR.MINOR.0``; UNIQUE, so a label is sent once.
    label: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    recipient_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )


class ProductUpdateDelivery(DeliveryState, Base):
    """One announcement to email to one analyst who held a current consent
    when it was sent. The worker drains the queue
    (``services/product_updates.drain``)."""

    __tablename__ = "product_update_deliveries"

    product_update_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_updates.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    product_update = relationship("ProductUpdate")

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'sending', 'sent', 'failed', 'skipped')",
            name="ck_product_update_deliveries_status_valid",
        ),
        UniqueConstraint("product_update_id", "user_id", name="uq_product_update_deliveries_user"),
        Index("ix_product_update_deliveries_user_id", "user_id"),
        # The claim walk, oldest first.
        Index(
            "ix_product_update_deliveries_queued",
            "created_at",
            postgresql_where="status = 'queued'",
        ),
        # The daily cap count.
        Index(
            "ix_product_update_deliveries_sent_at",
            "sent_at",
            postgresql_where="status = 'sent'",
        ),
    )
