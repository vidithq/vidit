"""Sites: create with the first source, contour and linked events, the site sources (any
analyst files, the provider check refuses a source no reader can reopen, a repeat is flagged),
the owner's versioned edit, source removal by its filer, the versions, the zone valid on a date,
event links, suggestions and moderation."""

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
from app.models.site import EventSiteLink, Site, SiteContour, SiteVersion
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


def _source(captured: str = "2025-01-01", url: str = COPERNICUS, **extra) -> dict:
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


def _post_site(user: User, zone: dict, *, name: str = "Site Alpha", **source) -> object:
    return client.post(
        SITES,
        json={"name": name, "kind": "airbase", "contour": zone, "source": _source(**source)},
        headers=login_as(client, user),
    )


def _create_site(user: User, zone: dict, *, name: str = "Site Alpha", **source) -> dict:
    response = _post_site(user, zone, name=name, **source)
    assert response.status_code == 201, response.text
    return response.json()


def _file(user: User, site_id: str, body: dict):
    return client.post(f"{SITES}/{site_id}/sources", json=body, headers=login_as(client, user))


def _save(user: User, site_id: str, **changes):
    """``POST /sites/{id}/versions`` on the live version, the record unchanged unless given."""
    live = _read(site_id)
    body = {"version_no": live["version_no"], "name": live["name"], "kind": live["kind"], **changes}
    return client.post(f"{SITES}/{site_id}/versions", json=body, headers=login_as(client, user))


def _contour(user: User, site_id: str, zone: dict | None, source_id: str):
    return _save(user, site_id, contours=[{"source_id": source_id, "zone": zone}])


def _drawn(response, source_id: str) -> dict:
    """The live contour the saved site carries on ``source_id``."""
    assert response.status_code == 200, response.text
    (contour,) = [c for c in response.json()["contours"] if c["source_id"] == source_id]
    return contour


def _grow(owner: User, site_id: str, zone: dict, captured: str) -> dict:
    """File a source captured on ``captured`` and draw ``zone`` from it."""
    filed = _file(owner, site_id, _source(captured))
    assert filed.status_code == 201, filed.text
    return _drawn(_contour(owner, site_id, zone, filed.json()["id"]), filed.json()["id"])


def _versions(site_id: str) -> list[dict]:
    client.cookies.clear()
    response = client.get(f"{SITES}/{site_id}/versions")
    assert response.status_code == 200, response.text
    return response.json()["items"]


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


