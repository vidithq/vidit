"""Sites: create with the first image and contour, the imagery history (any analyst files, the
provider check refuses an image no reader can reopen, a repeat is flagged), the owner-only
contour and record edits, the zone valid on a date, event links, corroboration, nearby events,
suggestions, moderation, and the history on both clocks."""

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
from app.models.media import Media
from app.models.site import EventSiteLink, Site, SiteVersion
from app.models.source import Source, SourceLink
from app.models.user import User
from app.services.auth import hash_password
from tests._fixtures import fake_sha256
from tests.conftest import login_as
from tests.events._helpers import stage_file

client = TestClient(app)

SITES = "/api/v1/sites"
# Fictional coordinates, away from any real position.
LNG, LAT = 30.0, 10.0
# Around the test area only, so rows other tests leave behind stay out of the map reads.
BBOX = f"{LAT - 1},{LNG - 1},{LAT + 1},{LNG + 1}"
COPERNICUS = (
    "https://browser.dataspace.copernicus.eu/?zoom=14&lat=10&lng=30&datasetId=S2_L2A_CDAS"
    "&layerId=1_TRUE_COLOR&fromTime=2025-01-01T00:00:00.000Z&toTime=2025-01-01T23:59:59.999Z"
)
WAYBACK = "https://livingatlas.arcgis.com/wayback/#active=12345&mapCenter=30.0%2C10.0%2C16"
GOOGLE_MAPS = "https://www.google.com/maps/@10,30,500m/data=!3m1!1e3"


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


def _image(captured: str = "2025-01-01", url: str = COPERNICUS, **extra) -> dict:
    return {"captured_at": f"{captured}T10:00:00Z", "links": [{"url": url}], **extra}


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
    occurred_date: date | None = date(2025, 3, 1),
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


def _post_site(user: User, zone: dict, *, name: str = "Site Alpha", **image) -> object:
    return client.post(
        SITES,
        json={"name": name, "kind": "airbase", "contour": zone, "image": _image(**image)},
        headers=login_as(client, user),
    )


def _create_site(user: User, zone: dict, *, name: str = "Site Alpha", **image) -> dict:
    response = _post_site(user, zone, name=name, **image)
    assert response.status_code == 201, response.text
    return response.json()


def _file(user: User, site_id: str, body: dict):
    return client.post(f"{SITES}/{site_id}/images", json=body, headers=login_as(client, user))


def _contour(user: User, site_id: str, zone: dict, image_id: str):
    return client.post(
        f"{SITES}/{site_id}/contours",
        json={"zone": zone, "image_id": image_id},
        headers=login_as(client, user),
    )


def _grow(owner: User, site_id: str, zone: dict, captured: str) -> dict:
    """File an image captured on ``captured`` and draw ``zone`` from it."""
    filed = _file(owner, site_id, _image(captured))
    assert filed.status_code == 201, filed.text
    drawn = _contour(owner, site_id, zone, filed.json()["id"])
    assert drawn.status_code == 201, drawn.text
    return drawn.json()


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


def _on_map(site_id: str, as_of: str, bbox: str = BBOX) -> dict | None:
    client.cookies.clear()
    response = client.get(SITES, params={"bbox": bbox, "as_of": as_of})
    assert response.status_code == 200, response.text
    return next((row for row in response.json() if row["id"] == site_id), None)


def _code(response) -> str:
    return response.json()["detail"]["code"]


