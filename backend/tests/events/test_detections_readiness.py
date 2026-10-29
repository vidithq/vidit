"""``detection_ready_predicate`` (SQL) must match ``batch._publish_detection`` row by row.

The third implementation, ``batchCompletionBlockers`` in
``frontend/src/lib/events.ts``, is held to the same table by
``frontend/src/lib/events.test.ts``.
"""

from __future__ import annotations

from app.models.event import STATUS_DETECTED, Event
from app.services.events import detection_ready_predicate
from app.services.events.batch import _publish_detection
from app.services.evidence_intake import EvidenceIntakeError
from tests.events._readiness_cases import READINESS_CASES, READY_CASE_NAMES, make_detection


def test_sql_predicate_and_publish_floor_agree_row_by_row(db, author, conflict):
    """A review supplies the conflict and the kind is optional: only the evidence floor refuses."""
    rows = {
        name: make_detection(db, author, overrides)
        for name, (overrides, _) in READINESS_CASES.items()
    }
    names_by_id = {geo.id: name for name, geo in rows.items()}

    sql_ready = {
        names_by_id[row_id]
        for (row_id,) in db.query(Event.id).filter(
            Event.id.in_(list(names_by_id)),
            Event.status == STATUS_DETECTED,
            detection_ready_predicate(),
        )
    }

    floor_ready = set()
    for name, geo in rows.items():
        try:
            _publish_detection(
                db,
                event_id=geo.id,
                current_user=author,
                kind="smartphone",
                conflicts=[conflict],
            )
        except EvidenceIntakeError:
            db.rollback()
        else:
            floor_ready.add(name)

    assert sql_ready == floor_ready
    # Agreement alone passes two identically wrong rules, so pin the table too.
    assert sql_ready == set(READY_CASE_NAMES)


def test_incomplete_is_the_exact_complement(db, author):
    """A NULL predicate leg would drop rows from both queues; every leg must be true or false."""
    rows = [make_detection(db, author, overrides) for overrides, _ in READINESS_CASES.values()]
    ids = [geo.id for geo in rows]
    ready = detection_ready_predicate()

    in_ready = {r for (r,) in db.query(Event.id).filter(Event.id.in_(ids), ready)}
    in_incomplete = {r for (r,) in db.query(Event.id).filter(Event.id.in_(ids), ~ready)}

    assert in_ready | in_incomplete == set(ids)
    assert not (in_ready & in_incomplete)