def test_create_site_with_its_first_source_and_contour(users):
    owner = users()
    body = _create_site(owner, _square(0.01), note="  Runway visible.  ", title="Pass 1")

    assert (body["name"], body["kind"]) == ("Site Alpha", "airbase")
    assert body["owner"]["id"] == str(owner.id)
    assert body["version_no"] == 1
    assert body["hidden_at"] is None
    assert body["overlapping_sites"] == []
    assert body["centroid"] == pytest.approx({"lat": LAT, "lng": LNG})
    (source,) = body["sources"]
    assert (source["kind"], source["level"], source["title"]) == ("satellite", "context", "Pass 1")
    assert source["author"]["id"] == str(owner.id)
    assert source["note"] == "Runway visible."
    assert source["provider"]["id"] == "copernicus_browser"
    assert source["warnings"] == []
    assert source["links"][0]["url"] == COPERNICUS
    (contour,) = body["contours"]
    assert contour["source_id"] == source["id"]
    assert contour["id"] == body["contour_id"]
    assert contour["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.01, LAT - 0.01])
    assert body["last_source"] == {
        "id": source["id"],
        "captured_at": "2025-01-01T10:00:00Z",
        "provider": {"id": "copernicus_browser", "name": "Copernicus Browser"},
    }
    assert body["latest_link_effect"] is None


def test_a_zone_over_the_size_caps_is_refused_wherever_a_contour_is_accepted(users):
    owner = users()
    # Half a side of 0.5 degrees is about 12,000 km2; 0.44 is about 9,400 km2.
    too_large = _square(0.5, lng=LNG + 0.9)
    too_wide = {
        "type": "Polygon",
        "coordinates": [[[-90, LAT], [90, LAT], [90, LAT + 0.001], [-90, LAT + 0.001], [-90, LAT]]],
    }
    just_under = _square(0.44, lng=LNG + 0.9)

    site = _create_site(owner, _square(0.01, lng=LNG + 0.9))
    source_id = site["sources"][0]["id"]
    headers = login_as(client, owner)
    for zone, code in ((too_large, "zone_too_large"), (too_wide, "zone_too_wide")):
        assert _code(_post_site(owner, zone)) == code
        contour = _contour(owner, site["id"], zone, source_id)
        assert contour.status_code == 400
        assert _code(contour) == code
        overlaps = client.post(f"{SITES}/overlaps", json={"zone": zone}, headers=headers)
        assert overlaps.status_code == 400
        assert _code(overlaps) == code

    assert _contour(owner, site["id"], just_under, source_id).status_code == 200
    assert _post_site(owner, just_under, name="Wide yard").status_code == 201


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
        ({"source": _source("2999-01-01")}, 422, None),
        (
            {"source": {"captured_at": "2025-01-01T00:00:00Z", "links": []}},
            400,
            "source_link_required",
        ),
        ({"source": _source(url=GOOGLE_MAPS)}, 400, "imagery_not_reopenable"),
        (
            {"source": _source(url="https://imagery.example/pass.png")},
            400,
            "imagery_not_reopenable",
        ),
        ({"source": _source(url="https://goo.gl/abc")}, 400, "imagery_not_reopenable"),
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
def test_create_refuses_an_invalid_site_or_a_source_no_reader_can_reopen(
    db, users, change, status, code
):
    owner = users()
    body = {"name": "Bad", "kind": "depot", "contour": _square(0.01), "source": _source(), **change}
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
            "source": {
                "captured_at": "2025-01-01T00:00:00Z",
                "links": [{"url": url, "snapshot_url": snapshot}],
            },
        },
        headers=login_as(client, owner),
    )
    assert response.status_code == 201, response.text
    (source,) = response.json()["sources"]
    assert source["provider"] is None
    assert source["links"][0]["archived"]["provider"] == "wayback"
    assert response.json()["last_source"]["provider"] is None


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


def test_any_analyst_files_a_source_and_a_repeat_is_flagged(users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lng=LNG - 0.6), captured="2025-01-01")

    repeat = _file(analyst, site["id"], _source("2025-01-01", note="Same pass, closer crop"))
    assert repeat.status_code == 201, repeat.text
    body = repeat.json()
    assert body["author"]["id"] == str(analyst.id)
    assert body["duplicate_source_ids"] == [site["sources"][0]["id"]]

    other_provider = _file(analyst, site["id"], _source("2025-01-01", url=WAYBACK))
    assert other_provider.json()["duplicate_source_ids"] == []
    other_day = _file(analyst, site["id"], _source("2025-01-02"))
    assert other_day.json()["duplicate_source_ids"] == []

    read = _read(site["id"])
    assert len(read["sources"]) == 4
    # Sources never move the contour.
    assert [c["id"] for c in read["contours"]] == [site["contour_id"]]

    unknown = _file(analyst, str(uuid.uuid4()), _source())
    assert unknown.status_code == 404
    assert _code(unknown) == "site_not_found"
    refused = _file(analyst, site["id"], _source(url=GOOGLE_MAPS))
    assert _code(refused) == "imagery_not_reopenable"


