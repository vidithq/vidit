"""DB-level CHECK constraints on ``events``, reached through the ORM and the API.

The event model refactor (migration ``h0j2l4n6p8r0``) pins several invariants
at the database, not only in the app-layer ``Literal`` / service checks:
``ck_events_status_valid``, ``ck_events_coords_status``,
``ck_events_before_closed_status``, and the per-state stamp CHECKs
(``ck_events_closed_stamp`` / ``ck_events_geolocated_stamp``). Mirrors
``test_social.py::test_check_constraint_blocks_self_follow`` (the existing
direct-``IntegrityError`` idiom in this suite): construct a row that violates
one CHECK, assert the commit raises, and roll back so the fixture teardown
sees a clean session. Shared fixtures live in ``conftest.py``; ``client`` /
``_make_geo`` in ``_helpers.py``.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.exc import IntegrityError

from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
    EventInvestigator,
)
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client, proof_file_part, proof_form_field


def _bare_event(db, *, author, **overrides) -> Event:
    """The minimal columns every ``events`` row needs regardless of status
    (the NOT NULL floor), so a test can isolate exactly one CHECK at a time
    without also tripping an unrelated NOT NULL."""
    fields = {
        "owner_id": author.id,
        "title": "Constraint probe",
        "source_url": "https://example.com/post",
        "source_posted_at": datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
    }
    fields.update(overrides)
    return Event(**fields)


# ── ck_events_status_valid ────────────────────────────────────────────────


def test_status_check_rejects_value_outside_the_domain(db, author):
    """A ``status`` string outside ``requested`` / ``detected`` / ``geolocated``
    / ``closed`` is rejected by Postgres, not only by the app-layer
    ``EventStatus`` Literal: a bad write from any future code path (a typo, a
    half-finished migration) can't silently land."""
    bad = _bare_event(db, author=author, status="archived")
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_status_valid"):
        db.commit()
    db.rollback()


# ── ck_events_coords_status ───────────────────────────────────────────────


def test_coords_status_check_rejects_geolocated_without_coords(db, author):
    """A ``geolocated`` row always has a subject coordinate; inserting one with
    ``event_coords IS NULL`` is rejected. The other states are free (a
    ``requested`` guess is optional either way), so this CHECK is the one
    direction that's actually enforced."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        geolocated_at=datetime.now(UTC),
        event_coords=None,
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_coords_status"):
        db.commit()
    db.rollback()


def test_coords_status_check_allows_requested_without_coords(db, author):
    """The sibling positive case: ``requested`` with no coordinate at all is
    valid (an open call with no guess yet): the CHECK only binds
    ``geolocated``, not the other three states."""
    ok = _bare_event(
        db,
        author=author,
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
        event_coords=None,
    )
    db.add(ok)
    db.commit()  # must not raise
    db.delete(ok)
    db.commit()


# ── ck_events_before_closed_status ────────────────────────────────────────


def test_before_closed_status_check_rejects_value_outside_the_domain(db, author):
    """``before_closed_status`` on a ``closed`` row must be ``requested`` or
    ``detected`` (the two dismissal shapes); a ``geolocated`` value here would
    claim a frozen row was somehow withdrawn or rejected, which can't happen:
    Postgres refuses the write."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_CLOSED,
        closed_at=datetime.now(UTC),
        before_closed_status="geolocated",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_before_closed_status"):
        db.commit()
    db.rollback()


def test_before_closed_status_check_rejects_null_on_closed_row(db, author):
    """A ``closed`` row must remember the state it held before:
    ``ck_events_before_closed_status`` rejects a NULL discriminator on a closed
    row, so a withdrawn request stays distinguishable from a rejected detection.
    This is the strengthened CHECK, an earlier version let the NULL through and
    silently contradicted ``docs/data-model.md``."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_CLOSED,
        closed_at=datetime.now(UTC),
        before_closed_status=None,
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_before_closed_status"):
        db.commit()
    db.rollback()


def test_before_closed_status_check_rejects_value_on_non_closed_row(db, author):
    """The other half of the iff: a live (non-``closed``) row must carry a NULL
    discriminator. A ``requested`` row that somehow holds a
    ``before_closed_status`` is a stale leftover, and Postgres refuses it."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_REQUESTED,
        before_closed_status="requested",
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_before_closed_status"):
        db.commit()
    db.rollback()


# ── ck_events_closed_stamp / ck_events_geolocated_stamp ───────────────────


