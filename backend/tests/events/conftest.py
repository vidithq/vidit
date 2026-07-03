"""Shared fixtures for the geolocations test package.

The author / second-user / curated-tag rows + the autouse cookie-and-cache
reset that every geolocations suite (read, create, duplicates, import, review)
leans on. The shared ``client`` and the ``_make_geo`` row factory live in
``_helpers.py``.
"""

from __future__ import annotations

import uuid

import pytest

from app.cache import points_cache
from app.database import SessionLocal
from app.models.event import Event
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests.events._helpers import client


@pytest.fixture(autouse=True)
def _clear_cookies_and_cache():
    """Prevent state-bleed across tests.

    - The TestClient cookie jar sticks the session from any prior
      ``login_as`` call; an anonymous test would otherwise inherit that
      identity. Wipe between tests.
    - `points_cache` is process-global; tests assert MISS / HIT
      sequences, so we clear before each test to make the first call
      deterministic.
    """
    client.cookies.clear()
    points_cache.invalidate()
    yield
    client.cookies.clear()
    points_cache.invalidate()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def author(db):
    user = User(
        username=f"auth{uuid.uuid4().hex[:8]}",
        email=f"auth-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.author_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def second_user(db):
    user = User(
        username=f"oth{uuid.uuid4().hex[:8]}",
        email=f"other-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.author_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def free_tag(db):
    tag = Tag(name=f"tag-{uuid.uuid4().hex[:8]}", category="free")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(
        Tag.__table__.delete().where(Tag.id == tag_id),
    )
    db.commit()


@pytest.fixture
def conflict_tag(db):
    tag = Tag(name=f"conflict-{uuid.uuid4().hex[:8]}", category="conflict")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(
        Tag.__table__.delete().where(Tag.id == tag_id),
    )
    db.commit()


@pytest.fixture
def capture_source_tag(db):
    tag = Tag(name=f"capture-{uuid.uuid4().hex[:8]}", category="capture_source")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(
        Tag.__table__.delete().where(Tag.id == tag_id),
    )
    db.commit()