def test_a_source_takes_a_staged_upload_or_the_file_of_a_published_event(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01, lat=LAT - 0.7))
    upload_id = stage_file(owner)
    staged = _file(owner, site["id"], _source(upload_id=upload_id))
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
    copied = _file(owner, site["id"], _source(media_id=str(media.id)))
    assert copied.status_code == 201, copied.text
    assert copied.json()["media"]["storage_url"] == media.storage_url
    assert copied.json()["media"]["id"] != str(media.id)

    missing = _file(owner, site["id"], _source(media_id=str(uuid.uuid4())))
    assert _code(missing) == "source_media_not_found"
    both = _file(owner, site["id"], _source(media_id=str(media.id), upload_id=str(uuid.uuid4())))
    assert both.status_code == 422


def test_only_the_owner_redraws_a_contour_on_a_live_source_of_the_site(users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lng=LNG + 0.9))
    other = _create_site(analyst, _square(0.01, lng=LNG - 0.9))
    filed = _file(analyst, site["id"], _source("2025-02-01")).json()

    refused = _contour(analyst, site["id"], _square(0.02, lng=LNG + 0.9), filed["id"])
    assert refused.status_code == 403
    assert _code(refused) == "not_site_owner"
    foreign = _contour(owner, site["id"], _square(0.02, lng=LNG + 0.9), other["sources"][0]["id"])
    assert foreign.status_code == 404
    assert _code(foreign) == "site_source_not_found"
    invalid = _contour(
        owner,
        site["id"],
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
        filed["id"],
    )
    assert _code(invalid) == "invalid_zone"

    # The owner may draw on a source another analyst filed.
    drawn = _drawn(
        _contour(owner, site["id"], _square(0.02, lng=LNG + 0.9), filed["id"]), filed["id"]
    )
    assert drawn["author"]["id"] == str(owner.id)
    assert drawn["captured_at"] == "2025-02-01T10:00:00Z"
    assert _read(site["id"])["contour_id"] == drawn["id"]

    # A redraw on the same source replaces its contour; the earlier one leaves the live state.
    redrawn = _drawn(
        _contour(owner, site["id"], _square(0.03, lng=LNG + 0.9), filed["id"]), filed["id"]
    )
    assert redrawn["id"] != drawn["id"]
    assert len(_read(site["id"])["contours"]) == 2


