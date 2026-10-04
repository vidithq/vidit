"""Archived copies: the snapshot form fields on create and geolocate, and the read that
serialises them.

Edit-form copies and the versions they file live in ``test_versions.py``.
"""

from __future__ import annotations

import json
import uuid

from app.models.event import STATUS_DETECTED, STATUS_REQUESTED, Event
from app.models.source_archive import SourceArchive
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client, proof_file_part, proof_form_field

SOURCE = "https://x.com/analyst/status/424242"
MIRROR = "https://t.me/channel/424242"
SECOND_MIRROR = "https://rumble.com/v-424242"
DETECTED_FROM = "https://x.com/analyst/status/909090"
CAPTURE_TS = "20260811120000"
WAYBACK = f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"
ARCHIVE_TODAY = "https://archive.ph/abcde"


def _wayback_of(url: str) -> str:
    """The replay URL a Wayback capture of ``url`` hands back."""
    return f"https://web.archive.org/web/{CAPTURE_TS}/{url}"


def _seed_copy(db, event_id, *, url=SOURCE, snapshot_url=WAYBACK, origin="source_url"):
    """Seeded straight to the table: a precondition of the reconcile tests, not what they
    exercise."""
    db.add(
        SourceArchive(
            event_id=event_id,
            original_url=url,
            origin=origin,
            snapshot_url=snapshot_url,
            provider="wayback",
        )
    )
    db.commit()


def _copy(db, event_id, url):
    return (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event_id, SourceArchive.original_url == url)
        .one_or_none()
    )


def _copies(db, event_id):
    return db.query(SourceArchive).filter(SourceArchive.event_id == event_id).all()


def _create(author, conflict, capture_source_tag, **overrides):
    """POST the direct-create form with the evidence floor met."""
    form = {
        "title": "x",
        "lat": "0.0",
        "lng": "0.0",
        "source_url": SOURCE,
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
    }
    form.update(overrides)
    return client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=form,
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part()],
    )


def _geolocate(event_id, user, conflict, capture_source_tag, **overrides):
    """POST the geolocate form (the edit / submit transition) with the floor met."""
    form = {
        "title": "Edited title",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": SOURCE,
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
    }
    form.update(overrides)
    return client.post(
        f"/api/v1/events/{event_id}/geolocate",
        headers=login_as(client, user),
        data=form,
        files=[proof_file_part()],
    )


def test_create_stores_the_snapshot_posted_with_the_form(db, author, conflict, capture_source_tag):
    """The copy lands with the event, so the published page carries it from its first
    render."""
    response = _create(author, conflict, capture_source_tag, source_snapshot_url=WAYBACK)
    assert response.status_code == 201, response.text
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}

    row = _copy(db, uuid.UUID(response.json()["id"]), SOURCE)
    assert (row.snapshot_url, row.provider, row.origin) == (WAYBACK, "wayback", "source_url")


def test_create_without_a_snapshot_stores_none(db, author, conflict, capture_source_tag):
    response = _create(author, conflict, capture_source_tag)
    assert response.status_code == 201
    assert response.json()["archived_source"] is None
    assert _copies(db, uuid.UUID(response.json()["id"])) == []


def test_create_stores_a_snapshot_whatever_it_replays(db, author, conflict, capture_source_tag):
    """Validation says where a snapshot lives, not what it captured: a well-formed replay
    URL is stored even when its embedded original differs from the source (short link,
    former domain)."""
    snapshot = _wayback_of("https://youtu.be/dQw4w9WgXcQ")
    response = _create(author, conflict, capture_source_tag, source_snapshot_url=snapshot)
    assert response.status_code == 201, response.text
    assert response.json()["archived_source"] == {"url": snapshot, "provider": "wayback"}

    assert _copy(db, uuid.UUID(response.json()["id"]), SOURCE).snapshot_url == snapshot


def test_create_refuses_a_snapshot_on_an_unlisted_host(author, conflict, capture_source_tag):
    response = _create(
        author,
        conflict,
        capture_source_tag,
        source_snapshot_url=f"https://archive.evil.example/{CAPTURE_TS}",
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_provider_not_allowed"


def test_a_request_keeps_the_snapshot_its_poster_made(db, author):
    """One form posts either shape (geolocation or request)."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Help geolocate",
            "source_url": SOURCE,
            "source_posted_at": "2026-05-01T12:00",
            "source_snapshot_url": WAYBACK,
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 201, response.text
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}


def test_a_rejected_snapshot_creates_no_event(db, author, conflict, capture_source_tag):
    """The copy rides the event's transaction: a refused paste fails the whole create."""
    title = f"archival-{uuid.uuid4().hex[:8]}"
    response = _create(
        author,
        conflict,
        capture_source_tag,
        title=title,
        source_snapshot_url="http://web.archive.org/save/whatever",
    )
    assert response.status_code == 400
    assert db.query(Event).filter(Event.title == title).one_or_none() is None


def test_geolocate_stores_the_snapshot_posted_with_the_form(
    db, author, conflict, capture_source_tag
):
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)

    response = _geolocate(geo.id, author, conflict, capture_source_tag, source_snapshot_url=WAYBACK)
    assert response.status_code == 200, response.text
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}
    assert _copy(db, geo.id, SOURCE).origin == "source_url"


