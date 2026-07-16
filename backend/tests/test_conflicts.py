"""GET /conflicts: full referential vs used-only view, ordering."""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.conflict import Conflict
from app.models.event import Event
from app.models.user import User
from app.services.auth import hash_password

client = TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def conflicts_pair(db):
    """One ongoing + one ended conflict, cleaned up after."""
    suffix = uuid.uuid4().hex[:8]
    ongoing = Conflict(
        name=f"ongoing-{suffix}",
        wikidata_id=f"Q9{suffix[:6]}1",
        ongoing=True,
        source="sync",
    )
    ended = Conflict(
        name=f"ended-{suffix}",
        wikidata_id=f"Q9{suffix[:6]}2",
        start_year=1990,
        end_year=1995,
        ongoing=False,
        source="seed",
    )
    db.add_all([ongoing, ended])
    db.commit()
    ids = (ongoing.id, ended.id)
    yield ongoing, ended
    db.execute(Conflict.__table__.delete().where(Conflict.id.in_(ids)))
    db.commit()


def test_list_conflicts_returns_full_referential(conflicts_pair):
    ongoing, ended = conflicts_pair
    response = client.get("/api/v1/conflicts")
    assert response.status_code == 200
    by_id = {row["id"]: row for row in response.json()}
    assert str(ongoing.id) in by_id
    assert str(ended.id) in by_id
    row = by_id[str(ended.id)]
    assert row["start_year"] == 1990
    assert row["end_year"] == 1995
    assert row["ongoing"] is False
    assert row["tier"] is None  # never synced, tier unknown


def test_list_conflicts_orders_ongoing_first(conflicts_pair):
    response = client.get("/api/v1/conflicts")
    rows = response.json()
    first_ended_pos = next(i for i, r in enumerate(rows) if not r["ongoing"])
    assert all(not r["ongoing"] for r in rows[first_ended_pos:])


def test_list_conflicts_used_filters_to_live_events(conflicts_pair, db):
    ongoing, ended = conflicts_pair
    owner = User(
        username=f"conftest-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.test",
        password_hash=hash_password("pw"),
    )
    db.add(owner)
    db.flush()
    geo = Event(
        owner_id=owner.id,
        title="used-conflict probe",
        event_coords=from_shape(Point(30.0, 50.0), srid=4326),
        source_url="https://example.test/src",
        event_date=datetime.now(UTC).date(),
        source_posted_at=datetime.now(UTC),
        geolocated_at=datetime.now(UTC),
    )
    geo.conflicts = [ongoing]
    db.add(geo)
    db.commit()
    geo_id, owner_id = geo.id, owner.id

    try:
        response = client.get("/api/v1/conflicts", params={"used": "true"})
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert str(ongoing.id) in ids
        assert str(ended.id) not in ids
    finally:
        db.execute(Event.__table__.delete().where(Event.id == geo_id))
        db.execute(User.__table__.delete().where(User.id == owner_id))
        db.commit()