def test_the_zone_valid_on_a_date_is_the_contour_of_the_latest_source_on_or_before_it(users):
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
    assert early["last_source"]["captured_at"] == "2024-06-01T10:00:00Z"
    assert before["contour_id"] == site["contour_id"]
    assert before["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.01, LAT - 0.01])
    assert before["last_source"]["captured_at"] == "2025-01-01T10:00:00Z"
    assert after["contour_id"] == grown["id"]
    assert after["zone"]["coordinates"][0][0] == pytest.approx([LNG - 0.05, LAT - 0.05])
    assert _read(site["id"])["contour_id"] == grown["id"]

    # A box that only the grown zone reaches.
    edge = f"{LAT + 0.03},{LNG + 0.03},{LAT + 0.04},{LNG + 0.04}"
    assert _on_map(site["id"], "2025-03-01", edge) is None
    assert _on_map(site["id"], "2025-07-01", edge) is not None


def test_the_owner_saves_one_version_and_the_version_is_read_in_full(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lat=LAT + 0.2), name="Depot North")
    path = f"{SITES}/{site['id']}/versions"
    first_source = site["sources"][0]["id"]

    refused = _save(analyst, site["id"], name="Mine")
    assert refused.status_code == 403
    assert _code(refused) == "not_site_owner"
    unchanged = _save(owner, site["id"])
    assert unchanged.status_code == 409
    assert _code(unchanged) == "nothing_changed"
    stale = client.post(
        path,
        json={"version_no": 7, "name": "Depot South", "kind": "depot"},
        headers=login_as(client, owner),
    )
    assert stale.status_code == 409
    assert _code(stale) == "version_mismatch"
    assert _save(owner, site["id"], contours=[{"zone": None}]).status_code == 422

    # One save: the record, a new source and a contour drawn on it.
    saved = _save(
        owner,
        site["id"],
        name="  Depot South ",
        kind="depot",
        added_sources=[_source("2025-06-01", note="After the fire")],
        contours=[{"added_source": 0, "zone": _square(0.02, lat=LAT + 0.2)}],
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (body["name"], body["kind"], body["version_no"]) == ("Depot South", "depot", 2)
    added = next(source for source in body["sources"] if source["id"] != first_source)
    assert added["note"] == "After the fire"
    assert added["author"]["id"] == str(owner.id)
    assert body["contour_id"] == _drawn(saved, added["id"])["id"]
    assert len(body["contours"]) == 2

    db.expire_all()
    (version,) = db.query(SiteVersion).filter(SiteVersion.site_id == site["id"]).all()
    assert version.version_no == 1
    assert version.edited_by_id == owner.id
    assert version.snapshot == {
        "name": "Depot North",
        "kind": "airbase",
        "sources": [{"id": first_source, "contour_id": site["contour_id"]}],
    }

    (v1,) = _versions(site["id"])
    assert (v1["version_no"], v1["name"], v1["kind"]) == (1, "Depot North", "airbase")
    assert v1["edited_by"]["id"] == str(owner.id)
    assert [source["id"] for source in v1["sources"]] == [first_source]
    assert [contour["id"] for contour in v1["contours"]] == [site["contour_id"]]
    assert v1["contour_id"] == site["contour_id"]
    assert v1["centroid"] == pytest.approx({"lat": LAT + 0.2, "lng": LNG})
    assert v1["last_source"]["id"] == first_source
    one = client.get(f"{path}/1")
    assert one.status_code == 200
    assert one.json() == v1
    for missing in (2, 0, 99):
        response = client.get(f"{path}/{missing}")
        assert response.status_code == 404
        assert _code(response) == "site_version_not_found"


def test_every_write_to_the_state_files_a_version_and_a_link_files_none(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lng=LNG - 0.2))
    filed = _file(analyst, site["id"], _source("2025-03-01"))
    assert filed.status_code == 201
    _contour(owner, site["id"], _square(0.02, lng=LNG - 0.2), filed.json()["id"])
    assert _link(owner, _event(db, owner, lng=LNG - 0.2), site["id"]).status_code == 200

    assert _read(site["id"])["version_no"] == 3
    v2, v1 = _versions(site["id"])
    assert (v2["version_no"], v2["edited_by"]["id"]) == (2, str(owner.id))
    assert (v1["version_no"], v1["edited_by"]["id"]) == (1, str(analyst.id))
    assert len(v1["sources"]) == 1
    assert len(v2["sources"]) == 2
    assert len(v2["contours"]) == 1

    db.query(Site).filter(Site.id == site["id"]).update({"version_no": 100})
    db.commit()
    capped = _file(analyst, site["id"], _source("2025-04-01"))
    assert capped.status_code == 409
    assert _code(capped) == "version_limit"


