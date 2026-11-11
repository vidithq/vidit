import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, literal_check

ContentReportReason = Literal[
    "illegal_content",
    "graphic_not_flagged",
    "copyright",
    "privacy",
    "other",
]

ContentReportResolution = Literal["marked_graphic", "hidden", "dismissed"]


class ContentReport(Base):
    __tablename__ = "content_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), index=True
    )
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("collections.id", ondelete="SET NULL"), index=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="SET NULL"), index=True
    )
    reason: Mapped[ContentReportReason] = mapped_column(String(30))
    details: Mapped[str | None] = mapped_column(Text)
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[CreatedAt]
    resolved_at: Mapped[datetime | None]
    resolution: Mapped[ContentReportResolution | None] = mapped_column(String(30))
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    event = relationship("Event")
    collection = relationship("Collection")
    site = relationship("Site")

    __table_args__ = (
        literal_check("reason", ContentReportReason, "ck_content_reports_reason_valid"),
        literal_check(
            "resolution",
            ContentReportResolution,
            "ck_content_reports_resolution_valid",
            nullable=True,
        ),
        CheckConstraint(
            "(resolution IS NULL AND resolved_at IS NULL)"
            " OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_content_reports_resolution_stamp",
        ),
        CheckConstraint(
            "num_nonnulls(event_id, collection_id, site_id) <= 1",
            name="ck_content_reports_one_target",
        ),
        Index(
            "ix_content_reports_queue",
            text("(resolved_at IS NOT NULL)"),
            text("created_at DESC"),
            text("id DESC"),
        ),
    )
