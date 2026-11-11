"""Content reports and the takedown they resolve into.

The report verdicts and the direct event moderation share a home because they perform the same
mutations and must leave the same audit trail.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Literal, NamedTuple

from fastapi import BackgroundTasks
from sqlalchemy import ColumnElement, func
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.errors import CodedError
from app.models.collection import Collection
from app.models.content_report import (
    ContentReport,
    ContentReportReason,
    ContentReportResolution,
)
from app.models.event import Event
from app.models.site import Site
from app.models.user import User
from app.schemas.report import ContentReportCreate
from app.services import email
from app.services.admin import log_admin_event, move_site_takedown, withhold_collection
from app.services.collections import (
    CollectionNotFoundError,
    erase_if_released,
    visible_collections,
)
from app.services.event_filters import visible_events
from app.services.events.errors import EventNotFoundError
from app.services.row_locks import lock_row
from app.services.sites import SiteNotFoundError, visible_sites


class ReportError(CodedError):
    code: str = "report_error"
    status_code = 400


class ReportNotFoundError(ReportError):
    code = "report_not_found"
    status_code = 404


class ReportAlreadyResolvedError(ReportError):
    code = "report_already_resolved"
    status_code = 409


class ReportTargetGoneError(ReportError):
    code = "report_target_gone"
    status_code = 409


class ReportVerdictNotApplicableError(ReportError):
    code = "report_verdict_not_applicable"
    status_code = 409


class _Target(NamedTuple):
    model: Any
    title: Any
    visible: Callable[[], tuple[ColumnElement[bool], ...]]
    link: Callable[[str], str]
    not_found: type[CodedError]
    not_found_message: str


ReportKind = Literal["event", "collection", "site"]

# Each kind files against ``ContentReport.<kind>_id`` (``ck_content_reports_one_target``). The
# visibility read is viewer-blind: an admin reads a withheld collection or site, but nobody files
# a report against one.
_TARGETS: dict[str, _Target] = {
    "event": _Target(
        Event, Event.title, visible_events, email.event_link, EventNotFoundError, "Event not found"
    ),
    "collection": _Target(
        Collection,
        Collection.title,
        visible_collections,
        email.collection_link,
        CollectionNotFoundError,
        "Collection not found",
    ),
    "site": _Target(
        Site, Site.name, visible_sites, email.site_link, SiteNotFoundError, "Site not found"
    ),
}


def _file_report(
    db: Session,
    *,
    kind: ReportKind,
    target_id: uuid.UUID,
    reason: ContentReportReason,
    details: str | None,
    reporter_id: uuid.UUID | None,
    reporter_username: str | None,
    background_tasks: BackgroundTasks,
) -> ContentReport:
    target = _TARGETS[kind]
    visible = (
        db.query(target.model.id, target.title.label("title"))
        .filter(target.model.id == target_id, *target.visible())
        .first()
    )
    if visible is None:
        raise target.not_found(target.not_found_message)

    report = ContentReport(
        reason=reason, details=details, reporter_id=reporter_id, **{f"{kind}_id": target_id}
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    address = settings.report_notify_email
    if address:
        # Built here, so no ORM row reaches the task, which runs after the session closes.
        message = email.content_report_email(
            to=address,
            target=kind,
            target_id=str(target_id),
            target_title=visible.title,
            target_link=target.link(str(target_id)),
            reason=report.reason,
            details=report.details,
            reporter=reporter_username or "anonymous",
            created_at=report.created_at,
        )
        background_tasks.add_task(
            email.send_best_effort,
            message,
            what=f"content report notification for report {report.id}",
        )
    return report


def create_report(
    db: Session,
    *,
    kind: ReportKind,
    target_id: uuid.UUID,
    body: ContentReportCreate,
    reporter: User | None,
    background_tasks: BackgroundTasks,
) -> ContentReport:
    """File one report against a target a reader can see, or raise the target's not-found error."""
    return _file_report(
        db,
        kind=kind,
        target_id=target_id,
        reason=body.reason,
        details=body.details,
        reporter_id=reporter.id if reporter is not None else None,
        reporter_username=reporter.username if reporter is not None else None,
        background_tasks=background_tasks,
    )


def create_event_report(
    db: Session,
    *,
    event_id: uuid.UUID,
    reason: ContentReportReason,
    details: str | None,
    reporter_id: uuid.UUID | None,
    reporter_username: str | None,
    background_tasks: BackgroundTasks,
) -> ContentReport:
    return _file_report(
        db,
        kind="event",
        target_id=event_id,
        reason=reason,
        details=details,
        reporter_id=reporter_id,
        reporter_username=reporter_username,
        background_tasks=background_tasks,
    )