def test_closed_stamp_check_rejects_closed_without_closed_at(db, author):
    """A ``closed`` row must carry ``closed_at``; an app path that forgets to
    stamp it is rejected at write time instead of storing a silently
    incomplete row."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_CLOSED,
        before_closed_status=STATUS_REQUESTED,
        closed_at=None,
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_closed_stamp"):
        db.commit()
    db.rollback()


def test_geolocated_stamp_check_rejects_geolocated_without_geolocated_at(db, author):
    """Sibling of the closed-stamp CHECK: a ``geolocated`` row must carry
    ``geolocated_at``."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        geolocated_at=None,
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_geolocated_stamp"):
        db.commit()
    db.rollback()


# ── The coordinate CHECK, reached through the geolocate API ──────────────
# The DB-level CHECK above is the backstop; the app layer enforces the same
# rule earlier (before any S3 upload) via required Form fields, so a caller
# never gets the chance to trip the CHECK through the real endpoint. Both
# layers land on the same outward behaviour: no way to geolocate a row with
# no subject coordinate.


def test_geolocate_rejects_missing_coordinates_at_the_form_boundary(
    db, author, conflict_tag, capture_source_tag
):
    """``lat`` / ``lng`` are required ``Form(...)`` fields on the geolocate
    endpoint (mirroring create): omitting them 422s before the service (and
    the CHECK) is ever reached, the same invariant
    ``ck_events_coords_status`` protects at the database, enforced earlier at
    the API boundary."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, author),
        data={
            "title": "No coordinates supplied",
            "source_url": "https://example.com/post",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
            "proof": proof_form_field(),
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 422


# ── investigate: gated to `requested` for any other status, not only closed
# `test_requests.py` covers the ``closed`` case; the router's guard is a
# single ``geo.status != STATUS_REQUESTED`` check, so the narrow gap is
# confirming the two other non-``requested`` statuses hit the same 409.


def test_investigate_rejected_off_detected(db, author, second_user):
    geo = _make_geo(db, author=author, status=STATUS_DETECTED)
    response = client.post(
        f"/api/v1/events/{geo.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 409


def test_investigate_rejected_off_geolocated(db, author, second_user):
    geo = _make_geo(db, author=author, status=STATUS_GEOLOCATED)
    response = client.post(
        f"/api/v1/events/{geo.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 409


def test_uninvestigate_rejected_off_detected(db, author, second_user):
    geo = _make_geo(db, author=author, status=STATUS_DETECTED)
    response = client.delete(
        f"/api/v1/events/{geo.id}/investigate", headers=login_as(client, second_user)
    )
    assert response.status_code == 409


# ── Reverse contributor reads: "a user's geolocations / investigations" ──
# docs/data-model.md documents ``ix_event_geolocators_user_created_at`` /
# ``ix_event_investigators_user_id`` explicitly for this reverse direction
# ("the reverse 'a user's geolocations' profile query" / "what is this user
# working on?"), but no router queries by ``EventGeolocator.user_id`` or
# ``EventInvestigator.user_id`` today (``GET /users/{username}/events`` reads
# ``Event.owner_id``, not the contributor tables; see data-model.md: "stays
# on owner_id until it re-homes onto event_geolocators"). No HTTP surface
# exists yet to test end to end, so these lock in the query shape the index
# is FOR, directly against the ORM, so a future router wiring it up has a
# correctness check already in place.


def test_event_geolocators_reverse_query_by_user(db, author, second_user):
    """The reverse "a user's geolocations" read: every ``EventGeolocator`` row
    for one user, across however many events they've vouched, newest first
    (the shape ``ix_event_geolocators_user_created_at`` backs)."""
    older = _make_geo(db, author=author)
    newer = _make_geo(db, author=author)
    unrelated = _make_geo(db, author=author)  # second_user never geolocated this one

    db.add(EventGeolocator(event_id=older.id, user_id=second_user.id))
    db.add(EventGeolocator(event_id=newer.id, user_id=second_user.id))
    db.commit()

    rows = (
        db.query(EventGeolocator)
        .filter(EventGeolocator.user_id == second_user.id)
        .order_by(EventGeolocator.created_at.desc())
        .all()
    )
    event_ids = {r.event_id for r in rows}
    assert event_ids == {older.id, newer.id}
    assert unrelated.id not in event_ids


def test_event_investigators_reverse_query_by_user(db, author, second_user):
    """The reverse "what is this user working on" read: every
    ``EventInvestigator`` row for one user (the shape
    ``ix_event_investigators_user_id`` backs)."""
    signalled = _make_geo(db, author=author, status=STATUS_REQUESTED)
    not_signalled = _make_geo(db, author=author, status=STATUS_REQUESTED)

    db.add(EventInvestigator(event_id=signalled.id, user_id=second_user.id))
    db.commit()

    rows = db.query(EventInvestigator).filter(EventInvestigator.user_id == second_user.id).all()
    event_ids = {r.event_id for r in rows}
    assert event_ids == {signalled.id}
    assert not_signalled.id not in event_ids