def test_geolocate_replaces_the_copy_the_event_already_had(
    db, author, conflict, capture_source_tag
):
    """One slot per link: overwrite is the correction path."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    _seed_copy(db, geo.id)

    response = _geolocate(
        geo.id, author, conflict, capture_source_tag, source_snapshot_url=ARCHIVE_TODAY
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert [(r.snapshot_url, r.provider) for r in _copies(db, geo.id)] == [
        (ARCHIVE_TODAY, "archive_today")
    ]


def test_geolocate_refuses_a_snapshot_that_is_not_one(db, author, conflict, capture_source_tag):
    """A rejected paste writes nothing; the detection stays unpublished."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)

    response = _geolocate(
        geo.id,
        author,
        conflict,
        capture_source_tag,
        source_snapshot_url="https://web.archive.org/about/",
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_not_a_replay_url"

    db.expire_all()
    assert _copies(db, geo.id) == []
    assert db.query(Event).filter(Event.id == geo.id).one().status == STATUS_DETECTED


def test_a_fulfilment_archives_the_requesters_source(
    db, author, second_user, conflict, capture_source_tag
):
    """The paste is checked against the URL the row keeps, since a fulfiller cannot
    rewrite the requester's source."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_REQUESTED,
        source_url=SOURCE,
        with_media=True,
    )

    response = _geolocate(
        geo.id,
        second_user,
        conflict,
        capture_source_tag,
        source_url="https://someone-elses.example/post",
        source_snapshot_url=WAYBACK,
    )
    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == SOURCE
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}


def test_create_stores_a_copy_of_each_mirror_posted_beside_it(
    db, author, conflict, capture_source_tag
):
    """One paste field per mirror, posted aligned with the link it covers."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[MIRROR, SECOND_MIRROR],
        secondary_snapshot_urls=["", _wayback_of(SECOND_MIRROR)],
    )
    assert response.status_code == 201, response.text
    assert response.json()["archived_secondary_sources"] == [
        None,
        {"url": _wayback_of(SECOND_MIRROR), "provider": "wayback"},
    ]

    row = _copy(db, uuid.UUID(response.json()["id"]), SECOND_MIRROR)
    assert row.origin == "secondary_source"


def test_a_blank_mirror_row_does_not_shift_the_copies(db, author, conflict, capture_source_tag):
    """Pairing happens before normalization drops blank rows, so a copy stays on its
    mirror."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=["", MIRROR],
        secondary_snapshot_urls=["", _wayback_of(MIRROR)],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["secondary_source_urls"] == [MIRROR]
    assert body["archived_secondary_sources"] == [
        {"url": _wayback_of(MIRROR), "provider": "wayback"}
    ]


def test_create_refuses_a_mirror_snapshot_that_is_not_one(db, author, conflict, capture_source_tag):
    """A mirror's bad paste is the same 400 as the primary's, and the event is not
    created."""
    title = f"archival-{uuid.uuid4().hex[:8]}"
    response = _create(
        author,
        conflict,
        capture_source_tag,
        title=title,
        secondary_source_urls=[MIRROR],
        secondary_snapshot_urls=[f"https://archive.ph/newest/{MIRROR}"],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_not_a_snapshot_code"
    assert db.query(Event).filter(Event.title == title).one_or_none() is None


def test_a_request_keeps_the_mirror_copy_its_poster_made(db, author):
    """The one form posts either shape, mirrors and their copies included."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Help geolocate",
            "source_url": SOURCE,
            "source_posted_at": "2026-05-01T12:00",
            "secondary_source_urls": [MIRROR],
            "secondary_snapshot_urls": [_wayback_of(MIRROR)],
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 201, response.text
    assert response.json()["archived_secondary_sources"] == [
        {"url": _wayback_of(MIRROR), "provider": "wayback"}
    ]


def test_geolocate_stores_the_mirror_copies_posted_with_the_form(
    db, author, conflict, capture_source_tag
):
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)

    response = _geolocate(
        geo.id,
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[MIRROR],
        secondary_snapshot_urls=[ARCHIVE_TODAY],
    )
    assert response.status_code == 200, response.text
    assert response.json()["archived_secondary_sources"] == [
        {"url": ARCHIVE_TODAY, "provider": "archive_today"}
    ]

    db.expire_all()
    assert _copy(db, geo.id, MIRROR).origin == "secondary_source"


