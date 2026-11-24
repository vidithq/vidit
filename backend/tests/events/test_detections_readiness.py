"""``detection_ready_predicate`` (SQL) must match the publish floor checks row by row.

The third implementation, ``batchCompletionBlockers`` in
``frontend/src/lib/events.ts``, is held to the same table by
``frontend/src/lib/events.test.ts``.
"""

from __future__ import annotations

from app.models.event import STATUS_DETECTED, Event
from app.services.events import detection_ready_predicate
from app.services.events.rules import _require_proof_image
from app.services.events.sources import check_publish_floor
from app.services.evidence_intake import EvidenceIntakeError
from tests._fixtures import make_detection
from tests.events._readiness_cases import READINESS_CASES, READY_CASE_NAMES


def _clears_publish_floor(geo: Event) -> bool:
    """The floor a publish holds the stored row to, in the server's check order."""
    if geo.coords is None or any(not source.links for source in geo.sources):
        return False
    try:
        _require_proof_image(geo.proof)
        check_publish_floor((s.level, s.media is not None) for s in geo.sources)
    except EvidenceIntakeError:
        return False
    return True


def test_sql_predicate_and_publish_floor_agree_row_by_row(db, author):
    """A review supplies the conflict and the source kind, so only the evidence floor can refuse."""
    rows = {
        name: make_detection(db, author, **overrides)
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

    floor_ready = {name for name, geo in rows.items() if _clears_publish_floor(geo)}

    assert sql_ready == floor_ready
    # Agreement alone passes two identically wrong rules, so pin the table too.
    assert sql_ready == set(READY_CASE_NAMES)


def test_incomplete_is_the_exact_complement(db, author):
    """A NULL predicate leg would drop rows from both queues; every leg must be true or false."""
    rows = [make_detection(db, author, **overrides) for overrides, _ in READINESS_CASES.values()]
    ids = [geo.id for geo in rows]
    ready = detection_ready_predicate()

    in_ready = {r for (r,) in db.query(Event.id).filter(Event.id.in_(ids), ready)}
    in_incomplete = {r for (r,) in db.query(Event.id).filter(Event.id.in_(ids), ~ready)}

    assert in_ready | in_incomplete == set(ids)
    assert not (in_ready & in_incomplete)