def test_create_site_with_its_first_image_and_contour(users):
    owner = users()
    body = _create_site(owner, _square(0.01), note="  Runway visible.  ", title="Pass 1")

    assert (body["name"], body["kind"]) == ("Site Alpha", "airbase")
    assert body["owner"]["id"] == str(owner.id)
    assert body["hidden_at"] is None
    assert body["overlapping_sites"] == []
    assert body["centroid"] == pytest.approx({"lat": LAT, "lng": LNG})
    (image,) = body["images"]
    assert (image["kind"], image["level"], image["title"]) == ("satellite", "context", "Pass 1")
    assert image["author"]["id"] == str(owner.id)
    assert image["note"] == "Runway visible."
    assert image["provider"]["id"] == "copernicus_browser"
    assert image["warnings"] == []
    assert image["links"][0]["url"] == COPERNICUS
    (contour,) = body["contours"]
    assert contour["image_id"] == image["id"]
    assert contour["id"] == body["contour_id"]
    assert contour["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.01, LAT - 0.01])
    assert body["last_image"] == {
        "id": image["id"],
        "captured_at": "2025-01-01T10:00:00Z",
        "provider": {"id": "copernicus_browser", "name": "Copernicus Browser"},
    }
    # The owner filed the first image: one contributor, not corroborated.
    assert body["corroboration_count"] == 1
    assert body["is_corroborated"] is False
    assert body["latest_link_effect"] is None


@pytest.mark.parametrize(
    ("change", "status", "code"),
    [
        (
            {
                "contour": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
                }
            },
            400,
            "invalid_zone",
        ),
        (
            {"contour": {"type": "Polygon", "coordinates": [[[0, 95], [1, 95], [1, 96], [0, 95]]]}},
            400,
            "invalid_zone",
        ),
        ({"kind": "bunker"}, 422, None),
        ({"name": "   "}, 422, None),
        ({"image": _image("2999-01-01")}, 422, None),
        (
            {"image": {"captured_at": "2025-01-01T00:00:00Z", "links": []}},
            400,
            "source_link_required",
        ),
        ({"image": _image(url=GOOGLE_MAPS)}, 400, "imagery_not_reopenable"),
        ({"image": _image(url="https://imagery.example/pass.png")}, 400, "imagery_not_reopenable"),
        ({"image": _image(url="https://goo.gl/abc")}, 400, "imagery_not_reopenable"),
    ],
    ids=[
        "self-crossing",
        "out-of-range",
        "unknown-kind",
        "blank-name",
        "future-capture",
        "no-link",
        "provider-not-reopenable",
        "unlisted-provider",
        "short-link",
    ],
)
def test_create_refuses_an_invalid_site_or_an_image_no_reader_can_reopen(
    db, users, change, status, code
):
    owner = users()
    body = {"name": "Bad", "kind": "depot", "contour": _square(0.01), "image": _image(), **change}
    response = client.post(SITES, json=body, headers=login_as(client, owner))
    assert response.status_code == status, response.text
    if code is not None:
        assert _code(response) == code
    db.expire_all()
    assert db.query(Site).filter(Site.owner_id == owner.id).count() == 0


def test_an_unlisted_publication_with_an_archived_copy_is_accepted(users):
    owner = users()
    url = "https://news.example/strike-imagery"
    snapshot = "https://web.archive.org/web/20250101000000/https://news.example/strike-imagery"
    response = client.post(
        SITES,
        json={
            "name": "Archived",
            "kind": "unknown",
            "contour": _square(0.01, lat=LAT + 0.7),
            "image": {
                "captured_at": "2025-01-01T00:00:00Z",
                "links": [{"url": url, "snapshot_url": snapshot}],
            },
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201, response.text
    (image,) = response.json()["images"]
    assert image["provider"] is None
    assert image["links"][0]["archived"]["provider"] == "wayback"
    assert response.json()["last_image"]["provider"] is None


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
    assert hit["kind"] == "airbase"
    assert hit["share_of_new_zone"] == pytest.approx(0.5, abs=0.01)
    assert hit["share_of_existing_zone"] == pytest.approx(0.5, abs=0.01)

    created = _create_site(owner, probe, name="Site Bravo")
    assert existing["id"] in {row["id"] for row in created["overlapping_sites"]}


def test_any_analyst_files_an_image_and_a_repeat_is_flagged(users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lng=LNG - 0.6), captured="2025-01-01")

    repeat = _file(analyst, site["id"], _image("2025-01-01", note="Same pass, closer crop"))
    assert repeat.status_code == 201, repeat.text
    body = repeat.json()
    assert body["author"]["id"] == str(analyst.id)
    assert body["duplicate_image_ids"] == [site["images"][0]["id"]]

    other_provider = _file(analyst, site["id"], _image("2025-01-01", url=WAYBACK))
    assert other_provider.json()["duplicate_image_ids"] == []
    other_day = _file(analyst, site["id"], _image("2025-01-02"))
    assert other_day.json()["duplicate_image_ids"] == []

    read = _read(site["id"])
    assert len(read["images"]) == 4
    assert read["corroboration_count"] == 2
    assert read["is_corroborated"] is True
    # Images never move the contour.
    assert [c["id"] for c in read["contours"]] == [site["contour_id"]]

    unknown = _file(analyst, str(uuid.uuid4()), _image())
    assert unknown.status_code == 404
    assert _code(unknown) == "site_not_found"
    refused = _file(analyst, site["id"], _image(url=GOOGLE_MAPS))
    assert _code(refused) == "imagery_not_reopenable"


def test_an_image_takes_a_staged_upload_or_the_file_of_a_published_event(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01, lat=LAT - 0.7))
    upload_id = stage_file(owner)
    staged = _file(owner, site["id"], _image(upload_id=upload_id))
    assert staged.status_code == 201, staged.text
    assert staged.json()["media"]["role"] == "source"

    event = _event(db, owner)
    media = Media(
        storage_url=f"https://cdn.example/{uuid.uuid4().hex}.jpg",
        kind="image",
        sha256=fake_sha256(),
    )
    db.add(
        Source(
            event_id=event.id,
            level="direct",
            kind="satellite",
            links=[SourceLink(url=COPERNICUS)],
            media=media,
        )
    )
    db.commit()
    copied = _file(owner, site["id"], _image(media_id=str(media.id)))
    assert copied.status_code == 201, copied.text
    assert copied.json()["media"]["storage_url"] == media.storage_url
    assert copied.json()["media"]["id"] != str(media.id)

    missing = _file(owner, site["id"], _image(media_id=str(uuid.uuid4())))
    assert _code(missing) == "source_media_not_found"
    both = _file(owner, site["id"], _image(media_id=str(media.id), upload_id=str(uuid.uuid4())))
    assert both.status_code == 422