def test_a_snapshot_beside_a_dropped_mirror_is_dropped_with_it(
    db, author, conflict, capture_source_tag
):
    """A mirror equal to the primary is normalized away, so no copy row is written."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)

    response = _geolocate(
        geo.id,
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[SOURCE],
        secondary_snapshot_urls=[WAYBACK],
    )
    assert response.status_code == 200, response.text
    assert response.json()["secondary_source_urls"] == []

    db.expire_all()
    assert _copies(db, geo.id) == []


def test_changing_the_source_url_drops_the_copy_of_the_old_one(
    db, author, conflict, capture_source_tag
):
    """An edit that corrects the URL and pastes nothing leaves the event unarchived."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    _seed_copy(db, geo.id)

    corrected = "https://t.me/realchannel/77"
    response = _geolocate(geo.id, author, conflict, capture_source_tag, source_url=corrected)
    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == corrected
    assert response.json()["archived_source"] is None

    db.expire_all()
    assert _copies(db, geo.id) == []


def test_changing_the_source_url_keeps_a_copy_of_a_link_that_survives(
    db, author, conflict, capture_source_tag
):
    """A source demoted to a mirror keeps its copy, re-filed under its new origin."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    _seed_copy(db, geo.id)

    corrected = "https://t.me/realchannel/77"
    response = _geolocate(
        geo.id,
        author,
        conflict,
        capture_source_tag,
        source_url=corrected,
        secondary_source_urls=[SOURCE],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["archived_source"] is None
    assert body["archived_secondary_sources"] == [{"url": WAYBACK, "provider": "wayback"}]

    db.expire_all()
    assert _copy(db, geo.id, SOURCE).origin == "secondary_source"


def test_a_changed_source_url_takes_its_own_new_copy(db, author, conflict, capture_source_tag):
    """One write swaps the source URL and its copy."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    _seed_copy(db, geo.id)

    corrected = "https://t.me/realchannel/77"
    response = _geolocate(
        geo.id,
        author,
        conflict,
        capture_source_tag,
        source_url=corrected,
        source_snapshot_url=_wayback_of(corrected),
    )
    assert response.status_code == 200, response.text
    assert response.json()["archived_source"] == {
        "url": _wayback_of(corrected),
        "provider": "wayback",
    }

    db.expire_all()
    assert [r.original_url for r in _copies(db, geo.id)] == [corrected]


def test_an_untouched_source_url_keeps_its_copy(db, author, conflict, capture_source_tag):
    """An edit that leaves the source alone leaves its copy alone."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    _seed_copy(db, geo.id)

    response = _geolocate(geo.id, author, conflict, capture_source_tag)
    assert response.status_code == 200, response.text
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}


def test_event_detail_serialises_the_source_copy(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=SOURCE,
            origin="source_url",
            snapshot_url=WAYBACK,
            provider="wayback",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source"] == {"url": WAYBACK, "provider": "wayback"}


def test_event_detail_archived_source_is_null_without_a_copy(db, author):
    """No copy renders the grey affordance."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source"] is None


def test_event_detail_serialises_the_provenance_copy(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE, detected_from_url=DETECTED_FROM)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=DETECTED_FROM,
            origin="detected_from",
            snapshot_url=ARCHIVE_TODAY,
            provider="archive_today",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_detected_from"] == {
        "url": ARCHIVE_TODAY,
        "provider": "archive_today",
    }
    # One row per link, matched by URL: the source keeps its own (empty) slot.
    assert body["archived_source"] is None


def test_event_detail_aligns_mirror_copies_with_their_urls(db, author):
    """``archived_secondary_sources`` is index-aligned with ``secondary_source_urls``: a
    copy must not slide onto the neighbouring mirror."""
    second = "https://rumble.com/v-mirror"
    geo = _make_geo(db, author=author, source_url=SOURCE, secondary_source_urls=[MIRROR, second])
    # Only the second mirror has a copy, and the row order is the reverse of the
    # link order, so an implementation zipping the two collections instead of
    # looking each URL up fails here.
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=second,
            origin="secondary_source",
            snapshot_url=ARCHIVE_TODAY,
            provider="archive_today",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["secondary_source_urls"] == [MIRROR, second]
    assert body["archived_secondary_sources"] == [
        None,
        {"url": ARCHIVE_TODAY, "provider": "archive_today"},
    ]


def test_event_detail_mirror_copies_are_empty_without_mirrors(db, author):
    """An event with no mirror serialises both lists empty."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["secondary_source_urls"] == []
    assert body["archived_secondary_sources"] == []
