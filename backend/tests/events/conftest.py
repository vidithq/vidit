"""Shared fixtures for the events test package."""

from __future__ import annotations

import uuid

import pytest

from app.cache import points_cache
from app.database import SessionLocal
from app.models.admin_event import AdminEvent
from app.models.conflict import Conflict
from app.models.content_report import ContentReport
from app.models.event import Event, EventGeolocator
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests.events._helpers import client


@pytest.fixture(autouse=True)
def _clear_cookies_and_cache():
    """The cookie jar keeps prior sessions and ``points_cache`` is process-global; clear both."""
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


def _delete_user_and_events(db, user_id) -> None:
    """Delete a fixture user and everything that FKs to it, request rows and credits included."""
    db.expire_all()
    db.query(EventGeolocator).filter(EventGeolocator.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.requested_by_id == user_id).delete(synchronize_session=False)
    # ``event_id`` is SET NULL, not CASCADE: reap the orphans or they pile up in the admin queue.
    db.query(ContentReport).filter(ContentReport.event_id.is_(None)).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


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
    _delete_user_and_events(db, user_id)


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
    _delete_user_and_events(db, user_id)


@pytest.fixture
def admin_user(db):
    """Teardown reaps this actor's audited ``admin_events`` rows before the user row."""
    user = User(
        username=f"adm{uuid.uuid4().hex[:8]}",
        email=f"adm-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete(synchronize_session=False)
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
def conflict(db):
    row = Conflict(name=f"conflict-{uuid.uuid4().hex[:8]}", ongoing=True, source="manual")
    db.add(row)
    db.commit()
    conflict_id = row.id
    yield row
    db.execute(
        Conflict.__table__.delete().where(Conflict.id == conflict_id),
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