def test_only_the_filer_removes_a_source_once_it_carries_no_contour(db, users):
    owner, analyst = users(), users()
    site = _create_site(owner, _square(0.01, lat=LAT - 0.3))
    first = site["sources"][0]["id"]
    theirs = _file(analyst, site["id"], _source("2025-02-01")).json()["id"]
    mine = _file(owner, site["id"], _source("2025-03-01")).json()["id"]

    def remove(user: User, source_id: str):
        return client.delete(
            f"{SITES}/{site['id']}/sources/{source_id}", headers=login_as(client, user)
        )

    refused = remove(owner, theirs)
    assert refused.status_code == 403
    assert _code(refused) == "not_source_author"
    carries = remove(owner, first)
    assert carries.status_code == 409
    assert _code(carries) == "source_carries_contour"
    assert _code(remove(owner, str(uuid.uuid4()))) == "site_source_not_found"
    assert remove(analyst, theirs).status_code == 204
    assert _code(remove(analyst, theirs)) == "site_source_not_found"

    live = _read(site["id"])
    assert theirs not in {source["id"] for source in live["sources"]}
    removed_in = next(v for v in _versions(site["id"]) if v["version_no"] == live["version_no"] - 1)
    assert theirs in {source["id"] for source in removed_in["sources"]}
    db.expire_all()
    assert db.query(Source).filter(Source.id == theirs).one().removed_at is not None

    # The owner moves the contour off the first source and removes it in one save.
    dropped = _save(owner, site["id"], contours=[{"source_id": first, "zone": None}])
    assert _code(dropped) == "site_contour_required"
    kept = _save(owner, site["id"], removed_source_ids=[first])
    assert _code(kept) == "source_carries_contour"
    moved = _save(
        owner,
        site["id"],
        removed_source_ids=[first],
        contours=[
            {"source_id": first, "zone": None},
            {"source_id": mine, "zone": _square(0.01, lat=LAT - 0.3)},
        ],
    )
    assert moved.status_code == 200, moved.text
    assert [source["id"] for source in moved.json()["sources"]] == [mine]
    assert [contour["source_id"] for contour in moved.json()["contours"]] == [mine]
    db.expire_all()
    superseded = db.query(SiteContour).filter(SiteContour.id == site["contour_id"]).one()
    assert superseded.superseded_at is not None
    v1 = client.get(f"{SITES}/{site['id']}/versions/1").json()
    assert [contour["id"] for contour in v1["contours"]] == [site["contour_id"]]


def _link_rows(db, event: Event) -> list[EventSiteLink]:
    db.expire_all()
    return (
        db.query(EventSiteLink)
        .filter(EventSiteLink.event_id == event.id)
        .order_by(EventSiteLink.linked_at)
        .all()
    )


