"""Content reports and the takedown they resolve into.

Three writes and one read live here: a viewer files a report
(:func:`create_report`), an admin walks the queue (:func:`list_reports`) and
closes a row with a verdict (:func:`resolve_report`), and an admin acts on an
event directly, with no report to hang it on (:func:`set_event_moderation`).
The two admin writes share one home because they perform the same two
mutations, the graphic flag and ``events.hidden_at``, and each mutation must
leave the same audit trail whichever door it came through.

Errors are typed with stable ``code`` strings, translated to HTTP via the
shared ``{code, message}`` envelope; :data:`REPORT_ERROR_STATUS` is the one
mapping both routers read, the shape ``evidence_intake`` uses.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.config import settings
from app.models.content_report import (
    ContentReport,
    ContentReportReason,
    ContentReportResolution,
)
from app.models.event import Event
from app.models.user import User
from app.services import email
from app.services.admin import log_admin_event

logger = logging.getLogger(__name__)


class ReportError(Exception):
    """Base for friendly errors raised by the reports service.

    Carries a ``code`` so a router maps to an HTTP status without
    string-matching exception text. Mirrors
    :class:`app.services.admin.AdminError`.
    """

    code: str = "report_error"


class EventNotFoundError(ReportError):
    """The reported (or moderated) event does not exist, is soft-deleted, or is
    already withheld from the public surface it was reached through."""

    code = "event_not_found"


class ReportNotFoundError(ReportError):
    code = "report_not_found"


class ReportAlreadyResolvedError(ReportError):
    """The report already carries a verdict.

    Reports are resolved once and never reopened or deleted, so a second
    resolve is a conflict rather than an overwrite: the first verdict is the
    record of what was decided, and its audit row names the admin who decided
    it.
    """

    code = "report_already_resolved"


class ReportEventGoneError(ReportError):
    """The reported event was hard-deleted, so this verdict has nothing to act on.

    The report survives the deletion (``content_reports.event_id`` is SET NULL),
    which keeps the record of the complaint, but ``marked_graphic`` and
    ``hidden`` both mutate an event row that no longer exists. ``dismissed``
    stays available: closing the report is still a verdict.
    """

    code = "report_event_gone"


# Status per code, read by both the public report endpoint and the admin
# router. One home, so the two cannot drift.
REPORT_ERROR_STATUS: dict[str, int] = {
    "event_not_found": 404,
    "report_not_found": 404,
    "report_already_resolved": 409,
    "report_event_gone": 409,
}


def _notify_new_report(db: Session, *, report: ContentReport, event_title: str) -> None:
    """Tell the moderation address a report landed, best effort.

    Unset ``REPORT_NOTIFY_EMAIL`` sends nothing and costs nothing: the report
    is already recorded and already in the admin queue, so the notification is
    a heads-up rather than the delivery mechanism. The report is committed by
    the time this runs, so a provider outage is logged and swallowed on the
    same terms as the auth mailers: losing the heads-up must not lose the
    report.
    """
    address = settings.report_notify_email
    if not address:
        return
    reporter = "anonymous"
    if report.reporter_user_id is not None:
        user = db.get(User, report.reporter_user_id)
        if user is not None:
            reporter = user.username
    try:
        email.send(
            email.content_report_email(
                to=address,
                event_id=str(report.event_id),
                event_title=event_title,
                reason=report.reason,
                details=report.details,
                reporter=reporter,
                created_at=report.created_at,
            )
        )
    except email.EmailSendError as exc:
        logger.warning("content report notification send failed for report %s: %s", report.id, exc)


def create_report(
    db: Session,
    *,
    event_id: uuid.UUID,
    reason: ContentReportReason,
    details: str | None,
    reporter_user_id: uuid.UUID | None,
) -> ContentReport:
    """File one report against a live event.

    ``reporter_user_id`` is the caller's id when they happened to be logged in
    and ``None`` otherwise: reporting is open to anonymous viewers, because the
    people a piece of footage harms rarely hold an account on the platform that
    published it.

    An event that does not exist, is soft-deleted, or is already withheld reads
    as :class:`EventNotFoundError` (404): all three are invisible to the caller,
    so all three answer the same way rather than confirming which.

    A successful report notifies the moderation address when one is configured
    (see :func:`_notify_new_report`), after the commit and never at its expense.
    """
    visible = (
        db.query(Event.id, Event.title)
        .filter(Event.id == event_id, Event.deleted_at.is_(None), Event.hidden_at.is_(None))
        .first()
    )
    if visible is None:
        raise EventNotFoundError("Event not found")

    report = ContentReport(
        event_id=event_id,
        reason=reason,
        details=details,
        reporter_user_id=reporter_user_id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    _notify_new_report(db, report=report, event_title=visible.title)
    return report


def list_reports(db: Session, *, page: int, per_page: int) -> tuple[list[ContentReport], int]:
    """One page of the queue: open reports first, newest first within each group.

    ``resolved_at IS NOT NULL`` sorts ascending, so ``false`` (open) leads. The
    ``created_at, id`` tie-break makes the ordering total, which an offset walk
    needs to avoid serving a row twice.
    """
    total = db.query(ContentReport).count()
    rows = (
        db.query(ContentReport)
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
    """Set or clear the graphic flag over the author's declaration.

    Returns whether the row actually changed; a no-op writes no audit row,
    since re-affirming a flag is not an administrative act.
    """
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
    """Withhold the event from the public read surface, or restore it.

    Returns whether the row actually changed, which is also what tells the
    router whether the points cache has to be dropped: an idempotent hide moves
    nothing on the map.
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
    """Close one report with a verdict, applying it to the event.

    ``marked_graphic`` sets the event's graphic flag, ``hidden`` withholds the
    event from every public read, and ``dismissed`` leaves the event untouched.
    Each verdict stamps the report and appends a ``report_resolved`` audit row;
    a verdict that actually changed the event appends the matching event action
    too, so the trail reads the same whether the change came from the queue or
    from the direct moderation endpoint.

    A report whose event was hard-deleted since (``event_id`` is NULL) accepts
    ``dismissed`` only: the other two verdicts mutate an event row that is no
    longer there.

    Returns ``(report, hidden_changed)``; the flag is the router's cue to drop
    the points cache. Raises :class:`ReportNotFoundError` (404) on an unknown
    id, :class:`ReportAlreadyResolvedError` (409) on a report that already
    carries a verdict, and :class:`ReportEventGoneError` (409) on an
    event-mutating verdict against a deleted event.
    """
    report = db.query(ContentReport).filter(ContentReport.id == report_id).first()
    if report is None:
        raise ReportNotFoundError("Report not found")
    if report.resolved_at is not None:
        raise ReportAlreadyResolvedError("This report is already resolved")

    hidden_changed = False
    if report.event_id is None:
        # The event was hard-deleted; the report outlived it (SET NULL). There
        # is nothing to mark or hide, so only closing the row is left.
        if resolution != "dismissed":
            raise ReportEventGoneError(
                "The reported event was deleted, so this report can only be dismissed"
            )
    else:
        # Soft-deleted and already-hidden rows are reachable on purpose: a
        # report filed before the removal still deserves a verdict.
        event = db.query(Event).filter(Event.id == report.event_id).one()
        if resolution == "marked_graphic":
            _mark_graphic(db, event=event, actor_id=actor_id, graphic=True)
        elif resolution == "hidden":
            hidden_changed = _set_hidden(db, event=event, actor_id=actor_id, hidden=True)

    report.resolved_at = datetime.now(UTC)
    report.resolution = resolution
    report.resolved_by = actor_id
    log_admin_event(
        db,
        actor_id=actor_id,
        action="report_resolved",
        target={
            "report_id": str(report.id),
            # NULL when the event was hard-deleted before the verdict landed.
            "event_id": str(report.event_id) if report.event_id is not None else None,
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

    Both fields are optional and independent: ``None`` leaves that axis alone,
    and a value equal to what the row already holds writes nothing at all, so
    re-sending the current state is not an administrative act. The one verb that
    can also UNDO a takedown, which is why it does not go through
    ``_resolve_live_event`` (that helper hides withheld rows by design).

    Returns ``(event, hidden_changed)``. Raises :class:`EventNotFoundError`
    (404) for an unknown or soft-deleted event.
    """
    event = db.query(Event).filter(Event.id == geolocation_id, Event.deleted_at.is_(None)).first()
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
