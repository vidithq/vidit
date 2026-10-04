"""Content reports and the takedown they resolve into.

A report names one target, an event or a collection, and both walk one queue:
a viewer files one (:func:`create_event_report`, :func:`create_collection_report`),
an admin walks the queue (:func:`list_reports`) and closes a row with a verdict
(:func:`resolve_report`), or acts on an event directly
(:func:`set_event_moderation`). The two admin writes share a home because they
perform the same mutations (graphic flag, ``events.hidden_at``) and must leave
the same audit trail. The collection takedown is
``services/admin.withhold_collection``, shared with
``DELETE /admin/collections/{id}``.

Errors carry stable ``code`` strings; :data:`REPORT_ERROR_STATUS` is the one
code-to-HTTP mapping every router reads.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import NamedTuple

from fastapi import BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.models.collection import Collection
from app.models.content_report import (
    ContentReport,
    ContentReportReason,
    ContentReportResolution,
)
from app.models.event import Event
from app.services import email
from app.services.admin import log_admin_event, withhold_collection
from app.services.collections import visible_collections
from app.services.event_filters import visible_events

logger = logging.getLogger(__name__)


class ReportError(Exception):
    """Friendly error; ``code`` maps to HTTP status. Mirrors ``admin.AdminError``."""

    code: str = "report_error"


class EventNotFoundError(ReportError):
    """The reported (or moderated) event does not exist, is soft-deleted, or is
    already withheld from the public surface it was reached through."""

    code = "event_not_found"


class CollectionNotFoundError(ReportError):
    """The collection does not exist, is withheld, or belongs to a soft-deleted account.

    All three read alike so the caller cannot tell which. The code is the one
    every ``/collections`` path raises for an unreadable id.
    """

    code = "collection_not_found"


class ReportNotFoundError(ReportError):
    code = "report_not_found"


class ReportAlreadyResolvedError(ReportError):
    """The report already carries a verdict.

    Reports are resolved once, so a second resolve conflicts instead of
    overwriting the first verdict and its audit row.
    """

    code = "report_already_resolved"


class ReportTargetGoneError(ReportError):
    """The target was deleted (both target columns are SET NULL).

    Every verdict except ``dismissed`` mutates a row that no longer exists.
    """

    code = "report_target_gone"


class ReportVerdictNotApplicableError(ReportError):
    """The verdict does not exist for this target kind.

    ``marked_graphic`` is an event column; a collection holds no footage of
    its own. Refused so the admin learns the report is still open.
    """

    code = "report_verdict_not_applicable"


REPORT_ERROR_STATUS: dict[str, int] = {
    "event_not_found": 404,
    "collection_not_found": 404,
    "report_not_found": 404,
    "report_already_resolved": 409,
    "report_target_gone": 409,
    "report_verdict_not_applicable": 409,
}


def _notify_new_report(
    *,
    address: str,
    report_id: uuid.UUID,
    target: str,
    target_id: str,
    target_title: str,
    target_link: str,
    reason: ContentReportReason,
    details: str | None,
    reporter: str,
    created_at: datetime,
) -> None:
    """Tell the moderation address a report landed, best effort.

    Runs as a background task after the response; a provider outage is logged
    and swallowed. Takes plain values because the request's session is gone
    by then (an ORM row would be detached).
    """
    try:
        email.send(
            email.content_report_email(
                to=address,
                target=target,
                target_id=target_id,
                target_title=target_title,
                target_link=target_link,
                reason=reason,
                details=details,
                reporter=reporter,
                created_at=created_at,
            )
        )
    except email.EmailSendError as exc:
        logger.warning("content report notification send failed for report %s: %s", report_id, exc)


class _ReportTarget(NamedTuple):
    """What one report names. Exactly one id field is set (``ck_content_reports_one_target``)."""

    kind: str
    event_id: uuid.UUID | None
    collection_id: uuid.UUID | None
    title: str
    link: str


def _file_report(
    db: Session,
    *,
    target: _ReportTarget,
    reason: ContentReportReason,
    details: str | None,
    reporter_user_id: uuid.UUID | None,
    reporter_username: str | None,
    background_tasks: BackgroundTasks,
) -> ContentReport:
    """Write one report against a resolved target and notify the moderators.

    The caller resolves the target first, which is where the "cannot report
    what you cannot see" refusal lives. The notification is enqueued after the
    commit when an address is configured. ``reporter_username`` comes from the
    caller because the commit expires the row.
    """
    report = ContentReport(
        event_id=target.event_id,
        collection_id=target.collection_id,
        reason=reason,
        details=details,
        reporter_user_id=reporter_user_id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    address = settings.report_notify_email
    if address:
        background_tasks.add_task(
            _notify_new_report,
            address=address,
            report_id=report.id,
            target=target.kind,
            target_id=str(target.event_id or target.collection_id),
            target_title=target.title,
            target_link=target.link,
            reason=report.reason,
            details=report.details,
            reporter=reporter_username or "anonymous",
            created_at=report.created_at,
        )
    return report


def create_event_report(
    db: Session,
    *,
    event_id: uuid.UUID,
    reason: ContentReportReason,
    details: str | None,
    reporter_user_id: uuid.UUID | None,
    reporter_username: str | None,
    background_tasks: BackgroundTasks,
) -> ContentReport:
    """File one report against a live event.

    ``reporter_user_id`` is ``None`` for anonymous viewers; reporting is open
    to them. A missing, soft-deleted, or withheld event raises
    :class:`EventNotFoundError` (404) alike.
    """
    visible = (
        db.query(Event.id, Event.title).filter(Event.id == event_id, *visible_events()).first()
    )
    if visible is None:
        raise EventNotFoundError("Event not found")

    return _file_report(
        db,
        target=_ReportTarget(
            kind="event",
            event_id=event_id,
            collection_id=None,
            title=visible.title,
            link=email.event_link(str(event_id)),
        ),
        reason=reason,
        details=details,
        reporter_user_id=reporter_user_id,
        reporter_username=reporter_username,
        background_tasks=background_tasks,
    )


def create_collection_report(
    db: Session,
    *,
    collection_id: uuid.UUID,
    reason: ContentReportReason,
    details: str | None,
    reporter_user_id: uuid.UUID | None,
    reporter_username: str | None,
    background_tasks: BackgroundTasks,
) -> ContentReport:
    """File one report against a readable collection.

    Open to anonymous viewers under the same per-IP limit as event reports.
    An unreadable collection raises :class:`CollectionNotFoundError` (404) via
    ``services/collections.visible_collections``. The read is viewer-blind,
    unlike ``resolve_collection``: an admin may read a withheld collection, but
    no more reports should be filed against it.
    """
    visible = (
        db.query(Collection.id, Collection.title)
        .filter(Collection.id == collection_id, *visible_collections())
        .first()
    )
    if visible is None:
        raise CollectionNotFoundError("Collection not found")

    return _file_report(
        db,
        target=_ReportTarget(
            kind="collection",
            event_id=None,
            collection_id=collection_id,
            title=visible.title,
            link=email.collection_link(str(collection_id)),
        ),
        reason=reason,
        details=details,
        reporter_user_id=reporter_user_id,
        reporter_username=reporter_username,
        background_tasks=background_tasks,
    )


def list_reports(db: Session, *, page: int, per_page: int) -> tuple[list[ContentReport], int]:
    """One page of the queue: open reports first, newest first within each group.

    The ``created_at, id`` tie-break makes the order total so an offset walk
    never serves a row twice. ``ix_content_reports_queue`` carries these three
    expressions in this order; change both together.

    The collection and its owner load eagerly to avoid two lazy round trips
    per collection report.
    """
    total = db.query(func.count(ContentReport.id)).scalar() or 0
    rows = (
        db.query(ContentReport)
        .options(joinedload(ContentReport.collection).joinedload(Collection.owner))
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
    """Set or clear the graphic flag. Returns whether it changed (a no-op writes no audit row)."""
    if event.is_graphic == graphic:
        return False
    event.is_graphic = graphic
    log_admin_event(
        db,
        actor_id=actor_id,
        action="event_marked_graphic" if graphic else "event_unmarked_graphic",
        target={"event_id": str(event.id)},
    )
    return True


def _set_hidden(db: Session, *, event: Event, actor_id: uuid.UUID, hidden: bool) -> bool:
    """Withhold the event from public reads, or restore it.

    Returns whether it changed, which tells the router whether to drop the
    points cache.
    """
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

    ``dismissed`` leaves the target untouched. ``hidden`` withholds the target
    from public reads (same stamp as ``DELETE /admin/collections/{id}``).
    ``marked_graphic`` is event-only: a collection report raises
    :class:`ReportVerdictNotApplicableError` (409).

    Each verdict appends a ``report_resolved`` audit row, plus the matching
    action (``event_marked_graphic``, ``event_hidden``, ``collection_hidden``)
    when the target changed, so the trail is the same as via the admin verbs.

    A report whose target was deleted (both id columns NULL) accepts
    ``dismissed`` only (:class:`ReportTargetGoneError`, 409).

    The report is locked ``FOR UPDATE`` first and its verdict re-checked, so
    concurrent resolves serialize and the loser gets
    :class:`ReportAlreadyResolvedError` (409). Target-mutating verdicts lock
    their target the same way.

    Returns ``(report, hidden_changed)``; the flag tells the router to drop
    the points cache and is only set by an event takedown. Raises
    :class:`ReportNotFoundError` (404) on an unknown id.
    """
    # ``populate_existing()`` keeps the locked SELECT from returning a stale
    # identity-map object.
    report = (
        db.query(ContentReport)
        .filter(ContentReport.id == report_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if report is None:
        raise ReportNotFoundError("Report not found")
    if report.resolved_at is not None:
        raise ReportAlreadyResolvedError("This report is already resolved")

    hidden_changed = False
    # ``dismissed`` touches no target, so it skips the fetch and lock.
    if resolution != "dismissed":
        if report.event_id is not None:
            # Locked so a resolve racing the direct moderation endpoint
            # serializes. Soft-deleted and hidden events stay reachable: a
            # report filed before the removal still deserves a verdict.
            event = (
                db.query(Event)
                .filter(Event.id == report.event_id)
                .populate_existing()
                .with_for_update()
                .one()
            )
            if resolution == "marked_graphic":
                _mark_graphic(db, event=event, actor_id=actor_id, graphic=True)
            elif resolution == "hidden":
                hidden_changed = _set_hidden(db, event=event, actor_id=actor_id, hidden=True)
        elif report.collection_id is not None:
            if resolution == "marked_graphic":
                raise ReportVerdictNotApplicableError(
                    "A collection carries no footage of its own, so it cannot be marked graphic"
                )
            # Locked like the event above, serializing with
            # ``DELETE /admin/collections/{id}``. Already withheld stays
            # reachable (the stamp is idempotent).
            collection = (
                db.query(Collection)
                .filter(Collection.id == report.collection_id)
                .populate_existing()
                .with_for_update()
                .one()
            )
            withhold_collection(db, collection=collection, actor_id=actor_id)
        else:
            raise ReportTargetGoneError(
                "The reported item was deleted, so this report can only be dismissed"
            )

    report.resolved_at = datetime.now(UTC)
    report.resolution = resolution
    report.resolved_by = actor_id
    log_admin_event(
        db,
        actor_id=actor_id,
        action="report_resolved",
        target={
            "report_id": str(report.id),
            # Both keys always present so one shape reads the trail.
            "event_id": str(report.event_id) if report.event_id is not None else None,
            "collection_id": (
                str(report.collection_id) if report.collection_id is not None else None
            ),
            "resolution": resolution,
        },
    )
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

    ``None`` leaves that axis alone; a value equal to the current one writes
    nothing. This verb can also undo a takedown, so it bypasses
    ``_resolve_live_event`` (which hides withheld rows).

    The event is locked ``FOR UPDATE`` so this door and a report verdict
    serialize.

    Returns ``(event, hidden_changed)``. Raises :class:`EventNotFoundError`
    (404) for an unknown or soft-deleted event.
    """
    event = (
        db.query(Event)
        .filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
        .populate_existing()
        .with_for_update()
        .first()
    )
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
