import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.event import Event
from app.models.source import Source, SourceLink
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def authed_user(db):
    user = User(
        username=f"tagtest-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.test",
        password_hash=hash_password("pw"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    headers = login_as(client, user)
    yield user, headers
    db.delete(user)
    db.commit()


def test_create_tag_passes(authed_user, db):
    _, headers = authed_user
    name = f"free-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/v1/tags",
        json={"name": name},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["name"] == name
    assert set(response.json()) == {"id", "name"}
    tag = db.query(Tag).filter(Tag.name == name).first()
    if tag:
        db.delete(tag)
        db.commit()


def test_create_tag_strips_whitespace(authed_user, db):
    """`strip_whitespace=True` runs before the DB hit, so a padded name lands stripped and cannot duplicate an un-spaced row."""
    _, headers = authed_user
    core = f"spaced-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/v1/tags",
        json={"name": f"  {core}  "},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["name"] == core
    db.query(Tag).filter(Tag.name == core).delete()
    db.commit()


@pytest.mark.parametrize("name", ["", "   ", "\t\n"])
def test_create_tag_rejects_empty(authed_user, name):
    """Empty or whitespace-only names hit `min_length=1` after the strip: 422."""
    _, headers = authed_user
    response = client.post(
        "/api/v1/tags",
        json={"name": name},
        headers=headers,
    )
    assert response.status_code == 422


def test_create_tag_rejects_too_long(authed_user):
    """101 chars overflows `String(100)`; the schema 422s before the DB sees it."""
    _, headers = authed_user
    response = client.post(
        "/api/v1/tags",
        json={"name": "x" * 101},
        headers=headers,
    )
    assert response.status_code == 422


def test_create_tag_duplicate_returns_existing(authed_user, db):
    """A repeat create with the same name returns 200 with the existing row, so
    `NewTagInput` can select an orphan tag (hidden from `GET /tags`)."""
    _, headers = authed_user
    name = f"dup-{uuid.uuid4().hex[:8]}"
    r1 = client.post(
        "/api/v1/tags",
        json={"name": name},
        headers=headers,
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/api/v1/tags",
        json={"name": name},
        headers=headers,
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"]
    db.query(Tag).filter(Tag.name == name).delete()
    db.commit()


def test_create_tag_requires_auth():
    response = client.post(
        "/api/v1/tags",
        json={"name": "no-auth"},
    )
    assert response.status_code in {401, 403}


def test_list_tags_filters_orphans(authed_user, db):
    """Tags with no live-geolocation references are hidden from /tags (the map filter would show dead chips)."""
    user, _ = authed_user
    orphan = Tag(name=f"orphan-{uuid.uuid4().hex[:8]}")
    used = Tag(name=f"used-{uuid.uuid4().hex[:8]}")
    db.add_all([orphan, used])
    db.commit()

    geo = Event(
        owner_id=user.id,
        title="t",
        coords=from_shape(Point(0, 0), srid=4326),
        occurred_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
        geolocated_at=datetime.now(UTC),
    )
    geo.tags = [used]
    db.add(geo)
    db.commit()

    try:
        response = client.get("/api/v1/tags")
        assert response.status_code == 200
        names = {row["name"] for row in response.json()}
        assert used.name in names
        assert orphan.name not in names
    finally:
        db.delete(geo)
        db.delete(used)
        db.delete(orphan)
        db.commit()


def test_list_tags_drops_tag_when_only_geo_is_soft_deleted(authed_user, db):
    """A tag used only by a soft-deleted geolocation falls off the filter like an orphan."""
    user, _ = authed_user
    tag = Tag(name=f"sd-{uuid.uuid4().hex[:8]}")
    db.add(tag)
    db.commit()

    geo = Event(
        owner_id=user.id,
        title="t",
        coords=from_shape(Point(0, 0), srid=4326),
        occurred_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
        geolocated_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),  # soft-deleted upfront
    )
    geo.tags = [tag]
    db.add(geo)
    db.commit()

    try:
        response = client.get("/api/v1/tags")
        assert response.status_code == 200
        names = {row["name"] for row in response.json()}
        assert tag.name not in names
    finally:
        db.delete(geo)
        db.delete(tag)
        db.commit()


def test_list_tags_includes_a_tag_only_on_a_source(authed_user, db):
    """A tag carried by a source of a live event, and by no event, is a live tag."""
    user, _ = authed_user
    tag = Tag(name=f"src-{uuid.uuid4().hex[:8]}")
    db.add(tag)
    db.commit()

    geo = Event(
        owner_id=user.id,
        title="t",
        coords=from_shape(Point(0, 0), srid=4326),
        occurred_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
        geolocated_at=datetime.now(UTC),
    )
    geo.sources = [
        Source(level="direct", links=[SourceLink(url="https://example.com")], tags=[tag])
    ]
    db.add(geo)
    db.commit()

    try:
        response = client.get("/api/v1/tags")
        assert response.status_code == 200
        names = {row["name"] for row in response.json()}
        assert tag.name in names
    finally:
        db.delete(geo)
        db.delete(tag)
        db.commit()


def test_list_tags_drops_a_source_tag_when_its_event_is_soft_deleted(authed_user, db):
    """A tag carried only by a source of a soft-deleted event falls off the filter."""
    user, _ = authed_user
    tag = Tag(name=f"srcsd-{uuid.uuid4().hex[:8]}")
    db.add(tag)
    db.commit()

    geo = Event(
        owner_id=user.id,
        title="t",
        coords=from_shape(Point(0, 0), srid=4326),
        occurred_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
        geolocated_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),
    )
    geo.sources = [
        Source(level="direct", links=[SourceLink(url="https://example.com")], tags=[tag])
    ]
    db.add(geo)
    db.commit()

    try:
        names = {row["name"] for row in client.get("/api/v1/tags").json()}
        assert tag.name not in names
    finally:
        db.delete(geo)
        db.delete(tag)
        db.commit()