def list_reports(db: Session, *, page: int, per_page: int) -> tuple[list[ContentReport], int]:
    """``ix_content_reports_queue`` carries the three order expressions in this order; change
    both together."""
    total = db.query(func.count(ContentReport.id)).scalar() or 0
    rows = (
        db.query(ContentReport)
        .options(
            joinedload(ContentReport.event).joinedload(Event.owner),
            joinedload(ContentReport.collection).joinedload(Collection.owner),
            joinedload(ContentReport.site).joinedload(Site.owner),
        )
        .order_by(
            ContentReport.resolved_at.isnot(None),
            ContentReport.created_at.desc(),
            ContentReport.id.desc(),
        )
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return rows, total


def _mark_graphic(db: Session, *, event: Event, actor_id: uuid.UUID, graphic: bool) -> bool:
    """Set or clear the graphic flag on every source of the event, and return whether a source
    changed: a no-op writes no audit row."""
    moved = [source for source in event.sources if source.is_graphic != graphic]
    if not moved:
        return False
    for source in moved:
        source.is_graphic = graphic
    log_admin_event(
        db,
        actor_id=actor_id,
        action="event_marked_graphic" if graphic else "event_unmarked_graphic",
        target={"event_id": str(event.id)},
    )
    return True


def _set_hidden(db: Session, *, event: Event, actor_id: uuid.UUID, hidden: bool) -> bool:
    """Withhold the event from public reads, or restore it, and return whether it changed."""
    if hidden == (event.hidden_at is not None):
        return False
    event.hidden_at = datetime.now(UTC) if hidden else None
    log_admin_event(
        db,
        actor_id=actor_id,
        action="event_hidden" if hidden else "event_unhidden",
        target={"event_id": str(event.id)},
    )
    return True


def resolve_report(
    db: Session,
    *,
    report_id: uuid.UUID,
    resolution: ContentReportResolution,
    actor_id: uuid.UUID,
) -> tuple[ContentReport, bool]:
    """Close one report with a verdict, applying it to what the report names.

    The report is locked first and its verdict re-checked, so concurrent resolves serialize and
    the loser gets :class:`ReportAlreadyResolvedError`. Target-mutating verdicts lock their
    target the same way. ``hidden_changed`` tells the router to drop the points cache.
    """
    report = lock_row(db, ContentReport, ContentReport.id == report_id).first()
    if report is None:
        raise ReportNotFoundError("Report not found")
    if report.resolved_at is not None:
        raise ReportAlreadyResolvedError("This report is already resolved")

    hidden_changed = False
    collection: Collection | None = None
    if report.collection_id is not None:
        # Locked whatever the verdict, serializing with ``DELETE /admin/collections/{id}`` and
        # with the owner's delete, which reads the open reports under the same lock. Withheld
        # and owner-deleted collections stay reachable (the stamp is idempotent).
        collection = lock_row(db, Collection, Collection.id == report.collection_id).one()
    site: Site | None = None
    if report.site_id is not None and resolution != "dismissed":
        site = lock_row(db, Site, Site.id == report.site_id).one()
    # ``dismissed`` touches no target, so it skips the event fetch and lock.
    if resolution != "dismissed":
        if report.event_id is not None:
            # Locked so a resolve racing the direct moderation endpoint
            # serializes. Soft-deleted and hidden events stay reachable: a
            # report filed before the removal still deserves a verdict.
            event = lock_row(db, Event, Event.id == report.event_id).one()
            if resolution == "marked_graphic":
                _mark_graphic(db, event=event, actor_id=actor_id, graphic=True)
            elif resolution == "hidden":
                hidden_changed = _set_hidden(db, event=event, actor_id=actor_id, hidden=True)
        elif collection is not None or site is not None:
            if resolution == "marked_graphic":
                raise ReportVerdictNotApplicableError(
                    "Only an event carries footage, so only an event can be marked graphic"
                )
            if collection is not None:
                withhold_collection(db, collection=collection, actor_id=actor_id)
            elif site is not None:
                move_site_takedown(db, site=site, hidden=True, actor_id=actor_id)
        else:
            raise ReportTargetGoneError(
                "The reported item was deleted, so this report can only be dismissed"
            )

    ids = {f"{kind}_id": getattr(report, f"{kind}_id") for kind in _TARGETS}
    report.resolved_at = datetime.now(UTC)
    report.resolution = resolution
    report.resolved_by_id = actor_id
    log_admin_event(
        db,
        actor_id=actor_id,
        action="report_resolved",
        target={
            "report_id": str(report.id),
            # Every key always present so one shape reads the trail.
            **{key: str(value) if value is not None else None for key, value in ids.items()},
            "resolution": resolution,
        },
    )
    if collection is not None:
        erased = {"collection_id": str(collection.id), "title": collection.title}
        if erase_if_released(db, collection=collection):
            log_admin_event(db, actor_id=actor_id, action="collection_erased", target=erased)
    db.commit()
    db.refresh(report)
    return report, hidden_changed


def set_event_moderation(
    db: Session,
    *,
    geolocation_id: uuid.UUID,
    is_graphic: bool | None,
    hidden: bool | None,
    actor_id: uuid.UUID,
) -> tuple[Event, bool]:
    """Apply an admin's moderation state to one event, with no report behind it.

    It reads a withheld event, since this verb can undo a takedown. The event lock serializes
    this door and a report verdict.
    """
    event = lock_row(db, Event, Event.id == geolocation_id, Event.deleted_at.is_(None)).first()
    if event is None:
        raise EventNotFoundError("Event not found")

    if is_graphic is not None:
        _mark_graphic(db, event=event, actor_id=actor_id, graphic=is_graphic)
    hidden_changed = (
        _set_hidden(db, event=event, actor_id=actor_id, hidden=hidden)
        if hidden is not None
        else False
    )

    db.commit()
    db.refresh(event)
    return event, hidden_changed
