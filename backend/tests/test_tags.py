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
        Source(
            level="direct",
            kind="unknown",
            links=[SourceLink(url="https://example.com")],
            tags=[tag],
        )
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
        Source(
            level="direct",
            kind="unknown",
            links=[SourceLink(url="https://example.com")],
            tags=[tag],
        )
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


def _live_event(owner: User, tags: list[Tag], source_tags: list[Tag] = (), **fields) -> Event:
    geo = Event(
        owner_id=owner.id,
        title="t",
        coords=from_shape(Point(0, 0), srid=4326),
        occurred_date=date(2026, 1, 1),
        created_at=datetime.now(UTC),
        geolocated_at=datetime.now(UTC),
        tags=tags,
        **fields,
    )
    if source_tags:
        geo.sources = [
            Source(
                level="direct",
                kind="unknown",
                links=[SourceLink(url="https://example.com")],
                tags=list(source_tags),
            )
        ]
    return geo


@pytest.fixture
def other_user(db):
    user = User(
        username=f"tagother-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.test",
        password_hash=hash_password("pw"),
    )
    db.add(user)
    db.commit()
    yield user
    db.delete(user)
    db.commit()


@pytest.fixture
def seed(db):
    """Commits fresh tags and the events that use them, and deletes both after the test."""
    made: list[Tag | Event] = []

    def tags(*prefixes: str) -> list[Tag]:
        rows = [Tag(name=f"{p}-{uuid.uuid4().hex[:8]}") for p in prefixes]
        db.add_all(rows)
        db.commit()
        made.extend(rows)
        return rows

    def event(owner: User, tags: list[Tag], source_tags: list[Tag] = (), **fields) -> None:
        row = _live_event(owner, tags, source_tags, **fields)
        db.add(row)
        db.commit()
        made.append(row)

    yield tags, event
    for row in reversed(made):
        db.delete(row)
    db.commit()


def _suggested(headers) -> list[str]:
    response = client.get("/api/v1/tags/suggested", headers=headers)
    assert response.status_code == 200
    return [row["name"] for row in response.json()]


def test_suggested_tags_rank_your_own_uses_first(authed_user, other_user, seed):
    """Your tags come first, by your uses on events and their sources, before the platform's
    most used tag, however often others use it."""
    user, headers = authed_user
    tags, event = seed
    mine_twice, mine_once, popular = tags("mine2", "mine1", "popular")
    event(user, [mine_once], source_tags=[mine_twice])
    event(user, [mine_twice])
    for _ in range(3):
        event(other_user, [popular])

    names = _suggested(headers)
    assert names[:2] == [mine_twice.name, mine_once.name]
    assert popular.name in names


def test_suggested_tags_fall_back_to_the_platform(authed_user, other_user, seed):
    """With no tag of your own, the list is the platform's most used live tags."""
    _, headers = authed_user
    tags, event = seed
    more, fewer = tags("more", "fewer")
    for _ in range(3):
        event(other_user, [more])
    event(other_user, [fewer])

    names = _suggested(headers)
    assert names.index(more.name) < names.index(fewer.name)


def test_suggested_tags_skip_orphans_and_deleted_events(authed_user, seed):
    """A tag on no live event, or only on your soft-deleted one, is never suggested."""
    user, headers = authed_user
    tags, event = seed
    orphan, on_deleted, live = tags("orphan", "deleted", "live")
    event(user, [on_deleted], deleted_at=datetime.now(UTC))
    event(user, [live])

    names = _suggested(headers)
    assert names[0] == live.name
    assert orphan.name not in names
    assert on_deleted.name not in names


def test_suggested_tags_require_auth():
    assert client.get("/api/v1/tags/suggested").status_code in {401, 403}