def test_the_owner_links_their_events_on_create_and_on_save(db, users):
    owner, stranger = users(), users()
    lat = LAT + 0.35
    mine, other = _event(db, owner, lat=lat), _event(db, owner, lat=lat)
    theirs = _event(db, stranger, lat=lat)
    body = {
        "name": "Linked",
        "kind": "port",
        "contour": _square(0.01, lat=lat),
        "source": _source(),
    }
    headers = login_as(client, owner)

    foreign = client.post(
        SITES,
        json={**body, "event_links": [{"event_id": str(theirs.id), "effect": "damage"}]},
        headers=headers,
    )
    assert _code(foreign) == "not_event_owner"
    created = client.post(
        SITES,
        json={**body, "event_links": [{"event_id": str(mine.id), "effect": "damage"}]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    site = created.json()
    assert [(e["id"], e["effect"]) for e in site["linked_events"]] == [(str(mine.id), "damage")]
    assert _link(stranger, theirs, site["id"], "activity").status_code == 200

    saved = _save(
        owner,
        site["id"],
        event_links=[{"event_id": str(other.id), "effect": "destruction"}],
    )
    assert saved.status_code == 200, saved.text
    # Links file no version, and the stranger's link stays.
    assert saved.json()["version_no"] == 1
    assert {(e["id"], e["effect"]) for e in saved.json()["linked_events"]} == {
        (str(other.id), "destruction"),
        (str(theirs.id), "activity"),
    }
    assert _code(
        _save(owner, site["id"], event_links=[{"event_id": str(other.id), "effect": "destruction"}])
    ) == ("nothing_changed")


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

    assert _link_rows(db, event) == []
    body = _read(site["id"])
    assert body["linked_events"] == []
    assert body["latest_link_effect"] is None


def test_an_effect_change_rewrites_the_link(db, users):
    owner = users()
    site = _create_site(owner, _square(0.01))
    event = _event(db, owner)
    first = _link(owner, event, site["id"], "damage").json()
    changed = _link(owner, event, site["id"], "destruction")
    assert changed.json()["effect"] == "destruction"
    assert changed.json()["linked_at"] == first["linked_at"]

    (row,) = _link_rows(db, event)
    assert row.effect == "destruction"
    assert _read(site["id"])["version_no"] == 1


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
    assert len(_read(site["id"])["linked_events"]) == 2

    retracted.status = STATUS_CLOSED
    retracted.closed_at = datetime.now(UTC)
    retracted.before_closed_status = STATUS_GEOLOCATED
    withheld.hidden_at = datetime.now(UTC)
    db.commit()

    body = _read(site["id"])
    assert body["linked_events"] == []
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
    assert (by_id[str(early.id)]["media"], by_id[str(early.id)]["is_graphic"]) == (None, False)
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


def test_the_latest_link_effect_is_the_latest_dated_linked_event(db, users):
    owner, linker = users(), users()
    lng = LNG + 0.6
    site = _create_site(owner, _square(0.01, lng=lng), captured="2025-01-01")

    _link(owner, _event(db, owner, lng=lng, occurred_date=date(2025, 2, 1)), site["id"])
    linked = _event(db, linker, lng=lng, occurred_date=date(2025, 4, 1))
    _link(linker, linked, site["id"], "destruction")
    assert _read(site["id"])["latest_link_effect"] == {
        "effect": "destruction",
        "occurred_date": "2025-04-01",
        "event_id": str(linked.id),
    }


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


def test_site_suggestions_near_a_point_by_distance_and_by_name(users):
    owner = users()
    lat = LAT - 0.45
    site = _create_site(owner, _square(0.01, lat=lat), name=f"Depot {uuid.uuid4().hex[:6]}")
    headers = login_as(client, owner)
    path = f"{SITES}/suggestions"

    near = client.get(path, params={"lat": lat, "lng": LNG + 0.015}, headers=headers)
    assert near.status_code == 200, near.text
    assert site["id"] in {row["id"] for row in near.json()}
    far = {"lat": lat, "lng": LNG + 0.5}
    assert site["id"] not in {
        row["id"] for row in client.get(path, params=far, headers=headers).json()
    }
    by_name = client.get(path, params={**far, "q": site["name"][-6:]}, headers=headers).json()
    assert [row["id"] for row in by_name] == [site["id"]]
    assert by_name[0]["distance_m"] > 40_000
    no_point = client.get(path, params={"q": site["name"][-6:]}, headers=headers).json()
    assert [(row["id"], row["distance_m"]) for row in no_point] == [(site["id"], None)]
    assert client.get(path, headers=headers).json() == []

    lone = client.get(path, params={"lat": lat}, headers=headers)
    assert lone.status_code == 400
    assert _code(lone) == "invalid_coordinates"
    assert _code(client.get(path, params={"lat": 91, "lng": 0}, headers=headers)) == (
        "invalid_coordinates"
    )
    client.cookies.clear()
    assert client.get(path, params={"q": "Depot"}).status_code == 401


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
    assert client.get(f"{SITES}/{site['id']}/versions").status_code == 404
    assert _on_map(site["id"], "2025-12-31") is None
    assert client.get(f"/api/v1/events/{event.id}/site-links").json() == []
    assert client.post(f"{SITES}/{site['id']}/report", json={"reason": "other"}).status_code == 404
    headers = login_as(client, owner)
    suggestions = client.get(
        f"/api/v1/events/{event.id}/site-suggestions", params={"q": site["name"]}, headers=headers
    ).json()
    assert suggestions == []
    assert _file(owner, site["id"], _source()).status_code == 404
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


def test_erasing_the_owner_takes_the_site_and_sweeps_its_source_files(db, users, monkeypatch):
    owner, admin = users(), users(is_admin=True)
    site = _create_site(owner, _square(0.01, lat=LAT - 0.55), upload_id=stage_file(owner))
    stored = site["sources"][0]["media"]["storage_url"]
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
