"""End-to-end tests for the social-graph endpoints.

Covers follow and unfollow (idempotent, 404 on an unknown or soft-deleted
target, auth required), ``GET /feed`` (published geolocations, open
requests and detections, scope, filters, credit, exclusions, cursor walk), the profile follow counters
and ``is_following``, and the DB-level ``ck_follows_no_self_follow``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

from app.database import engine
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
)
from app.models.follow import Follow
from app.models.media import Media
from app.models.source import Source, SourceLink
from app.models.tag import Tag
from app.models.user import User
from app.services import social as social_service
from app.services.event_filters import EventFilters
from app.services.pagination import MAX_PAGE_SIZE, encode_cursor
from tests._fixtures import client, fake_sha256, make_detection, make_event
from tests.conftest import login_as


def test_follow_creates_edge_and_is_idempotent(db, make_user):
    follower = make_user("follower")
    target = make_user("target")

    first = client.post(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert first.status_code == 204

    second = client.post(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert second.status_code == 204

    edges = (
        db.query(Follow)
        .filter(Follow.follower_id == follower.id, Follow.followed_id == target.id)
        .count()
    )
    assert edges == 1


def test_follow_self_rejected_400(db, make_user):
    me = make_user("me")

    response = client.post(f"/api/v1/users/{me.username}/follow", headers=login_as(client, me))
    assert response.status_code == 400


def test_follow_unknown_user_404(db, make_user):
    me = make_user("me")

    response = client.post(
        f"/api/v1/users/ghost-{uuid.uuid4().hex}/follow", headers=login_as(client, me)
    )
    assert response.status_code == 404


def test_follow_soft_deleted_user_404(db, make_user):
    me = make_user("me")
    target = make_user("gone")
    target.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.post(f"/api/v1/users/{target.username}/follow", headers=login_as(client, me))
    assert response.status_code == 404


def test_follow_requires_auth():
    response = client.post(f"/api/v1/users/anyone-{uuid.uuid4().hex}/follow")
    assert response.status_code == 401


# ── DELETE /users/{username}/follow ───────────────────────────────────────


def test_unfollow_removes_edge_and_is_idempotent(db, make_user):
    follower = make_user("follower")
    target = make_user("target")
    db.add(Follow(follower_id=follower.id, followed_id=target.id))
    db.commit()

    first = client.delete(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert first.status_code == 204

    second = client.delete(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert second.status_code == 204

    edges = (
        db.query(Follow)
        .filter(Follow.follower_id == follower.id, Follow.followed_id == target.id)
        .count()
    )
    assert edges == 0


def test_unfollow_unknown_user_404(db, make_user):
    me = make_user("me")

    response = client.delete(
        f"/api/v1/users/ghost-{uuid.uuid4().hex}/follow", headers=login_as(client, me)
    )
    assert response.status_code == 404


# ── DB-level CHECK constraint ─────────────────────────────────────────────


def test_check_constraint_blocks_self_follow(db, make_user):
    me = make_user("me")

    db.add(Follow(follower_id=me.id, followed_id=me.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ── Concurrent-follow race ────────────────────────────────────────────────


def test_follow_swallows_integrity_error_from_concurrent_race(db, make_user, monkeypatch):
    """Two requests racing past the existence check hit ``IntegrityError`` on the
    composite PK; the service swallows it in a SAVEPOINT and returns ``False``
    (idempotent ``204``), not a 500.

    Forced by pre-populating the row and patching the existence check."""
    follower = make_user("follower")
    target = make_user("target")

    db.add(Follow(follower_id=follower.id, followed_id=target.id))
    db.commit()

    # ``Query.first`` returning None skips the existence check, so ``follow_user``
    # reaches the savepoint INSERT.
    from sqlalchemy.orm import Query

    monkeypatch.setattr(Query, "first", lambda self: None)
    result = social_service.follow_user(db, follower_id=follower.id, followed_user=target)
    assert result is False


# ── GET /feed ─────────────────────────────────────────────────────────


def _make_request(db, *, requester: User, title: str = "Help", at: datetime | None = None) -> Event:
    request = Event(
        owner_id=requester.id,
        requested_by_id=requester.id,
        title=title,
        sources=[
            Source(
                level="direct", kind="unknown", links=[SourceLink(url="https://example.com/ask")]
            )
        ],
        status=STATUS_REQUESTED,
        requested_at=at or datetime.now(UTC),
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


def _fulfil(event: Event, *, by: User, at: datetime | None = None) -> None:
    # Read before the writes: refreshing an expired ``by`` autoflushes, and a half-written
    # row trips ``ck_events_coords_status``.
    owner_id = by.id
    event.coords = from_shape(Point(37.8, 48.0), srid=4326)
    event.geolocated_at = at or datetime.now(UTC)
    event.owner_id = owner_id
    event.status = STATUS_GEOLOCATED
    event.version_no = 1


def _walk(headers: dict, url: str) -> list[dict]:
    """Every row of a feed walk, following ``Link: rel="next"`` to the end."""
    rows: list[dict] = []
    next_url: str | None = url
    while next_url is not None:
        response = client.get(next_url, headers=headers)
        assert response.status_code == 200
        rows.extend(response.json())
        link = response.headers.get("Link")
        next_url = link[1 : link.index(">")] if link else None
    return rows


def test_feed_requires_auth():
    response = client.get("/api/v1/feed")
    assert response.status_code == 401


def test_feed_empty_when_no_follows(db, make_user):
    me = make_user("me")

    response = client.get("/api/v1/feed", headers=login_as(client, me))
    assert response.status_code == 200
    assert response.json() == []
    assert "Link" not in response.headers


def test_feed_following_carries_geolocations_and_requests_credited(db, make_user):
    """A geolocation counts for its owner and a request for its requester, so a request
    fulfilled by a stranger leaves the requester's followers and reaches the fulfiller's."""
    viewer = make_user("viewer")
    analyst = make_user("analyst")
    stranger = make_user("stranger")

    geo = make_event(db, author=analyst, title="Geo")
    geo.geolocated_at = datetime(2026, 5, 20, 9, 0, tzinfo=UTC)
    _make_request(db, requester=analyst, title="Ask", at=datetime(2026, 5, 20, 10, 0, tzinfo=UTC))
    fulfilled_by_stranger = _make_request(db, requester=analyst, title="Fulfilled by stranger")
    _fulfil(fulfilled_by_stranger, by=stranger)
    answered_for_stranger = _make_request(db, requester=stranger, title="Answered by analyst")
    _fulfil(answered_for_stranger, by=analyst, at=datetime(2026, 5, 20, 8, 0, tzinfo=UTC))
    make_event(db, author=stranger, title="Stranger geo")
    _make_request(db, requester=stranger, title="Stranger ask")
    db.add(
        Media(
            sha256=fake_sha256(),
            source_id=geo.sources[0].id,
            storage_url=f"http://localhost:8000/local-storage/uploads/{geo.id}/thumb.jpg",
            kind="image",
        )
    )
    db.add(Follow(follower_id=viewer.id, followed_id=analyst.id))
    db.commit()

    response = client.get("/api/v1/feed", headers=login_as(client, viewer))
    assert response.status_code == 200
    items = response.json()
    assert [item["title"] for item in items] == ["Ask", "Geo", "Answered by analyst"]
    by_title = {item["title"]: item for item in items}

    assert by_title["Ask"]["status"] == STATUS_REQUESTED
    assert by_title["Ask"]["owner"]["username"] == analyst.username
    assert by_title["Ask"]["feed_at"].startswith("2026-05-20T10:00:00")
    assert by_title["Ask"]["coords"] is None

    assert by_title["Geo"]["status"] == STATUS_GEOLOCATED
    assert by_title["Geo"]["owner"]["username"] == analyst.username
    assert by_title["Geo"]["feed_at"].startswith("2026-05-20T09:00:00")
    assert isinstance(by_title["Geo"]["coords"]["lat"], (int, float))
    assert by_title["Geo"]["media"]["storage_url"].endswith("thumb.jpg")

    assert by_title["Answered by analyst"]["owner"]["username"] == analyst.username


def test_feed_all_scope_carries_rows_of_analysts_not_followed(db, make_user):
    viewer = make_user("viewer")
    stranger = make_user("stranger")

    # Far-future stamps put these rows on the first page of a feed other tests also write to.
    geo = make_event(db, author=stranger, title="Stranger geo")
    geo.geolocated_at = datetime(2999, 1, 1, 0, 0, 1, tzinfo=UTC)
    ask = _make_request(
        db, requester=stranger, title="Stranger ask", at=datetime(2999, 1, 1, 0, 0, 2, tzinfo=UTC)
    )
    db.commit()

    headers = login_as(client, viewer)
    assert client.get("/api/v1/feed", headers=headers).json() == []
    response = client.get("/api/v1/feed?scope=all&limit=100", headers=headers)
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert str(ask.id) in ids and str(geo.id) in ids
    assert ids.index(str(ask.id)) < ids.index(str(geo.id))


def test_feed_excludes_unpublished_closed_deleted_and_hidden_rows(db, make_user):
    """Each kind keeps its own predicate: a retraction, a withdrawn request and a rejected
    detection are closed, and a soft-deleted or withheld row is out of every read."""
    viewer = make_user("viewer")
    author = make_user("author")

    published = make_event(db, author=author, title="Published")
    ask = _make_request(db, requester=author, title="Open ask")
    detection = make_detection(db, author, source_url=None, title="Detection")
    rejected = make_detection(db, author, source_url=None, title="Rejected detection")
    rejected.status = STATUS_CLOSED
    rejected.before_closed_status = STATUS_DETECTED
    rejected.closed_at = datetime.now(UTC)
    rejected.close_reason = "Not the place."
    deleted_detection = make_detection(db, author, source_url=None, title="Deleted detection")
    deleted_detection.deleted_at = datetime.now(UTC)
    hidden_detection = make_detection(db, author, source_url=None, title="Hidden detection")
    hidden_detection.hidden_at = datetime.now(UTC)
    retracted = make_event(db, author=author, title="Retracted")
    retracted.status = STATUS_CLOSED
    retracted.before_closed_status = STATUS_GEOLOCATED
    retracted.closed_at = datetime.now(UTC)
    retracted.close_reason = "The footage was misattributed."
    withdrawn = _make_request(db, requester=author, title="Withdrawn ask")
    withdrawn.status = STATUS_CLOSED
    withdrawn.before_closed_status = STATUS_REQUESTED
    withdrawn.closed_at = datetime.now(UTC)
    withdrawn.close_reason = "Found it myself."
    deleted_geo = make_event(db, author=author, title="Deleted geo")
    deleted_geo.deleted_at = datetime.now(UTC)
    deleted_ask = _make_request(db, requester=author, title="Deleted ask")
    deleted_ask.deleted_at = datetime.now(UTC)
    hidden_geo = make_event(db, author=author, title="Hidden geo")
    hidden_geo.hidden_at = datetime.now(UTC)
    hidden_ask = _make_request(db, requester=author, title="Hidden ask")
    hidden_ask.hidden_at = datetime.now(UTC)
    rows = (
        published,
        ask,
        detection,
        rejected,
        deleted_detection,
        hidden_detection,
        retracted,
        withdrawn,
        deleted_geo,
        deleted_ask,
        hidden_geo,
        hidden_ask,
    )
    # A band of timestamps no other test writes: the all scope's page cut just above it holds
    # every row of ours that qualifies, whatever else the shared feed carries.
    for second, row in enumerate(rows):
        stamp = datetime(2998, 1, 1, 0, 0, second, tzinfo=UTC)
        if row.geolocated_at is not None:
            row.geolocated_at = stamp
        if row.requested_at is not None:
            row.requested_at = stamp
        if row.detected_at is not None:
            row.detected_at = stamp
    db.add(Follow(follower_id=viewer.id, followed_id=author.id))
    db.commit()

    headers = login_as(client, viewer)
    following = client.get("/api/v1/feed", headers=headers).json()
    assert {item["title"] for item in following} == {"Published", "Open ask", "Detection"}

    above_band = encode_cursor(datetime(2998, 1, 1, 0, 1, tzinfo=UTC), uuid.UUID(int=2**128 - 1))
    page = client.get(
        f"/api/v1/feed?scope=all&limit={len(rows)}&cursor={above_band}", headers=headers
    ).json()
    band = {item["title"] for item in page if item["feed_at"].startswith("2998-")}
    assert band == {"Published", "Open ask", "Detection"}


def test_feed_cursor_walks_mixed_kinds_without_gaps_or_repeats(db, make_user):
    """Geolocations, requests and detections interleave on one key, ties broken by id, so a
    walk two rows at a time serves every row once, in order."""
    viewer = make_user("viewer")
    author = make_user("author")

    rows: list[Event] = []
    for i in range(4):
        geo = make_event(db, author=author, title=f"G{i}")
        geo.geolocated_at = datetime(2026, 5, 20, 10 + i, 0, tzinfo=UTC)
        rows.append(geo)
        at = datetime(2026, 5, 20, 10 + i, 30, tzinfo=UTC)
        rows.append(_make_request(db, requester=author, title=f"R{i}", at=at))
        at = datetime(2026, 5, 20, 10 + i, 15, tzinfo=UTC)
        rows.append(make_detection(db, author, source_url=None, title=f"D{i}", at=at))
    tie = datetime(2026, 5, 20, 12, 0, tzinfo=UTC)
    tied_geo = make_event(db, author=author, title="Tied geo")
    tied_geo.geolocated_at = tie
    rows.append(tied_geo)
    rows.append(_make_request(db, requester=author, title="Tied ask", at=tie))
    rows.append(make_detection(db, author, source_url=None, title="Tied detection", at=tie))
    db.add(Follow(follower_id=viewer.id, followed_id=author.id))
    db.commit()

    walked = _walk(login_as(client, viewer), "/api/v1/feed?limit=2")
    ids = [item["id"] for item in walked]
    assert len(ids) == len(set(ids)), "a row was served twice"
    assert set(ids) == {str(row.id) for row in rows}
    keys = [(item["feed_at"], item["id"]) for item in walked]
    assert keys == sorted(keys, reverse=True)
    assert {item["status"] for item in walked} == {
        STATUS_GEOLOCATED,
        STATUS_REQUESTED,
        STATUS_DETECTED,
    }


def test_feed_carries_detections_by_default_and_status_narrows_them(db, make_user):
    """A detection is in the feed unless ``status`` leaves it out. ``following`` keeps the
    detections a followed analyst owns, ``all`` every live one, each keyed on ``detected_at``."""
    viewer = make_user("viewer")
    analyst = make_user("analyst")
    stranger = make_user("stranger")

    make_event(db, author=analyst, title="Geo")
    _make_request(db, requester=analyst, title="Ask")
    detected_at = datetime(2997, 1, 1, 0, 0, 1, tzinfo=UTC)
    make_detection(db, analyst, source_url=None, title="Detection", at=detected_at)
    make_detection(
        db,
        stranger,
        source_url=None,
        title="Stranger detection",
        at=datetime(2997, 1, 1, 0, 0, 2, tzinfo=UTC),
    )
    db.add(Follow(follower_id=viewer.id, followed_id=analyst.id))
    db.commit()
    headers = login_as(client, viewer)

    def titles(query: str) -> set[str]:
        return {item["title"] for item in _walk(headers, f"/api/v1/feed?limit=2&{query}")}

    assert titles("") == {"Geo", "Ask", "Detection"}
    assert titles("status=detected") == {"Detection"}
    assert titles("status=geolocated&status=requested") == {"Geo", "Ask"}
    assert titles("status=requested&status=detected") == {"Ask", "Detection"}

    first = client.get("/api/v1/feed?status=detected", headers=headers).json()
    assert first[0]["status"] == STATUS_DETECTED
    assert first[0]["owner"]["username"] == analyst.username
    assert first[0]["feed_at"].startswith("2997-01-01T00:00:01")

    above_band = encode_cursor(datetime(2997, 1, 1, 0, 1, tzinfo=UTC), uuid.UUID(int=2**128 - 1))
    page = client.get(
        f"/api/v1/feed?scope=all&status=detected&limit=2&cursor={above_band}", headers=headers
    ).json()
    assert [item["title"] for item in page] == ["Stranger detection", "Detection"]


@pytest.mark.parametrize("scope", ["following", "all"])
@pytest.mark.parametrize("paged", [False, True], ids=["first page", "cursor page"])
def test_feed_page_query_reads_its_index(db, scope, paged):
    """The page query's ORDER BY matches ``ix_events_timeline_at_id`` exactly. Sorting is
    priced out, so a drifted expression shows as a plan without the index."""
    captured: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        if "coalesce" in statement:
            captured.append(cursor.mogrify(statement, parameters).decode())

    cursor = (datetime(2026, 5, 20, tzinfo=UTC), uuid.uuid4()) if paged else None
    event.listen(engine, "before_cursor_execute", capture)
    try:
        social_service.get_feed(
            db,
            user_id=uuid.uuid4(),
            scope=scope,
            size=10,
            filters=EventFilters(),
            cursor=cursor,
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    db.execute(text("SET LOCAL enable_sort = off"))
    plan = "\n".join(db.execute(text("EXPLAIN " + captured[0].replace("%", "%%"))).scalars())
    db.rollback()
    assert "ix_events_timeline_at_id" in plan, plan


def test_feed_caps_limit_and_rejects_garbage(db, make_user):
    """The default page is 10 rows and over-asking is clamped to the 100-row cap; a bad
    limit, scope or cursor is a 422."""
    viewer = make_user("viewer")
    author = make_user("author")
    for i in range(MAX_PAGE_SIZE + 1):
        make_event(db, author=author, title=f"G{i}")
    db.add(Follow(follower_id=viewer.id, followed_id=author.id))
    db.commit()
    headers = login_as(client, viewer)

    default = client.get("/api/v1/feed", headers=headers)
    assert len(default.json()) == 10
    assert "Link" in default.headers

    capped = client.get("/api/v1/feed?limit=500", headers=headers)
    assert capped.status_code == 200
    assert len(capped.json()) == MAX_PAGE_SIZE
    assert "Link" in capped.headers

    for query in ("limit=0", "limit=abc", "scope=everyone", "cursor=garbage"):
        response = client.get(f"/api/v1/feed?{query}", headers=headers)
        assert response.status_code == 422, f"expected 422 for {query!r}"


@pytest.fixture
def tags(db):
    rows = [
        Tag(name=f"source-tag-{uuid.uuid4().hex[:8]}"),
        Tag(name=f"tag-{uuid.uuid4().hex[:8]}"),
    ]
    db.add_all(rows)
    db.commit()
    ids = [row.id for row in rows]
    yield rows
    db.execute(Tag.__table__.delete().where(Tag.id.in_(ids)))
    db.commit()


def test_feed_filters_by_status_conflict_source_kind_level_and_tag(db, conflict, tags, make_user):
    """``status`` keeps one kind of row; the taxonomy filters match as on ``GET /events``, in both
    scopes, and the next-page link carries them. ``tag`` matches a tag on a source too."""
    source_tag, free = tags
    viewer = make_user("viewer")
    analyst = make_user("analyst")

    tagged_geo = make_event(db, author=analyst, title="Tagged geo")
    tagged_geo.conflicts = [conflict]
    tagged_geo.tags = [free]
    tagged_geo.sources[0].kind = "drone"
    tagged_geo.sources[0].tags = [source_tag]
    make_event(db, author=analyst, title="Plain geo")
    tagged_ask = _make_request(db, requester=analyst, title="Tagged ask")
    tagged_ask.conflicts = [conflict]
    tagged_ask.tags = [free]
    tagged_ask.sources[0].level = "indirect"
    _make_request(db, requester=analyst, title="Plain ask")
    db.add(Follow(follower_id=viewer.id, followed_id=analyst.id))
    db.commit()
    headers = login_as(client, viewer)

    def titles(query: str) -> set[str]:
        return {item["title"] for item in _walk(headers, f"/api/v1/feed?limit=1&{query}")}

    assert titles("status=geolocated") == {"Tagged geo", "Plain geo"}
    assert titles("status=requested") == {"Tagged ask", "Plain ask"}
    assert titles("status=geolocated&status=requested") == {
        "Tagged geo",
        "Plain geo",
        "Tagged ask",
        "Plain ask",
    }
    assert titles(f"conflict={conflict.name}") == {"Tagged geo", "Tagged ask"}
    assert titles("source_kind=drone") == {"Tagged geo"}
    assert titles("source_kind=drone&source_kind=smartphone") == {"Tagged geo", "Plain geo"}
    assert titles("level=indirect") == {"Tagged ask"}
    assert titles(f"tag={source_tag.name}") == {"Tagged geo"}
    assert titles(f"tag={free.name}&status=requested") == {"Tagged ask"}

    all_scope = client.get(
        f"/api/v1/feed?scope=all&limit=100&status=requested&conflict={conflict.name}",
        headers=headers,
    )
    assert [item["title"] for item in all_scope.json()] == ["Tagged ask"]

    assert client.get("/api/v1/feed?status=detection", headers=headers).status_code == 422
    closed = client.get("/api/v1/feed?scope=all&status=closed", headers=headers)
    assert closed.status_code == 200 and closed.json() == []
    assert client.get("/api/v1/feed?source_kind=tripod", headers=headers).status_code == 422
    assert client.get("/api/v1/feed?level=primary", headers=headers).status_code == 422


def _stamp(row: Event, *, occurred: date | None, created: datetime) -> None:
    row.occurred_date = occurred
    row.created_at = created


def test_feed_takes_the_filter_set_of_get_events(db, make_user):
    """Dates, ``media``, ``has_coords`` and ``author`` narrow the feed as on ``GET /events``;
    ``author`` keeps a row that credits the analyst as a co-geolocator."""
    viewer = make_user("viewer")
    analyst = make_user("analyst")
    owner = make_user("owner")

    old_geo = make_event(db, author=analyst, title="Old geo")
    _stamp(old_geo, occurred=date(2024, 1, 10), created=datetime(2024, 1, 11, 23, 30, tzinfo=UTC))
    old_geo.sources[0].media = Media(sha256=fake_sha256(), storage_url="s3://x/v.mp4", kind="video")
    new_geo = make_event(db, author=analyst, title="New geo")
    _stamp(new_geo, occurred=date(2025, 6, 1), created=datetime(2025, 6, 2, tzinfo=UTC))
    db.add(
        Media(sha256=fake_sha256(), event_id=new_geo.id, storage_url="s3://x/p.jpg", kind="image")
    )
    blind = _make_request(db, requester=analyst, title="Blind ask")
    _stamp(blind, occurred=None, created=datetime(2024, 3, 6, tzinfo=UTC))
    guessed = _make_request(db, requester=analyst, title="Guessed ask")
    guessed.coords = from_shape(Point(37.8, 48.0), srid=4326)
    _stamp(guessed, occurred=None, created=datetime(2024, 3, 6, tzinfo=UTC))
    shared = make_event(db, author=owner, title="Shared geo")
    _stamp(shared, occurred=date(2024, 1, 10), created=datetime(2024, 1, 11, tzinfo=UTC))
    db.add(
        EventGeolocator(
            event_id=shared.id, user_id=analyst.id, state="active", joined_at=datetime.now(UTC)
        )
    )
    db.add(Follow(follower_id=viewer.id, followed_id=analyst.id))
    db.commit()
    headers = login_as(client, viewer)

    def titles(**params: str) -> set[str]:
        query = "&".join(f"{key}={value}" for key, value in params.items())
        return {item["title"] for item in _walk(headers, f"/api/v1/feed?limit=2&{query}")}

    every = {"Old geo", "New geo", "Blind ask", "Guessed ask", "Shared geo"}
    assert titles() == every
    assert titles(occurred_date_from="2025-01-01") == {"New geo"}
    assert titles(occurred_date_to="2024-12-31") == {"Old geo", "Shared geo"}
    assert titles(submitted_from="2025-01-01") == {"New geo"}
    assert titles(submitted_to="2024-01-11") == {"Old geo", "Shared geo"}
    assert titles(media="video") == {"Old geo"}
    assert titles(media="image") == {"New geo"}
    assert titles(has_coords="false") == {"Blind ask"}
    assert titles(has_coords="true") == every - {"Blind ask"}
    assert titles(author=owner.username) == {"Shared geo"}
    assert titles(author=analyst.username) == every

    assert client.get("/api/v1/feed?media=hologram", headers=headers).status_code == 422
    assert client.get("/api/v1/feed?author=bad%20name", headers=headers).status_code == 422
    assert client.get("/api/v1/feed?occurred_date_from=garbage", headers=headers).status_code == 422


def _feed_dates(headers: dict, **params) -> dict:
    response = client.get("/api/v1/feed/dates", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _days(*pairs: tuple[str, int]) -> list[dict]:
    return [{"date": day, "count": count} for day, count in pairs]


def test_feed_dates_count_the_walked_rows_per_day(db, make_user):
    """Each axis counts the rows ``GET /feed`` walks per day, ignores its own window and keeps
    every other filter, the other window too. The submitted day is the UTC day. ``total``
    counts the rows under every filter."""
    viewer = make_user("viewer")
    analyst = make_user("analyst")
    stranger = make_user("stranger")

    drone = make_event(db, author=analyst, title="Drone")
    drone.sources[0].kind = "drone"
    _stamp(drone, occurred=date(2024, 1, 10), created=datetime(2024, 1, 11, 23, 30, tzinfo=UTC))
    phone = make_event(db, author=analyst, title="Phone")
    _stamp(phone, occurred=date(2024, 1, 10), created=datetime(2024, 2, 1, 8, 0, tzinfo=UTC))
    undated = make_event(db, author=analyst, title="Undated")
    _stamp(undated, occurred=None, created=datetime(2024, 2, 1, 9, 0, tzinfo=UTC))
    ask = _make_request(db, requester=analyst, title="Ask")
    _stamp(ask, occurred=date(2024, 3, 5), created=datetime(2024, 3, 6, tzinfo=UTC))
    unfollowed = make_event(db, author=stranger, title="Unfollowed")
    _stamp(unfollowed, occurred=date(2024, 1, 10), created=datetime(2024, 1, 11, tzinfo=UTC))
    db.add(Follow(follower_id=viewer.id, followed_id=analyst.id))
    db.commit()
    headers = login_as(client, viewer)

    everything = _feed_dates(headers)
    assert everything == {
        "occurred_date": _days(("2024-01-10", 2), ("2024-03-05", 1)),
        "submitted": _days(("2024-01-11", 1), ("2024-02-01", 2), ("2024-03-06", 1)),
        "total": 4,
    }

    by_occurrence = _feed_dates(headers, occurred_date_from="2024-03-01")
    assert by_occurrence["occurred_date"] == everything["occurred_date"]
    assert by_occurrence["submitted"] == _days(("2024-03-06", 1))
    assert by_occurrence["total"] == 1

    by_submission = _feed_dates(headers, submitted_from="2024-02-01")
    assert by_submission["submitted"] == everything["submitted"]
    assert by_submission["occurred_date"] == _days(("2024-01-10", 1), ("2024-03-05", 1))
    assert by_submission["total"] == 3

    assert _feed_dates(headers, source_kind="drone") == {
        "occurred_date": _days(("2024-01-10", 1)),
        "submitted": _days(("2024-01-11", 1)),
        "total": 1,
    }
    assert _feed_dates(headers, status="requested") == {
        "occurred_date": _days(("2024-03-05", 1)),
        "submitted": _days(("2024-03-06", 1)),
        "total": 1,
    }
    assert _feed_dates(headers, scope="all", author=stranger.username) == {
        "occurred_date": _days(("2024-01-10", 1)),
        "submitted": _days(("2024-01-11", 1)),
        "total": 1,
    }


def test_feed_dates_requires_auth():
    assert client.get("/api/v1/feed/dates").status_code == 401


# ── GET /users/{username} — follower counters + is_following ─────────────


def test_profile_includes_follow_counters_and_is_following(db, make_user):
    me = make_user("me")
    target = make_user("target")
    other_follower = make_user("other")

    db.add(Follow(follower_id=me.id, followed_id=target.id))
    db.add(Follow(follower_id=other_follower.id, followed_id=target.id))
    db.add(Follow(follower_id=target.id, followed_id=me.id))
    db.commit()

    anon = client.get(f"/api/v1/users/{target.username}").json()
    assert anon["followers_count"] == 2
    assert anon["following_count"] == 1
    assert anon["is_following"] is False

    authed = client.get(f"/api/v1/users/{target.username}", headers=login_as(client, me)).json()
    assert authed["followers_count"] == 2
    assert authed["following_count"] == 1
    assert authed["is_following"] is True