def test_only_the_owner_changes_the_contour_citing_an_image_of_the_site(users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lng=LNG + 0.9))
    other = _create_site(analyst, _square(0.01, lng=LNG - 0.9))
    filed = _file(analyst, site["id"], _image("2025-02-01")).json()

    refused = _contour(analyst, site["id"], _square(0.02, lng=LNG + 0.9), filed["id"])
    assert refused.status_code == 403
    assert _code(refused) == "not_site_owner"
    foreign = _contour(owner, site["id"], _square(0.02, lng=LNG + 0.9), other["images"][0]["id"])
    assert foreign.status_code == 400
    assert _code(foreign) == "site_image_not_found"
    invalid = _contour(
        owner,
        site["id"],
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
        filed["id"],
    )
    assert _code(invalid) == "invalid_zone"

    # The owner may draw from an image another analyst filed.
    drawn = _contour(owner, site["id"], _square(0.02, lng=LNG + 0.9), filed["id"])
    assert drawn.status_code == 201, drawn.text
    assert drawn.json()["image_id"] == filed["id"]
    assert drawn.json()["author"]["id"] == str(owner.id)
    assert drawn.json()["captured_at"] == "2025-02-01T10:00:00Z"
    assert _read(site["id"])["contour_id"] == drawn.json()["id"]


