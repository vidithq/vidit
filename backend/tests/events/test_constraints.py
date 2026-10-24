"""DB-level CHECK constraints on ``events`` and ``sources``, reached through the ORM and
the API.

Each test builds a row that violates one CHECK and asserts the commit raises (the
idiom of ``test_social.py::test_check_constraint_blocks_self_follow``), rolling back
so teardown sees a clean session.
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
)
from app.models.source import Source, SourceLink
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
)


def _bare_event(db, *, author, **overrides) -> Event:
    """The NOT NULL floor, so a test isolates one CHECK at a time."""
    fields = {
        "owner_id": author.id,
        "title": "Constraint probe",
    }
    fields.update(overrides)
    return Event(**fields)


def test_status_check_rejects_value_outside_the_domain(db, author):
    """A status outside the four values is rejected by Postgres, not only by the
    ``EventStatus`` Literal."""
    bad = _bare_event(db, author=author, status="archived")
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_status_valid"):
        db.commit()
    db.rollback()


def test_coords_status_check_rejects_geolocated_without_coords(db, author):
    """A ``geolocated`` row needs a subject coordinate; the other states are free."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        geolocated_at=datetime.now(UTC),
        coords=None,
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_coords_status"):
        db.commit()
    db.rollback()


def test_coords_status_check_allows_requested_without_coords(db, author):
    """``requested`` with no coordinate is valid: the CHECK binds only ``geolocated``."""
    ok = _bare_event(
        db,
        author=author,
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
        coords=None,
    )
    db.add(ok)
    db.commit()
    db.delete(ok)
    db.commit()


def test_before_closed_status_check_rejects_value_outside_the_domain(db, author):
    """``before_closed_status`` on a closed row must name one of the three live states."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_CLOSED,
        closed_at=datetime.now(UTC),
        before_closed_status="published",
        coords=from_shape(Point(34.5, 48.5), srid=4326),
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_before_closed_status"):
        db.commit()
    db.rollback()


def test_before_closed_status_check_admits_a_retraction(db, author):
    """A retracted row keeps its coordinate and publication stamp, so all the CHECKs
    still hold."""
    ok = _bare_event(
        db,
        author=author,
        status=STATUS_CLOSED,
        closed_at=datetime.now(UTC),
        before_closed_status="geolocated",
        geolocated_at=datetime.now(UTC),
        coords=from_shape(Point(34.5, 48.5), srid=4326),
    )
    db.add(ok)
    db.commit()
    db.delete(ok)
    db.commit()


def test_before_closed_status_check_rejects_null_on_closed_row(db, author):
    """A closed row needs a ``before_closed_status``, so a withdrawn request stays
    distinguishable from a rejected detection."""
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
    """A live row must carry a NULL ``before_closed_status``."""
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


def test_closed_stamp_check_rejects_closed_without_closed_at(db, author):
    """A closed row must carry ``closed_at``."""
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
    """A geolocated row must carry ``geolocated_at``."""
    bad = _bare_event(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        coords=from_shape(Point(34.5, 48.5), srid=4326),
        geolocated_at=None,
    )
    db.add(bad)
    with pytest.raises(IntegrityError, match="ck_events_geolocated_stamp"):
        db.commit()
    db.rollback()


@pytest.mark.parametrize(
    ("field", "value", "constraint"),
    [
        ("level", "primary", "ck_sources_level_valid"),
        ("kind", "periscope", "ck_sources_kind_valid"),
    ],
)
def test_source_checks_reject_values_outside_the_domain(db, author, field, value, constraint):
    """``level`` and ``kind`` are closed lists in Postgres, not only in the Literals."""
    geo = _make_geo(db, author=author)
    source = Source(
        event_id=geo.id, level="direct", kind="unknown", links=[SourceLink(url="https://e.com/x")]
    )
    setattr(source, field, value)
    db.add(source)
    with pytest.raises(IntegrityError, match=constraint):
        db.commit()
    db.rollback()


def test_source_link_archive_stamp_check_pairs_the_copy_with_its_time(db, author):
    """A snapshot URL without ``archived_at`` is rejected, so a copy always says when."""
    geo = _make_geo(db, author=author)
    db.add(
        SourceLink(
            source_id=geo.sources[0].id,
            url="https://example.com/mirror",
            snapshot_url="https://web.archive.org/web/2026/https://example.com/mirror",
        )
    )
    with pytest.raises(IntegrityError, match="ck_source_links_archive_stamp"):
        db.commit()
    db.rollback()


def test_a_source_holds_each_url_once(db, author):
    geo = _make_geo(db, author=author, source_url="https://example.com/post")
    db.add(SourceLink(source_id=geo.sources[0].id, url="https://example.com/post"))
    with pytest.raises(IntegrityError, match="uq_source_links_source_url"):
        db.commit()
    db.rollback()


def test_geolocate_rejects_missing_coordinates_at_the_form_boundary(db, author, conflict):
    """``lat`` / ``lng`` are required Form fields, so omitting them 422s before the
    service or the CHECK is reached."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, with_media=True)
    [source] = geo.sources
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, author),
        data={
            "title": "No coordinates supplied",
            "occurred_date": "2026-05-01",
            "conflict_ids": json.dumps([str(conflict.id)]),
            "sources": sources_field(source_spec(id=str(source.id), media_id=str(source.media.id))),
            "proof": proof_form_field(),
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 422


# No router queries ``EventGeolocator.user_id`` yet, so this pins the query shape the
# index serves directly against the ORM.


def test_event_geolocators_reverse_query_by_user(db, author, second_user):
    """Every ``EventGeolocator`` row for one user, newest first (the shape
    ``ix_event_geolocators_user_created_at`` backs)."""
    older = _make_geo(db, author=author)
    newer = _make_geo(db, author=author)
    unrelated = _make_geo(db, author=author)  # second_user never geolocated this one

    db.add(
        EventGeolocator(
            event_id=older.id, user_id=second_user.id, state="active", joined_at=datetime.now(UTC)
        )
    )
    db.add(
        EventGeolocator(
            event_id=newer.id, user_id=second_user.id, state="active", joined_at=datetime.now(UTC)
        )
    )
    db.commit()

    rows = (
        db.query(EventGeolocator)
        .filter(EventGeolocator.user_id == second_user.id)
        .order_by(EventGeolocator.joined_at.desc())
        .all()
    )
    event_ids = {r.event_id for r in rows}
    assert event_ids == {older.id, newer.id}
    assert unrelated.id not in event_ids
