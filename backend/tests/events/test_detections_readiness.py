"""The readiness rule has one home, and this suite is what holds it there.

``services.events.detection_ready_predicate`` is a SQL projection of the floor
``services.events._publish_detection`` enforces row by row. Two expressions of one
rule can drift silently, so every shape in ``_readiness_cases`` is put through
both and the verdicts must match exactly, per row, not just in aggregate.

The third implementation, ``batchCompletionBlockers`` in
``frontend/src/lib/events.ts``, is held to the same table by
``frontend/src/lib/events.test.ts``.
"""

from __future__ import annotations

from app.models.event import STATUS_DETECTED, Event
from app.services.events import detection_ready_predicate
from app.services.events.batch import _publish_detection
from app.services.evidence_intake import EvidenceIntakeError
from tests.events._helpers import _make_geo
from tests.events._readiness_cases import READINESS_CASES, READY_CASE_NAMES


def _detection(db, author, overrides):
    return _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url=overrides.pop("source_url", "https://x.com/a/status/1"),
        **overrides,
    )


def test_sql_predicate_and_publish_floor_agree_row_by_row(db, author, conflict, capture_source_tag):
    """One rule, two expressions: the queue filter and the publish door must
    admit exactly the same detections.

    The SQL verdicts are collected first, then every detection is offered to
    ``_publish_detection`` with the two judgment calls a review supplies (a
    conflict and a capture source), so the only thing that can turn a row away
    is the evidence floor itself.
    """
    rows = {
        name: _detection(db, author, dict(overrides))
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
                capture_source_tag=capture_source_tag,
                conflicts=[conflict],
            )
        except EvidenceIntakeError:
            db.rollback()
        else:
            floor_ready.add(name)

    assert sql_ready == floor_ready
    # Pinned to the table too, so a change that breaks both the same way still
    # fails: agreement alone would be satisfied by two identically wrong rules.
    assert sql_ready == set(READY_CASE_NAMES)


def test_incomplete_is_the_exact_complement(db, author):
    """No detection falls out of both halves.

    Every leg of the predicate is strictly true or false, never SQL NULL, so
    ``NOT`` of it is the real complement. A NULL-valued leg (a bare comparison
    against a nullable column) would drop rows from both the ready and the
    incomplete queue, and an analyst would never see them again.
    """
    rows = [_detection(db, author, dict(overrides)) for overrides, _ in READINESS_CASES.values()]
    ids = [geo.id for geo in rows]
    ready = detection_ready_predicate()

    in_ready = {r for (r,) in db.query(Event.id).filter(Event.id.in_(ids), ready)}
    in_incomplete = {r for (r,) in db.query(Event.id).filter(Event.id.in_(ids), ~ready)}

    assert in_ready | in_incomplete == set(ids)
    assert not (in_ready & in_incomplete)
