import uuid
from datetime import UTC, date, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.event import Event
from app.models.source import Source, SourceLink
from app.models.tag import Tag
from app.models.user import User
from tests._fixtures import client, make_event
from tests.conftest import login_as


@pytest.fixture
def authed_user(make_user):
    user = make_user("tagtest")
    return user, login_as(client, user)


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


@pytest.mark.parametrize(
    "name", ["", "   ", "\t\n", "x" * 101], ids=["empty", "space", "whitespace", "too-long"]
)
def test_create_tag_rejects_a_bad_name(authed_user, name):
    """A blank name fails ``min_length=1`` after the strip; 101 characters overflow
    ``String(100)``. Both 422 before the DB sees them."""
    _, headers = authed_user
    response = client.post("/api/v1/tags", json={"name": name}, headers=headers)
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


def test_list_tags_hides_an_orphan(free_tag):
    """A tag nothing uses stays off the map filter."""
    names = {row["name"] for row in client.get("/api/v1/tags").json()}
    assert free_tag.name not in names


@pytest.mark.parametrize(
    ("carrier", "deleted", "listed"),
    [
        ("event", False, True),
        ("event", True, False),
        ("source", False, True),
        ("source", True, False),
    ],
)
def test_list_tags_shows_the_tags_of_live_events(free_tag, make_user, db, carrier, deleted, listed):
    """A tag on a live event, or on one of its sources, is listed; one only a soft-deleted
    event carries falls off the filter like an orphan."""
    make_event(
        db,
        author=make_user(),
        deleted=deleted,
        tags=[free_tag] if carrier == "event" else None,
        sources=[
            Source(
                level="direct",
                kind="unknown",
                links=[SourceLink(url="https://example.com")],
                tags=[free_tag] if carrier == "source" else [],
            )
        ],
    )
    names = {row["name"] for row in client.get("/api/v1/tags").json()}
    assert (free_tag.name in names) is listed


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
def other_user(make_user):
    return make_user("tagother")


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