def test_the_zone_valid_on_a_date_is_the_contour_of_the_latest_image_on_or_before_it(users):
    owner = users()
    site = _create_site(owner, _square(0.01), captured="2025-01-01")
    grown = _grow(owner, site["id"], _square(0.05), "2025-06-01")
    # Drawn last from older imagery: it holds from its capture date, not from today.
    older = _grow(owner, site["id"], _square(0.02), "2024-06-01")

    assert _on_map(site["id"], "2024-05-31") is None
    early = _on_map(site["id"], "2024-07-01")
    before = _on_map(site["id"], "2025-03-01")
    after = _on_map(site["id"], "2025-07-01")
    assert early is not None and before is not None and after is not None
    assert early["contour_id"] == older["id"]
    assert early["last_image"]["captured_at"] == "2024-06-01T10:00:00Z"
    assert before["contour_id"] == site["contour_id"]
    assert before["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.01, LAT - 0.01])
    assert before["last_image"]["captured_at"] == "2025-01-01T10:00:00Z"
    assert after["contour_id"] == grown["id"]
    assert after["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.05, LAT - 0.05])
    assert _read(site["id"])["contour_id"] == grown["id"]

    # A box that only the grown zone reaches.
    edge = f"{LAT + 0.03},{LNG + 0.03},{LAT + 0.04},{LNG + 0.04}"
    assert _on_map(site["id"], "2025-03-01", edge) is None
    assert _on_map(site["id"], "2025-07-01", edge) is not None


def test_only_the_owner_edits_the_record_and_each_edit_is_versioned(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lat=LAT + 0.2), name="Depot North")
    path = f"{SITES}/{site['id']}"

    refused = client.patch(path, json={"name": "Mine"}, headers=login_as(client, analyst))
    assert refused.status_code == 403
    assert _code(refused) == "not_site_owner"
    assert client.patch(path, json={}, headers=login_as(client, owner)).status_code == 422

    edited = client.patch(
        path, json={"name": "  Depot South ", "kind": "depot"}, headers=login_as(client, owner)
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["name"], edited.json()["kind"]) == ("Depot South", "depot")
    same = client.patch(path, json={"name": "Depot South"}, headers=login_as(client, owner))
    assert same.status_code == 200

    db.expire_all()
    (version,) = db.query(SiteVersion).filter(SiteVersion.site_id == site["id"]).all()
    assert version.version_no == 1
    assert version.snapshot == {"name": "Depot North", "kind": "airbase"}
    assert version.edited_by_id == owner.id
    assert db.query(Site.version_no).filter(Site.id == site["id"]).scalar() == 2

    client.cookies.clear()
    history = client.get(f"{path}/history", params={"order": "recorded"}).json()
    created, *_, last = history
    assert created["kind"] == "site_created"
    assert created["record"] == {"name": "Depot North", "kind": "airbase"}
    assert last["kind"] == "record_edited"
    assert last["previous_record"] == {"name": "Depot North", "kind": "airbase"}
    assert last["record"] == {"name": "Depot South", "kind": "depot"}
    assert last["actor"]["id"] == str(owner.id)
    assert last["fact_date"] is None


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

    refused = _link(stranger, event, site["id"])
    assert refused.status_code == 403
    assert _code(refused) == "not_event_owner"
    first = _link(owner, event, site["id"], "activity")
    assert first.status_code == 200
    assert first.json()["site"] == {"id": site["id"], "name": "Site Alpha", "kind": "airbase"}
    assert first.json()["effect"] == "activity"
    assert _link(owner, event, site["id"], "activity").json() == first.json()
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
    assert body["corroboration_count"] == 1
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


def test_link_refuses_an_unpublished_event_or_an_unknown_site(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01))
    closed = _event(db, owner, status=STATUS_CLOSED)
    response = _link(owner, closed, site["id"])
    assert response.status_code == 409
    assert _code(response) == "event_not_linkable"

    published = _event(db, owner)
    response = _link(owner, published, str(uuid.uuid4()))
    assert response.status_code == 404
    assert _code(response) == "site_not_found"
    assert _link(owner, published, site["id"], "launch").status_code == 422


def test_a_closed_or_withheld_event_drops_out_of_the_site(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01))
    retracted = _event(db, analyst)
    withheld = _event(db, analyst)
    assert _link(analyst, retracted, site["id"]).status_code == 200
    assert _link(analyst, withheld, site["id"]).status_code == 200
    assert _read(site["id"])["corroboration_count"] == 2

    retracted.status = STATUS_CLOSED
    retracted.closed_at = datetime.now(UTC)
    retracted.before_closed_status = STATUS_GEOLOCATED
    withheld.hidden_at = datetime.now(UTC)
    db.commit()

    body = _read(site["id"])
    assert body["linked_events"] == []
    assert body["corroboration_count"] == 1
    assert body["is_corroborated"] is False
    assert body["latest_link_effect"] is None
    assert client.get(f"/api/v1/events/{withheld.id}/site-links").status_code == 404


