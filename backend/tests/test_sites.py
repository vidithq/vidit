"""Sites: create with the first observation, overlap warnings, the zone valid on a date, event
links (owner only, published and visible only), inside-zone measurement, corroboration, nearby
events and link suggestions."""

from __future__ import annotations

import math
import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.event import STATUS_CLOSED, STATUS_GEOLOCATED, Event
from app.models.site import EventSiteLink, Site
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)

SITES = "/api/v1/sites"
# Fictional coordinates, away from any real position.
LNG, LAT = 30.0, 10.0
# Around the test area only, so rows other tests leave behind stay out of the map reads.
BBOX = f"{LAT - 1},{LNG - 1},{LAT + 1},{LNG + 1}"


def _metres_east(degrees: float, lat: float = LAT) -> float:
    return degrees * 111_320 * math.cos(math.radians(lat))


def _square(half: float, *, lng: float = LNG, lat: float = LAT) -> dict:
    ring = [
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
    ]
    return {"type": "Polygon", "coordinates": [ring]}


def _observation(zone: dict, captured_on: str = "2025-01-01", **extra) -> dict:
    return {
        "zone": zone,
        "captured_on": captured_on,
        "imagery_provider": "sentinel_2",
        **extra,
    }


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
def users(db):
    """A factory of throwaway analysts; their sites go with them, their events are reaped first."""
    made: list[uuid.UUID] = []

    def make(*, is_admin: bool = False) -> User:
        user = User(
            username=f"site{uuid.uuid4().hex[:8]}",
            email=f"site-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password("password123"),
            is_admin=is_admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        made.append(user.id)
        return user

    yield make

    db.expire_all()
    db.query(Event).filter(Event.owner_id.in_(made)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(made)).delete(synchronize_session=False)
    db.commit()


def _event(
    db,
    owner: User,
    *,
    lng: float = LNG,
    lat: float = LAT,
    occurred_date: date = date(2025, 3, 1),
    status: str = STATUS_GEOLOCATED,
) -> Event:
    now = datetime.now(UTC)
    event = Event(
        owner_id=owner.id,
        title=f"Event {uuid.uuid4().hex[:8]}",
        coords=from_shape(Point(lng, lat), srid=4326),
        occurred_date=occurred_date,
        status=status,
        geolocated_at=now,
        closed_at=now if status == STATUS_CLOSED else None,
        before_closed_status=STATUS_GEOLOCATED if status == STATUS_CLOSED else None,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _create_site(user: User, zone: dict, *, name: str = "Site Alpha", **observation) -> dict:
    response = client.post(
        SITES,
        json={
            "name": name,
            "site_type": "airbase",
            "observation": _observation(zone, **observation),
        },
        headers=login_as(client, user),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _link(user: User, event: Event, site_id: str, effect: str = "damage"):
    return client.post(
        f"/api/v1/events/{event.id}/site-links",
        json={"site_id": site_id, "effect": effect},
        headers=login_as(client, user),
    )


def _read(site_id: str) -> dict:
    client.cookies.clear()
    response = client.get(f"{SITES}/{site_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_create_site_with_first_observation(users):
    owner = users()
    body = _create_site(owner, _square(0.01), note="  Runway visible.  ")

    assert body["name"] == "Site Alpha"
    assert body["owner"]["id"] == str(owner.id)
    assert body["observed_on"] == "2025-01-01"
    assert body["imagery_provider"] == "sentinel_2"
    assert body["observation_effect"] == "observed_no_change"
    assert body["corroboration_count"] == 0
    assert body["is_corroborated"] is False
    assert body["latest_link_effect"] is None
    assert body["overlapping_sites"] == []
    assert body["centroid"] == pytest.approx({"lat": LAT, "lng": LNG})
    (observation,) = body["observations"]
    assert observation["author"]["id"] == str(owner.id)
    assert observation["note"] == "Runway visible."
    assert observation["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.01, LAT - 0.01])


@pytest.mark.parametrize(
    ("observation", "status"),
    [
        ({"imagery_provider": "other"}, 422),
        ({"captured_on": "2999-01-01"}, 422),
        (
            {
                "zone": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
                }
            },
            400,
        ),
        ({"zone": {"type": "Polygon", "coordinates": [[[0, 95], [1, 95], [1, 96], [0, 95]]]}}, 400),
    ],
    ids=["other-without-url", "future-capture", "self-crossing", "out-of-range"],
)
def test_create_refuses_an_unreproducible_or_invalid_observation(users, observation, status):
    owner = users()
    response = client.post(
        SITES,
        json={
            "name": "Bad",
            "site_type": "depot",
            "observation": {**_observation(_square(0.01)), **observation},
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == status, response.text
    if status == 400:
        assert response.json()["detail"]["code"] == "invalid_zone"


def test_overlap_check_reports_both_shares(users):
    owner = users()
    lng = LNG + 0.3
    existing = _create_site(owner, _square(0.01, lng=lng))

    probe = _square(0.01, lng=lng + 0.01)
    response = client.post(
        f"{SITES}/overlaps", json={"zone": probe}, headers=login_as(client, owner)
    )
    assert response.status_code == 200
    (hit,) = [row for row in response.json() if row["id"] == existing["id"]]
    assert hit["share_of_new_zone"] == pytest.approx(0.5, abs=0.01)
    assert hit["share_of_existing_zone"] == pytest.approx(0.5, abs=0.01)

    created = _create_site(owner, probe, name="Site Bravo")
    assert existing["id"] in {row["id"] for row in created["overlapping_sites"]}


def test_overlap_check_skips_a_withheld_site(db, users):
    owner = users()
    lng = LNG - 0.3
    existing = _create_site(owner, _square(0.01, lng=lng))
    db.query(Site).filter(Site.id == existing["id"]).update({"hidden_at": datetime.now(UTC)})
    db.commit()

    response = client.post(
        f"{SITES}/overlaps",
        json={"zone": _square(0.01, lng=lng)},
        headers=login_as(client, owner),
    )
    assert existing["id"] not in {row["id"] for row in response.json()}


def test_map_read_selects_the_zone_valid_on_as_of(users):
    owner = users()
    site = _create_site(owner, _square(0.01), captured_on="2025-01-01")
    grown = client.post(
        f"{SITES}/{site['id']}/observations",
        json=_observation(_square(0.05), "2025-06-01", effect="construction_extension"),
        headers=login_as(client, owner),
    )
    assert grown.status_code == 201

    def on(as_of: str, bbox: str = BBOX) -> dict | None:
        client.cookies.clear()
        response = client.get(SITES, params={"bbox": bbox, "as_of": as_of})
        assert response.status_code == 200
        return next((row for row in response.json() if row["id"] == site["id"]), None)

    assert on("2024-12-31") is None
    before = on("2025-03-01")
    after = on("2025-07-01")
    assert before is not None and after is not None
    assert before["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.01, LAT - 0.01])
    assert before["observation_effect"] == "observed_no_change"
    assert after["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.05, LAT - 0.05])
    assert after["observation_effect"] == "construction_extension"
    assert after["observed_on"] == "2025-06-01"

    # A box that only the grown zone reaches.
    edge = f"{LAT + 0.03},{LNG + 0.03},{LAT + 0.04},{LNG + 0.04}"
    assert on("2025-03-01", edge) is None
    assert on("2025-07-01", edge) is not None


def _link_rows(db, event: Event) -> list[EventSiteLink]:
    db.expire_all()
    return (
        db.query(EventSiteLink)
        .filter(EventSiteLink.event_id == event.id)
        .order_by(EventSiteLink.linked_at)
        .all()
    )


def test_only_the_event_owner_links_and_unlinks(db, users):
    owner, stranger = users(), users()
    site = _create_site(stranger, _square(0.01))
    event = _event(db, owner)

    assert _link(stranger, event, site["id"]).status_code == 403
    first = _link(owner, event, site["id"], "damage")
    assert first.status_code == 200
    assert first.json()["site"]["id"] == site["id"]
    assert _link(owner, event, site["id"], "damage").json() == first.json()
    assert len(_link_rows(db, event)) == 1

    path = f"/api/v1/events/{event.id}/site-links/{site['id']}"
    assert client.delete(path, headers=login_as(client, stranger)).status_code == 403
    assert client.delete(path, headers=login_as(client, owner)).status_code == 204
    assert client.delete(path, headers=login_as(client, owner)).status_code == 204
    assert client.get(f"/api/v1/events/{event.id}/site-links").json() == []

    (row,) = _link_rows(db, event)
    assert row.unlinked_at is not None
    assert (row.linked_by_id, row.unlinked_by_id) == (owner.id, owner.id)
    body = _read(site["id"])
    assert body["linked_events"] == []
    assert body["corroboration_count"] == 0
    assert body["latest_link_effect"] is None


def test_an_effect_change_keeps_the_superseded_link(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01))
    event = _event(db, owner)
    _link(owner, event, site["id"], "damage")
    changed = _link(owner, event, site["id"], "destruction")
    assert changed.json()["effect"] == "destruction"

    old, new = _link_rows(db, event)
    assert (old.effect, new.effect) == ("damage", "destruction")
    assert old.unlinked_at == new.linked_at
    assert new.unlinked_at is None
    links = client.get(f"/api/v1/events/{event.id}/site-links").json()
    assert [link["effect"] for link in links] == ["destruction"]

    history = client.get(f"{SITES}/{site['id']}/history").json()
    kinds = [entry["kind"] for entry in history]
    assert kinds.count("event_linked") == 1
    assert "event_unlinked" not in kinds
    (change,) = [entry for entry in history if entry["kind"] == "link_effect_changed"]
    assert (change["previous_link_effect"], change["link_effect"]) == ("damage", "destruction")
    assert change["event"]["id"] == str(event.id)
    assert change["actor"]["id"] == str(owner.id)


def test_history_orders_by_either_clock(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01), captured_on="2025-05-01")
    old_imagery = client.post(
        f"{SITES}/{site['id']}/observations",
        json=_observation(_square(0.01), "2024-01-01", effect="no_visible_activity"),
        headers=login_as(client, owner),
    )
    assert old_imagery.status_code == 201
    event = _event(db, owner, occurred_date=date(2024, 6, 1))
    _link(owner, event, site["id"], "damage")
    client.delete(
        f"/api/v1/events/{event.id}/site-links/{site['id']}", headers=login_as(client, owner)
    )

    def history(order: str) -> list[tuple[str, str | None]]:
        client.cookies.clear()
        response = client.get(f"{SITES}/{site['id']}/history", params={"order": order})
        assert response.status_code == 200
        return [(entry["kind"], entry["fact_date"]) for entry in response.json()]

    assert history("recorded") == [
        ("site_created", None),
        ("observation_added", "2025-05-01"),
        ("observation_added", "2024-01-01"),
        ("event_linked", "2024-06-01"),
        ("event_unlinked", "2024-06-01"),
    ]
    # Record-only entries sit on the day they were recorded.
    assert history("fact") == [
        ("observation_added", "2024-01-01"),
        ("event_linked", "2024-06-01"),
        ("event_unlinked", "2024-06-01"),
        ("observation_added", "2025-05-01"),
        ("site_created", None),
    ]
    assert client.get(f"{SITES}/{site['id']}/history", params={"order": "x"}).status_code == 422


def test_link_refuses_an_unpublished_event_or_unknown_site(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01))
    closed = _event(db, owner, status=STATUS_CLOSED)
    response = _link(owner, closed, site["id"])
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "event_not_linkable"

    published = _event(db, owner)
    response = _link(owner, published, str(uuid.uuid4()))
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "site_not_found"


def test_a_closed_or_withheld_event_drops_out_of_the_site(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01))
    retracted = _event(db, analyst)
    withheld = _event(db, analyst)
    assert _link(analyst, retracted, site["id"]).status_code == 200
    assert _link(analyst, withheld, site["id"]).status_code == 200
    assert _read(site["id"])["corroboration_count"] == 1

    retracted.status = STATUS_CLOSED
    retracted.closed_at = datetime.now(UTC)
    retracted.before_closed_status = STATUS_GEOLOCATED
    withheld.hidden_at = datetime.now(UTC)
    db.commit()

    body = _read(site["id"])
    assert body["linked_events"] == []
    assert body["corroboration_count"] == 0
    assert body["is_corroborated"] is False
    assert body["latest_link_effect"] is None
    assert client.get(f"/api/v1/events/{withheld.id}/site-links").status_code == 404


def test_inside_zone_is_measured_against_the_zone_valid_on_the_occurred_date(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01), captured_on="2025-01-01")
    client.post(
        f"{SITES}/{site['id']}/observations",
        json=_observation(_square(0.05), "2025-06-01"),
        headers=login_as(client, owner),
    )
    # 0.03 degrees east of the centre: outside the small zone, inside the grown one.
    early = _event(db, owner, lng=LNG + 0.03, occurred_date=date(2025, 3, 1))
    late = _event(db, owner, lng=LNG + 0.03, occurred_date=date(2025, 7, 1))
    before_all = _event(db, owner, occurred_date=date(2024, 6, 1))
    for event in (early, late, before_all):
        assert _link(owner, event, site["id"]).status_code == 200

    body = _read(site["id"])
    by_id = {row["id"]: row for row in body["linked_events"]}
    first, second = body["observations"]

    assert by_id[str(early.id)]["inside_zone"] is False
    assert by_id[str(early.id)]["distance_m"] == pytest.approx(_metres_east(0.02), rel=0.01)
    assert by_id[str(early.id)]["measured_observation_id"] == first["id"]
    assert by_id[str(late.id)]["inside_zone"] is True
    assert by_id[str(late.id)]["distance_m"] is None
    assert by_id[str(late.id)]["measured_observation_id"] == second["id"]
    # Older than every observation: measured against the earliest.
    assert by_id[str(before_all.id)]["measured_observation_id"] == first["id"]
    assert by_id[str(before_all.id)]["inside_zone"] is True
    assert [row["id"] for row in body["linked_events"]] == [
        str(before_all.id),
        str(early.id),
        str(late.id),
    ]


def test_corroboration_counts_distinct_linked_event_owners(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01))

    _link(owner, _event(db, owner, occurred_date=date(2025, 2, 1)), site["id"], "damage")
    _link(owner, _event(db, owner, occurred_date=date(2025, 2, 2)), site["id"], "damage")
    body = _read(site["id"])
    assert body["corroboration_count"] == 1
    assert body["is_corroborated"] is False

    latest = _event(db, analyst, occurred_date=date(2025, 4, 1))
    _link(analyst, latest, site["id"], "destruction")
    body = _read(site["id"])
    assert body["corroboration_count"] == 2
    assert body["is_corroborated"] is True
    assert body["latest_link_effect"] == {
        "effect": "destruction",
        "occurred_date": "2025-04-01",
        "event_id": str(latest.id),
    }
    # The site state stays the observation's.
    assert body["observation_effect"] == "observed_no_change"


def test_nearby_events_exclude_linked_and_distant_ones(db, users):
    owner = users()
    lat = LAT + 0.4
    site = _create_site(owner, _square(0.01, lat=lat))
    linked = _event(db, owner, lat=lat)
    near = _event(db, owner, lat=lat, lng=LNG + 0.02)
    far = _event(db, owner, lat=lat, lng=LNG + 0.2)
    _link(owner, linked, site["id"])

    client.cookies.clear()
    response = client.get(f"{SITES}/{site['id']}/nearby-events", params={"margin_m": 2000})
    assert response.status_code == 200
    ids = [row["id"] for row in response.json()]
    assert str(near.id) in ids
    assert str(linked.id) not in ids
    assert str(far.id) not in ids
    assert response.json()[0]["distance_m"] == pytest.approx(_metres_east(0.01, lat), rel=0.01)


def test_site_suggestions_by_distance_and_by_name(db, users):
    owner = users()
    lat = LAT - 0.4
    site = _create_site(owner, _square(0.01, lat=lat), name=f"Depot {uuid.uuid4().hex[:6]}")
    near = _event(db, owner, lat=lat, lng=LNG + 0.015)
    far = _event(db, owner, lat=lat, lng=LNG + 0.5)
    headers = login_as(client, owner)

    path = f"/api/v1/events/{near.id}/site-suggestions"
    assert site["id"] in {row["id"] for row in client.get(path, headers=headers).json()}
    far_path = f"/api/v1/events/{far.id}/site-suggestions"
    assert site["id"] not in {row["id"] for row in client.get(far_path, headers=headers).json()}
    by_name = client.get(far_path, params={"q": site["name"][-6:]}, headers=headers).json()
    assert [row["id"] for row in by_name] == [site["id"]]
    assert by_name[0]["distance_m"] > 40_000


def test_a_withheld_site_reads_only_for_an_admin(db, users):
    owner, admin = users(), users(is_admin=True)
    site = _create_site(owner, _square(0.01))
    db.query(Site).filter(Site.id == site["id"]).update({"hidden_at": datetime.now(UTC)})
    db.commit()

    client.cookies.clear()
    assert client.get(f"{SITES}/{site['id']}").status_code == 404
    listed = client.get(SITES, params={"bbox": BBOX}).json()
    assert site["id"] not in {row["id"] for row in listed}
    login_as(client, admin)
    assert client.get(f"{SITES}/{site['id']}").status_code == 200


def test_map_read_carries_the_owner_and_the_latest_link_effect_on_as_of(db, users):
    owner, analyst = users(), users()
    lng = LNG + 0.6
    site = _create_site(owner, _square(0.01, lng=lng), captured_on="2025-01-01")

    def on(as_of: str) -> dict:
        client.cookies.clear()
        response = client.get(SITES, params={"bbox": BBOX, "as_of": as_of})
        assert response.status_code == 200
        return next(row for row in response.json() if row["id"] == site["id"])

    row = on("2025-12-31")
    assert row["owner_id"] == str(owner.id)
    assert row["latest_link_effect"] is None

    damage = _event(db, analyst, lng=lng, occurred_date=date(2025, 3, 1))
    assert _link(analyst, damage, site["id"], "damage").status_code == 200
    later = _event(db, analyst, lng=lng, occurred_date=date(2025, 9, 1))
    assert _link(analyst, later, site["id"], "destruction").status_code == 200
    closed = _event(db, analyst, lng=lng, occurred_date=date(2025, 10, 1))
    assert _link(analyst, closed, site["id"], "other").status_code == 200
    unlinked = _event(db, analyst, lng=lng, occurred_date=date(2025, 11, 1))
    assert _link(analyst, unlinked, site["id"], "other").status_code == 200
    client.delete(
        f"/api/v1/events/{unlinked.id}/site-links/{site['id']}", headers=login_as(client, analyst)
    )
    closed.status = STATUS_CLOSED
    closed.closed_at = datetime.now(UTC)
    closed.before_closed_status = STATUS_GEOLOCATED
    db.commit()

    assert on("2025-12-31")["latest_link_effect"] == {
        "effect": "destruction",
        "occurred_date": "2025-09-01",
        "event_id": str(later.id),
    }
    # A link whose event is dated after as_of stays out of the map read.
    assert on("2025-06-01")["latest_link_effect"] == {
        "effect": "damage",
        "occurred_date": "2025-03-01",
        "event_id": str(damage.id),
    }
    assert on("2025-02-01")["latest_link_effect"] is None
    assert _read(site["id"])["latest_link_effect"]["event_id"] == str(later.id)
