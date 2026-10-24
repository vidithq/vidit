"""Batch completion ``POST /events/batch-complete``.

Same evidence floor as the single-row geolocate, with the conflicts and each row's sensor
supplied by the call. One transaction per row: a mixed selection publishes what clears it
and leaves the rest untouched, each with a reason.
"""

from __future__ import annotations

import uuid

from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event, EventGeolocator
from app.models.media import Media
from app.models.source import Source, SourceLink
from tests._fixtures import fake_sha256
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client
from tests.events._readiness_cases import PROOF_TEXT_ONLY, PROOF_WITH_IMAGE

_URL = "/api/v1/events/batch-complete"


def _detection(db, author, *, proof: str | None = None, **kwargs) -> Event:
    """A machine detection as the import leaves it: no sensor, no conflict."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url=kwargs.pop("source_url", "https://x.com/a/status/1"),
        with_media=kwargs.pop("with_media", True),
        sensor=kwargs.pop("sensor", None),
        **kwargs,
    )
    geo.proof = PROOF_WITH_IMAGE if proof is None else proof
    db.commit()
    db.refresh(geo)
    return geo


def _body(conflict, rows: list[tuple[Event, str]]) -> dict:
    return {
        "conflict_ids": [str(conflict.id)],
        "rows": [{"event_id": str(geo.id), "sensor": sensor} for geo, sensor in rows],
    }


def _by_id(payload: dict) -> dict[str, dict]:
    return {row["event_id"]: row for row in payload["rows"]}


def test_batch_complete_requires_authentication(db, author, conflict):
    detection = _detection(db, author)
    response = client.post(_URL, json=_body(conflict, [(detection, "drone")]))
    assert response.status_code == 401


def test_batch_complete_publishes_a_ready_detection(db, author, conflict, free_tag):
    """The whole promotion: state, stamp, conflict, sensor, geolocator credit; tags stay."""
    detection = _detection(db, author, tags=[free_tag])

    response = client.post(
        _URL, headers=login_as(client, author), json=_body(conflict, [(detection, "drone")])
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "published": 1,
        "failed": 0,
        "rows": [
            {"event_id": str(detection.id), "published": True, "code": None, "message": None},
        ],
    }

    db.expire_all()
    row = db.query(Event).filter(Event.id == detection.id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.geolocated_at is not None
    assert [c.id for c in row.conflicts] == [conflict.id]
    assert {t.id for t in row.tags} == {free_tag.id}
    assert [s.sensor for s in row.sources] == ["drone"]
    credit = (
        db.query(EventGeolocator)
        .filter(EventGeolocator.event_id == detection.id, EventGeolocator.user_id == author.id)
        .first()
    )
    assert credit is not None


def test_batch_complete_sets_the_sensor_of_every_source_with_a_file(db, author, conflict):
    """The row's sensor replaces whatever the import guessed on each filed source; a
    source without a file keeps its own."""
    detection = _detection(
        db, author, sensor="smartphone", secondary_source_urls=["https://t.me/c/2"]
    )
    second = Source(
        level="indirect",
        sensor="unknown",
        links=[SourceLink(url="https://sat.example/after")],
        media=Media(sha256=fake_sha256(), storage_url="s3://x/n.jpg", kind="image"),
    )
    detection.sources.append(second)
    db.commit()

    response = client.post(
        _URL, headers=login_as(client, author), json=_body(conflict, [(detection, "satellite")])
    )
    assert response.status_code == 200, response.text
    assert response.json()["published"] == 1

    db.expire_all()
    row = db.query(Event).filter(Event.id == detection.id).one()
    sensors = {(s.level, s.media is not None): s.sensor for s in row.sources}
    assert sensors == {
        ("direct", True): "satellite",
        ("direct", False): "unknown",
        ("indirect", True): "satellite",
    }


def test_batch_complete_publishes_what_clears_the_floor(db, author, conflict):
    """A mixed selection: ready rows publish, the one missing proof stays a detection."""
    ready_one = _detection(db, author)
    ready_two = _detection(db, author)
    imageless = _detection(db, author, proof=PROOF_TEXT_ONLY)

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(ready_one, "drone"), (imageless, "drone"), (ready_two, "drone")]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["published"], body["failed"]) == (2, 1)
    # The verdicts come back in the order they were submitted.
    assert [row["event_id"] for row in body["rows"]] == [
        str(ready_one.id),
        str(imageless.id),
        str(ready_two.id),
    ]
    failed = _by_id(body)[str(imageless.id)]
    assert failed["published"] is False
    assert failed["code"] == "proof_image_required"
    assert "proof image" in failed["message"]

    db.expire_all()
    statuses = {
        str(row.id): row.status
        for row in db.query(Event)
        .filter(Event.id.in_([ready_one.id, ready_two.id, imageless.id]))
        .all()
    }
    assert statuses[str(ready_one.id)] == STATUS_GEOLOCATED
    assert statuses[str(ready_two.id)] == STATUS_GEOLOCATED
    # The failed row is untouched: still a detection, no conflict, no sensor.
    assert statuses[str(imageless.id)] == STATUS_DETECTED
    untouched = db.query(Event).filter(Event.id == imageless.id).one()
    assert untouched.conflicts == []
    assert [s.sensor for s in untouched.sources] == [None]


def test_batch_complete_reports_each_floor_miss_against_its_row(db, author, conflict):
    """One code per way a detection can miss the floor, each landing on its own row
    while the rest of the selection is unaffected."""
    no_file = _detection(db, author, with_media=False)
    no_source = _detection(db, author, source_url=None, with_media=False)
    no_url = _detection(db, author, source_url=None)
    context_only = _detection(db, author)
    context_only.sources[0].level = "context"
    db.commit()
    already_published = _make_geo(db, author=author)
    gone = uuid.uuid4()

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json={
            "conflict_ids": [str(conflict.id)],
            "rows": [
                {"event_id": str(event_id), "sensor": "drone"}
                for event_id in (
                    no_file.id,
                    no_source.id,
                    no_url.id,
                    context_only.id,
                    already_published.id,
                    gone,
                )
            ],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["published"], body["failed"]) == (0, 6)
    codes = {event_id: row["code"] for event_id, row in _by_id(body).items()}
    assert codes == {
        str(no_file.id): "source_file_required",
        str(no_source.id): "source_required",
        str(no_url.id): "source_link_required",
        str(context_only.id): "source_required",
        str(already_published.id): "invalid_state",
        str(gone): "event_not_found",
    }


def test_batch_complete_reports_a_pointless_detection_as_coordinates_required(db, author, conflict):
    """An unplaced detection fails with the ``*_required`` code, not a malformed-input one."""
    pointless = _detection(db, author)
    pointless.coords = None
    db.commit()

    response = client.post(
        _URL, headers=login_as(client, author), json=_body(conflict, [(pointless, "drone")])
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["published"], body["failed"]) == (0, 1)
    assert body["rows"][0]["code"] == "coordinates_required"

    db.expire_all()
    assert db.query(Event).filter(Event.id == pointless.id).one().status == STATUS_DETECTED


def test_batch_complete_rejects_a_detection_listed_twice(db, author, conflict):
    """A detection listed twice is rejected by shape, not reported as a state error."""
    detection = _detection(db, author)

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(detection, "drone"), (detection, "drone")]),
    )
    assert response.status_code == 422

    db.expire_all()
    assert db.query(Event).filter(Event.id == detection.id).one().status == STATUS_DETECTED


def test_batch_complete_rejects_a_row_without_a_known_sensor(db, author, conflict):
    """The sensor is a closed list, so an unknown or missing one fails the shape."""
    detection = _detection(db, author)
    headers = login_as(client, author)
    for row in (
        {"event_id": str(detection.id), "sensor": "periscope"},
        {"event_id": str(detection.id)},
    ):
        response = client.post(
            _URL, headers=headers, json={"conflict_ids": [str(conflict.id)], "rows": [row]}
        )
        assert response.status_code == 422

    db.expire_all()
    assert db.query(Event).filter(Event.id == detection.id).one().status == STATUS_DETECTED


def test_batch_complete_rejects_a_selection_without_a_conflict(db, author):
    """No conflict means no row could ever clear the floor, so the call fails
    whole rather than reporting the same miss N times."""
    detection = _detection(db, author)
    headers = login_as(client, author)
    rows = [{"event_id": str(detection.id), "sensor": "drone"}]

    empty = client.post(_URL, headers=headers, json={"conflict_ids": [], "rows": rows})
    assert empty.status_code == 422

    unknown = client.post(
        _URL, headers=headers, json={"conflict_ids": [str(uuid.uuid4())], "rows": rows}
    )
    assert unknown.status_code == 400
    assert unknown.json()["detail"]["code"] == "conflict_required"

    db.expire_all()
    assert db.query(Event).filter(Event.id == detection.id).one().status == STATUS_DETECTED


def test_batch_complete_refuses_another_analysts_detection_before_publishing_any(
    db, author, second_user, conflict
):
    """Ownership fails the whole call, and it fails it BEFORE the first commit:
    a selection reaching for someone else's detection publishes nothing at all."""
    mine = _detection(db, author)
    theirs = _detection(db, second_user)

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(mine, "drone"), (theirs, "drone")]),
    )
    assert response.status_code == 403

    db.expire_all()
    assert db.query(Event).filter(Event.id == mine.id).one().status == STATUS_DETECTED
    assert db.query(Event).filter(Event.id == theirs.id).one().status == STATUS_DETECTED