def test_inside_zone_is_measured_against_the_zone_valid_on_the_occurred_date(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01), captured="2025-01-01")
    grown = _grow(owner, site["id"], _square(0.05), "2025-06-01")
    # 0.03 degrees east of the centre: outside the small zone, inside the grown one.
    early = _event(db, owner, lng=LNG + 0.03, occurred_date=date(2025, 3, 1))
    late = _event(db, owner, lng=LNG + 0.03, occurred_date=date(2025, 7, 1))
    before_all = _event(db, owner, occurred_date=date(2024, 6, 1))
    undated = _event(db, owner, lng=LNG + 0.03, occurred_date=None)
    for event in (early, late, before_all, undated):
        assert _link(owner, event, site["id"]).status_code == 200

    body = _read(site["id"])
    by_id = {row["id"]: row for row in body["linked_events"]}

    assert by_id[str(early.id)]["inside_zone"] is False
    assert by_id[str(early.id)]["distance_m"] == pytest.approx(_metres_east(0.02), rel=0.01)
    assert by_id[str(early.id)]["measured_contour_id"] == site["contour_id"]
    assert by_id[str(late.id)]["inside_zone"] is True
    assert by_id[str(late.id)]["distance_m"] is None
    assert by_id[str(late.id)]["measured_contour_id"] == grown["id"]
    # Older than every contour: measured against the earliest. Undated: the current one.
    assert by_id[str(before_all.id)]["measured_contour_id"] == site["contour_id"]
    assert by_id[str(undated.id)]["measured_contour_id"] == grown["id"]
    assert [row["id"] for row in body["linked_events"]] == [
        str(before_all.id),
        str(early.id),
        str(late.id),
        str(undated.id),
    ]


def test_corroboration_counts_distinct_analysts_who_link_or_file(db, users):
    owner, linker, filer = users(), users(), users()
    lng = LNG + 0.6
    site = _create_site(owner, _square(0.01, lng=lng), captured="2025-01-01")

    _link(owner, _event(db, owner, lng=lng, occurred_date=date(2025, 2, 1)), site["id"])
    body = _read(site["id"])
    assert (body["corroboration_count"], body["is_corroborated"]) == (1, False)

    linked = _event(db, linker, lng=lng, occurred_date=date(2025, 4, 1))
    _link(linker, linked, site["id"], "destruction")
    assert _file(filer, site["id"], _image("2025-08-01")).status_code == 201
    body = _read(site["id"])
    assert (body["corroboration_count"], body["is_corroborated"]) == (3, True)
    assert body["latest_link_effect"] == {
        "effect": "destruction",
        "occurred_date": "2025-04-01",
        "event_id": str(linked.id),
    }

    # The map reads both legs at its date.
    assert _on_map(site["id"], "2025-03-01")["corroboration_count"] == 1
    assert _on_map(site["id"], "2025-05-01")["corroboration_count"] == 2
    assert _on_map(site["id"], "2025-09-01")["corroboration_count"] == 3


def test_map_read_carries_the_owner_and_the_latest_link_effect_on_as_of(db, users):
    owner, analyst = users(), users()
    lng = LNG + 0.45
    site = _create_site(owner, _square(0.01, lng=lng), captured="2025-01-01")

    row = _on_map(site["id"], "2025-12-31")
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

    assert _on_map(site["id"], "2025-12-31")["latest_link_effect"] == {
        "effect": "destruction",
        "occurred_date": "2025-09-01",
        "event_id": str(later.id),
    }
    assert _on_map(site["id"], "2025-06-01")["latest_link_effect"]["event_id"] == str(damage.id)
    assert _on_map(site["id"], "2025-02-01")["latest_link_effect"] is None


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
    assert by_name[0]["kind"] == "airbase"
    assert by_name[0]["distance_m"] > 40_000


