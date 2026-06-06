import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.geolocation import Geolocation
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
    headers = login_as(client, user.id)
    yield user, headers
    db.delete(user)
    db.commit()


def test_create_free_tag_passes(authed_user, db):
    _, headers = authed_user
    name = f"free-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/v1/tags",
        json={"name": name, "category": "free"},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["category"] == "free"
    # cleanup
    tag = db.query(Tag).filter(Tag.name == name).first()
    if tag:
        db.delete(tag)
        db.commit()


def test_create_free_tag_strips_whitespace(authed_user, db):
    """Pydantic's `strip_whitespace=True` runs before the DB hit, so a
    name typed with leading / trailing spaces lands stripped — and won't
    silently duplicate against an existing un-spaced row."""
    _, headers = authed_user
    core = f"spaced-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/v1/tags",
        json={"name": f"  {core}  ", "category": "free"},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["name"] == core
    db.query(Tag).filter(Tag.name == core).delete()
    db.commit()


@pytest.mark.parametrize("name", ["", "   ", "\t\n"])
def test_create_free_tag_rejects_empty(authed_user, name):
    """Empty (or whitespace-only) names hit the `min_length=1` bound
    *after* the strip, so the schema rejects them with 422 rather than
    saving a useless empty row."""
    _, headers = authed_user
    response = client.post(
        "/api/v1/tags",
        json={"name": name, "category": "free"},
        headers=headers,
    )
    assert response.status_code == 422


def test_create_free_tag_rejects_too_long(authed_user):
    """101 chars overflows the `String(100)` column cap. The schema
    bound catches it at 422 so the DB never sees a value it would
    truncate or reject downstream."""
    _, headers = authed_user
    response = client.post(
        "/api/v1/tags",
        json={"name": "x" * 101, "category": "free"},
        headers=headers,
    )
    assert response.status_code == 422


def test_create_free_tag_duplicate_returns_409(authed_user, db):
    """A second create with the same name returns 409. The frontend
    uses this signal to fall back to selecting the existing tag rather
    than surfacing an error to the analyst."""
    _, headers = authed_user
    name = f"dup-{uuid.uuid4().hex[:8]}"
    r1 = client.post(
        "/api/v1/tags",
        json={"name": name, "category": "free"},
        headers=headers,
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/api/v1/tags",
        json={"name": name, "category": "free"},
        headers=headers,
    )
    assert r2.status_code == 409
    db.query(Tag).filter(Tag.name == name).delete()
    db.commit()


def test_create_conflict_tag_forbidden(authed_user):
    _, headers = authed_user
    response = client.post(
        "/api/v1/tags",
        json={"name": f"forbidden-{uuid.uuid4().hex[:8]}", "category": "conflict"},
        headers=headers,
    )
    assert response.status_code == 403
    assert "cannot be created via the API" in response.json()["detail"]


def test_create_unknown_category_forbidden(authed_user):
    _, headers = authed_user
    response = client.post(
        "/api/v1/tags",
        json={"name": "whatever", "category": "evil"},
        headers=headers,
    )
    assert response.status_code == 403


def test_create_tag_requires_auth():
    response = client.post(
        "/api/v1/tags",
        json={"name": "no-auth", "category": "free"},
    )
    assert response.status_code in {401, 403}


def test_list_tags_filters_orphans(authed_user, db):
    """Tags with zero live-geolocation references must not appear in /tags.

    Otherwise the map filter UI surfaces chips that match zero rows — a
    confusing dead-end for the analyst, and what was happening before the
    JOIN-and-distinct rewrite of the endpoint.
    """
    user, _ = authed_user
    orphan = Tag(name=f"orphan-{uuid.uuid4().hex[:8]}", category="free")
    used = Tag(name=f"used-{uuid.uuid4().hex[:8]}", category="free")
    db.add_all([orphan, used])
    db.commit()

    geo = Geolocation(
        author_id=user.id,
        title="t",
        location=from_shape(Point(0, 0), srid=4326),
        source_url="https://example.com",
        event_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
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


def test_list_tags_curated_returns_unused_curated_tags(db):
    """`?curated=true` returns the conflict + capture_source taxonomy
    regardless of live usage.

    The submit form's two required selectors need every option up front,
    including ones no live geolocation references yet — the opposite of
    the default view's orphan-hiding behaviour. Free tags are never part
    of the curated set.
    """
    conflict = Tag(name=f"cf-{uuid.uuid4().hex[:8]}", category="conflict")
    capture = Tag(name=f"cs-{uuid.uuid4().hex[:8]}", category="capture_source")
    free = Tag(name=f"fr-{uuid.uuid4().hex[:8]}", category="free")
    db.add_all([conflict, capture, free])
    db.commit()

    try:
        # Default view hides all three — none is referenced by a live geo.
        default = client.get("/api/v1/tags")
        default_names = {row["name"] for row in default.json()}
        assert conflict.name not in default_names
        assert capture.name not in default_names

        curated = client.get("/api/v1/tags?curated=true")
        assert curated.status_code == 200
        rows = curated.json()
        names = {row["name"] for row in rows}
        assert conflict.name in names
        assert capture.name in names
        assert free.name not in names
        assert {row["category"] for row in rows} <= {"conflict", "capture_source"}
    finally:
        for tag in (conflict, capture, free):
            db.execute(Tag.__table__.delete().where(Tag.id == tag.id))
        db.commit()


def test_list_tags_drops_tag_when_only_geo_is_soft_deleted(authed_user, db):
    """Soft-deleted geolocations don't keep a tag alive in the filter.

    If the only geo using a tag is soft-deleted, the tag's a dead-end —
    it should fall off the filter just like a never-used orphan would.
    """
    user, _ = authed_user
    tag = Tag(name=f"sd-{uuid.uuid4().hex[:8]}", category="free")
    db.add(tag)
    db.commit()

    geo = Geolocation(
        author_id=user.id,
        title="t",
        location=from_shape(Point(0, 0), srid=4326),
        source_url="https://example.com",
        event_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
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
