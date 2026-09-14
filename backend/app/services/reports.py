"""Content reports and the takedown they resolve into.

A report names one target, an event or a collection, and both walk one queue.
Four writes and one read live here: a viewer files a report against an event
(:func:`create_event_report`) or against a collection
(:func:`create_collection_report`), an admin walks the queue
(:func:`list_reports`) and closes a row with a verdict
(:func:`resolve_report`), and an admin acts on an event directly, with no
report to hang it on (:func:`set_event_moderation`). The two admin writes
share one home because they perform the same two mutations, the graphic flag
and ``events.hidden_at``, and each mutation must leave the same audit trail
whichever door it came through. The collection takedown a verdict applies is
``services/admin.withhold_collection``, the same mutation the admin's own
``DELETE /admin/collections/{id}`` performs, for the same reason.

The two create verbs meet at :func:`_file_report`, which writes the row and
sends the notification: what differs between them is which target the row
names and how that target is resolved, not what filing a report does.

Errors are typed with stable ``code`` strings, translated to HTTP via the
shared ``{code, message}`` envelope; :data:`REPORT_ERROR_STATUS` is the one
mapping every router reads, the shape ``evidence_intake`` uses.
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
from app.models.user import User
from app.services import email
from app.services.admin import log_admin_event, withhold_collection
from app.services.event_filters import visible_events

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


class CollectionNotFoundError(ReportError):
    """The reported collection does not exist, is withheld, or belongs to a
    soft-deleted account.

    The collection half of :class:`EventNotFoundError`, answering the same way
    for the same reason: all three states are invisible to the caller, so all
    three read alike rather than confirming which one it is. The code is the
    one every ``/collections`` path already raises for an unreadable id.
    """

    code = "collection_not_found"


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


class ReportTargetGoneError(ReportError):
    """The reported target was deleted, so this verdict has nothing to act on.

    The report survives the deletion (both target columns are SET NULL), which
    keeps the record of the complaint, but every verdict except ``dismissed``
    mutates a row that no longer exists. ``dismissed`` stays available: closing
    the report is still a verdict.
    """

    code = "report_target_gone"


class ReportVerdictNotApplicableError(ReportError):
    """This verdict does not exist for this kind of target.

    One verdict set serves both kinds, and ``marked_graphic`` belongs to an
    event alone: the flag is a column on ``events``, and a collection carries
    no footage of its own, only items each moderated on their own. Refused
    rather than ignored, on the same terms as a verdict aimed at a deleted
    target: an admin who picks it is told the report is still open instead of
    reading a verdict that changed nothing.
    """

    code = "report_verdict_not_applicable"


# Status per code, read by the two public report endpoints and the admin
# router. One home, so they cannot drift.
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

    Runs as a background task, after the response: the report is already
    recorded and already in the admin queue, so the notification is a heads-up
    rather than the delivery mechanism, and a reporter must not wait on a
    Resend round trip to learn their report landed. A provider outage is
    logged and swallowed on the same terms as the auth mailers.

    Plain values rather than the ``ContentReport`` row: the request's session
    is gone by the time this runs, so an ORM instance would be detached with
    expired attributes.
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
    """What one report names, resolved before the row is written.

    ``kind`` is the word the notification puts in every line describing the
    thing. Exactly one of the two id fields is set, which is the row the
    report points at and the half of ``ck_content_reports_one_target`` the app
    layer holds.
    """

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

    The half of filing a report that does not depend on what was reported, so
    an event report and a collection report land the same row, in the same
    queue, with the same notification behind them. The caller resolves the
    target first, which is where the "you cannot report what you cannot see"
    refusal lives.

    The notification goes out when an address is configured, enqueued after
    the commit and run after the response, so the send is never on the
    reporter's critical path and never at the report's expense.
    ``reporter_username`` comes from the caller's session rather than a lookup:
    the commit expires the row, so re-reading it here would cost a second query
    for a name the router already holds.
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

    ``reporter_user_id`` is the caller's id when they happened to be logged in
    and ``None`` otherwise: reporting is open to anonymous viewers, because the
    people a piece of footage harms rarely hold an account on the platform that
    published it.

    An event that does not exist, is soft-deleted, or is already withheld reads
    as :class:`EventNotFoundError` (404): all three are invisible to the caller,
    so all three answer the same way rather than confirming which.
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

    The same gesture as reporting an event, open to anonymous viewers on the
    same terms and under the same per-IP limit: a shelf can misrepresent what
    it holds, and the reader who notices rarely holds an account here.

    A collection that does not exist, is already withheld, or belongs to a
    soft-deleted account reads as :class:`CollectionNotFoundError` (404), the
    three states its own page already answers 404 for. The read is deliberately
    viewer-blind, unlike ``services/collections.resolve_collection``: an admin
    reads a withheld collection in order to judge it, which is not a reason to
    let one more report be filed against a shelf already taken down.
    """
    visible = (
        db.query(Collection.id, Collection.title)
        .filter(
            Collection.id == collection_id,
            Collection.hidden_at.is_(None),
            Collection.owner.has(User.deleted_at.is_(None)),
        )
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

    ``resolved_at IS NOT NULL`` sorts ascending, so ``false`` (open) leads. The
    ``created_at, id`` tie-break makes the ordering total, which an offset walk
    needs to avoid serving a row twice. ``ix_content_reports_queue`` carries
    these three expressions in this order, so the walk reads the index rather
    than sorting the table; changing this ORDER BY means changing that index.

    One list for both kinds of target. The reported collection rides along
    eagerly, owner included, because the queue names a collection row by its
    title and its owner: a lazy load would cost two round trips per collection
    report on a page of twenty.
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
    """Close one report with a verdict, applying it to what the report names.

    ``dismissed`` closes the report and leaves the target untouched, whichever
    kind it is. ``hidden`` withholds the target from every public read, the
    event's ``hidden_at`` or the collection's, the same stamp
    ``DELETE /admin/collections/{id}`` writes. ``marked_graphic`` sets an
    event's graphic flag and exists for an event alone, so a collection report
    answers it with :class:`ReportVerdictNotApplicableError` (409) rather than
    closing on a verdict that changed nothing.

    Each verdict stamps the report and appends a ``report_resolved`` audit row
    naming the target under its own key; a verdict that actually changed the
    target appends the matching action too (``event_marked_graphic``,
    ``event_hidden``, ``collection_hidden``), so the trail reads the same
    whether the change came from the queue or from the admin verb beside it.

    A report whose target was deleted since (both id columns NULL) accepts
    ``dismissed`` only: every other verdict mutates a row that is no longer
    there.

    Concurrency: the report is fetched ``with_for_update()`` FIRST and its
    verdict re-checked under the lock, so two admins resolving the same report
    serialize and the loser sees the 409 rather than overwriting the first
    verdict. Every target-mutating verdict locks its target the same way;
    ``dismissed`` touches no target, so it neither fetches nor locks one.

    Returns ``(report, hidden_changed)``; the flag is the router's cue to drop
    the points cache, and it is only ever set by an event takedown, a
    collection holding no point of its own. Raises
    :class:`ReportNotFoundError` (404) on an unknown id,
    :class:`ReportAlreadyResolvedError` (409) on a report that already carries
    a verdict, and :class:`ReportTargetGoneError` (409) on a target-mutating
    verdict against a deleted target.
    """
    # Lock the report row FIRST, then re-check the verdict under the lock, the
    # ``_publish_detection`` pattern: two admins resolving the same report
    # serialize here and the loser reads the winner's verdict, so the
    # documented 409 holds under concurrency instead of both writes landing.
    # ``populate_existing()`` is load-bearing whenever the row is already in
    # the session's identity map, where the locked SELECT would otherwise be
    # answered from a stale Python object.
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
    # ``dismissed`` closes the row and touches no target, so it skips the fetch
    # and the lock below entirely. It is also the only verdict an orphaned
    # report accepts.
    if resolution != "dismissed":
        if report.event_id is not None:
            # Locked because the verdict mutates it: a resolve racing the
            # direct moderation endpoint over the same event serializes on
            # this row rather than interleaving the two writes. Soft-deleted
            # and already-hidden rows are reachable on purpose: a report filed
            # before the removal still deserves a verdict.
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
            # Locked like the event above, so this door and
            # ``DELETE /admin/collections/{id}`` serialize on the row they
            # both stamp. An already withheld collection is reachable on
            # purpose: a second report against it still deserves a verdict,
            # and the stamp is idempotent.
            collection = (
                db.query(Collection)
                .filter(Collection.id == report.collection_id)
                .populate_existing()
                .with_for_update()
                .one()
            )
            withhold_collection(db, collection=collection, actor_id=actor_id)
        else:
            # The target was deleted; the report outlived it (SET NULL). There
            # is nothing left to mark or hide.
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
            # Both target keys, every time, so one shape reads the trail: the
            # one the report names carries an id and the other is NULL. Both
            # are NULL on a report whose target was deleted, which is the
            # orphan the branch above refuses anything but ``dismissed`` for.
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

    Both fields are optional and independent: ``None`` leaves that axis alone,
    and a value equal to what the row already holds writes nothing at all, so
    re-sending the current state is not an administrative act. The one verb that
    can also UNDO a takedown, which is why it does not go through
    ``_resolve_live_event`` (that helper hides withheld rows by design).

    Concurrency: the event is fetched ``with_for_update()``, like the one a
    report verdict mutates, so the two admin doors onto the same two columns
    serialize.

    Returns ``(event, hidden_changed)``. Raises :class:`EventNotFoundError`
    (404) for an unknown or soft-deleted event.
    """
    # Locked like the event a report verdict mutates, so the two admin doors
    # onto the same two columns serialize instead of interleaving.
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