def test_a_reported_site_is_withheld_from_every_public_read_and_restored(db, users):
    owner, admin = users(), users(is_admin=True)
    lat = LAT + 0.55
    site = _create_site(owner, _square(0.01, lat=lat), name=f"Radar {uuid.uuid4().hex[:6]}")
    event = _event(db, owner, lat=lat)
    assert _link(owner, event, site["id"]).status_code == 200

    client.cookies.clear()
    report = client.post(
        f"{SITES}/{site['id']}/report", json={"reason": "other", "details": "Fake"}
    )
    assert report.status_code == 201, report.text
    assert report.json()["site"]["name"] == site["name"]
    assert report.json()["event_id"] is None

    queue = client.get("/api/v1/admin/reports", headers=login_as(client, admin)).json()["items"]
    (queued,) = [row for row in queue if row["id"] == report.json()["id"]]
    assert queued["site"]["owner"]["id"] == str(owner.id)
    resolve = f"/api/v1/admin/reports/{report.json()['id']}/resolve"
    graphic = client.post(
        resolve, json={"resolution": "marked_graphic"}, headers=login_as(client, admin)
    )
    assert graphic.status_code == 409
    assert _code(graphic) == "report_verdict_not_applicable"
    hidden = client.post(resolve, json={"resolution": "hidden"}, headers=login_as(client, admin))
    assert hidden.status_code == 200, hidden.text

    client.cookies.clear()
    assert client.get(f"{SITES}/{site['id']}").status_code == 404
    assert client.get(f"{SITES}/{site['id']}/history").status_code == 404
    assert _on_map(site["id"], "2025-12-31") is None
    assert client.get(f"/api/v1/events/{event.id}/site-links").json() == []
    assert client.post(f"{SITES}/{site['id']}/report", json={"reason": "other"}).status_code == 404
    headers = login_as(client, owner)
    suggestions = client.get(
        f"/api/v1/events/{event.id}/site-suggestions", params={"q": site["name"]}, headers=headers
    ).json()
    assert suggestions == []
    assert _file(owner, site["id"], _image()).status_code == 404
    assert _code(_link(owner, _event(db, owner, lat=lat), site["id"])) == "site_not_found"

    as_admin = client.get(f"{SITES}/{site['id']}", headers=login_as(client, admin))
    assert as_admin.status_code == 200
    assert as_admin.json()["hidden_at"] is not None

    moderation = f"/api/v1/admin/sites/{site['id']}/moderation"
    restored = client.patch(moderation, json={"hidden": False}, headers=login_as(client, admin))
    assert restored.status_code == 200, restored.text
    assert restored.json() == {"site_id": site["id"], "name": site["name"], "hidden_at": None}
    assert _read(site["id"])["hidden_at"] is None
    assert (
        client.patch(moderation, json={"hidden": True}, headers=login_as(client, owner)).status_code
        == 403
    )
    unknown = client.patch(
        f"/api/v1/admin/sites/{uuid.uuid4()}/moderation",
        json={"hidden": True},
        headers=login_as(client, admin),
    )
    assert _code(unknown) == "site_not_found"


def test_history_orders_by_either_clock(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01), captured="2025-05-01")
    old_imagery = _file(analyst, site["id"], _image("2024-01-01"))
    assert old_imagery.status_code == 201
    contour = _contour(owner, site["id"], _square(0.02), old_imagery.json()["id"])
    assert contour.status_code == 201
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
        ("image_filed", "2025-05-01"),
        ("image_filed", "2024-01-01"),
        ("contour_changed", "2024-01-01"),
        ("event_linked", "2024-06-01"),
        ("event_unlinked", "2024-06-01"),
    ]
    # Record-only entries sit on the day they were recorded.
    assert history("fact") == [
        ("image_filed", "2024-01-01"),
        ("contour_changed", "2024-01-01"),
        ("event_linked", "2024-06-01"),
        ("event_unlinked", "2024-06-01"),
        ("image_filed", "2025-05-01"),
        ("site_created", None),
    ]
    entries = client.get(f"{SITES}/{site['id']}/history").json()
    created = next(entry for entry in entries if entry["kind"] == "site_created")
    assert created["contour_id"] == site["contour_id"]
    assert created["image_id"] == site["images"][0]["id"]
    filed = next(entry for entry in entries if entry["fact_date"] == "2024-01-01")
    assert filed["actor"]["id"] == str(analyst.id)
    assert client.get(f"{SITES}/{site['id']}/history", params={"order": "x"}).status_code == 422


def test_erasing_the_owner_takes_the_site_and_sweeps_its_image_files(db, users, monkeypatch):
    owner, admin = users(), users(is_admin=True)
    site = _create_site(owner, _square(0.01, lat=LAT - 0.55), upload_id=stage_file(owner))
    stored = site["images"][0]["media"]["storage_url"]
    swept: list = []
    monkeypatch.setattr(
        "app.services.admin.sweep_unreferenced",
        lambda _db, objects, *, context: swept.extend(objects),
    )

    response = client.delete(
        f"/api/v1/admin/users/{owner.id}?hard=true", headers=login_as(client, admin)
    )
    assert response.status_code == 200, response.text
    assert stored in {obj.storage_url for obj in swept}
    db.expire_all()
    assert db.query(Site).filter(Site.id == site["id"]).count() == 0
    assert db.query(Source).filter(Source.site_id == site["id"]).count() == 0
