"""Archived copies: the standalone endpoint, the submit / edit field, the read.

Three halves of one contract, tested through HTTP because that is where they
meet: the owner records a copy of one of their event's links through ``POST
/events/{event_id}/archives`` or carries it with the write that stores the
source (``source_snapshot_url`` on create and geolocate), and every read of
that event serialises the copy beside the link it archives.
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
DETECTED_FROM = "https://x.com/analyst/status/909090"
CAPTURE_TS = "20260811120000"
WAYBACK = f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"
ARCHIVE_TODAY = "https://archive.ph/abcde"


def _wayback_of(url: str) -> str:
    """The replay URL a Wayback capture of ``url`` hands back."""
    return f"https://web.archive.org/web/{CAPTURE_TS}/{url}"


def _url(event_id) -> str:
    return f"/api/v1/events/{event_id}/archives"


def _post(event_id, user, *, original_url=SOURCE, snapshot_url=WAYBACK):
    return client.post(
        _url(event_id),
        headers=login_as(client, user),
        json={"original_url": original_url, "snapshot_url": snapshot_url},
    )


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


# ── recording a copy ───────────────────────────────────────────────────


def test_the_owner_records_a_wayback_copy_of_the_source(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE)

    response = _post(geo.id, author)
    assert response.status_code == 200, response.text
    assert response.json() == {"url": WAYBACK, "provider": "wayback"}

    row = _copy(db, geo.id, SOURCE)
    assert (row.snapshot_url, row.provider, row.origin) == (WAYBACK, "wayback", "source_url")


def test_an_archive_today_code_is_stored_under_its_own_provider(db, author):
    """The provider is inferred from the snapshot's host, so the two services
    share one slot and the read surface picks its icon from the discriminator."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    response = _post(geo.id, author, snapshot_url=ARCHIVE_TODAY)
    assert response.status_code == 200, response.text
    assert response.json() == {"url": ARCHIVE_TODAY, "provider": "archive_today"}


def test_a_resubmission_replaces_the_copy(db, author):
    """One slot per link: pasting a better snapshot is the owner's correction
    path, not a second competing row."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    assert _post(geo.id, author).status_code == 200

    assert _post(geo.id, author, snapshot_url=ARCHIVE_TODAY).status_code == 200

    db.expire_all()
    rows = db.query(SourceArchive).filter(SourceArchive.event_id == geo.id).all()
    assert [(r.snapshot_url, r.provider) for r in rows] == [(ARCHIVE_TODAY, "archive_today")]


def test_a_mirror_and_the_provenance_link_are_archivable_too(db, author):
    geo = _make_geo(
        db,
        author=author,
        source_url=SOURCE,
        secondary_source_urls=[MIRROR],
        detected_from_url=DETECTED_FROM,
    )

    for url in (MIRROR, DETECTED_FROM):
        response = _post(geo.id, author, original_url=url, snapshot_url=ARCHIVE_TODAY)
        assert response.status_code == 200, response.text

    assert _copy(db, geo.id, MIRROR).origin == "secondary_source"
    assert _copy(db, geo.id, DETECTED_FROM).origin == "detected_from"


def test_a_detection_owner_can_archive_its_links(db, author):
    """Archival is no longer tied to publication, so an unpublished detection's
    links carry the same affordance."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)

    assert _post(geo.id, author).status_code == 200
    assert _copy(db, geo.id, SOURCE) is not None


# ── who may write, and what ────────────────────────────────────────────


def test_recording_a_copy_requires_authentication(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE)
    response = client.post(_url(geo.id), json={"original_url": SOURCE, "snapshot_url": WAYBACK})
    assert response.status_code == 401


def test_a_non_owner_cannot_record_a_copy(db, author, second_user):
    geo = _make_geo(db, author=author, source_url=SOURCE)
    assert _post(geo.id, second_user).status_code == 403
    assert _copy(db, geo.id, SOURCE) is None


def test_a_soft_deleted_event_reads_as_missing(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE, deleted=True)
    assert _post(geo.id, author).status_code == 404


def test_a_link_the_event_does_not_carry_is_refused(db, author):
    """``original_url`` is checked against the event's own links, so the
    endpoint cannot be used to hang an arbitrary URL pair off an event."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    response = _post(
        geo.id,
        author,
        original_url="https://elsewhere.example/x",
        snapshot_url=f"https://web.archive.org/web/{CAPTURE_TS}/https://elsewhere.example/x",
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "original_url_not_on_event"


def test_a_snapshot_on_an_unlisted_host_is_refused(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE)
    response = _post(geo.id, author, snapshot_url=f"https://archive.evil.example/{CAPTURE_TS}")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_provider_not_allowed"


def test_a_wayback_snapshot_of_another_page_is_refused(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE)
    response = _post(
        geo.id,
        author,
        snapshot_url=f"https://web.archive.org/web/{CAPTURE_TS}/https://elsewhere.test/x",
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_original_mismatch"
    assert _copy(db, geo.id, SOURCE) is None


# ── the copy the submit form carries ───────────────────────────────────


def test_create_stores_the_snapshot_posted_with_the_form(db, author, conflict, capture_source_tag):
    """Archival starts at the submit: the analyst archives the source while
    filling the form and the copy lands with the event, so the published page
    carries it from its first render."""
    response = _create(author, conflict, capture_source_tag, source_snapshot_url=WAYBACK)
    assert response.status_code == 201, response.text
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}

    row = _copy(db, uuid.UUID(response.json()["id"]), SOURCE)
    assert (row.snapshot_url, row.provider, row.origin) == (WAYBACK, "wayback", "source_url")


def test_create_without_a_snapshot_stores_none(db, author, conflict, capture_source_tag):
    """The field is optional: the submit form asks for a copy, it does not
    require one."""
    response = _create(author, conflict, capture_source_tag)
    assert response.status_code == 201
    assert response.json()["archived_source"] is None
    assert _copies(db, uuid.UUID(response.json()["id"])) == []


def test_create_refuses_a_snapshot_of_another_link(db, author, conflict, capture_source_tag):
    """The same check the standalone endpoint runs, with the same code: a
    replay URL that captured a different page is not this source's copy."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        source_snapshot_url=_wayback_of("https://elsewhere.test/x"),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_original_mismatch"


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
    """One form posts either shape, so the paste survives the choice between
    publishing a geolocation and posting a request."""
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
    """The copy rides the event's own transaction, so a paste the checks refuse
    takes the whole create down rather than publishing an unarchived event the
    analyst believes is archived."""
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


# ── the copy the edit form carries ─────────────────────────────────────


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
    """Overwrite is the correction path here too: one slot per link, whichever
    form the better snapshot arrives through."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    assert _post(geo.id, author).status_code == 200

    response = _geolocate(
        geo.id, author, conflict, capture_source_tag, source_snapshot_url=ARCHIVE_TODAY
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert [(r.snapshot_url, r.provider) for r in _copies(db, geo.id)] == [
        (ARCHIVE_TODAY, "archive_today")
    ]


def test_geolocate_refuses_a_snapshot_of_another_link(db, author, conflict, capture_source_tag):
    """A rejected paste writes nothing at all: the detection stays unpublished, so
    the analyst fixes the paste and submits the same form again."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)

    response = _geolocate(
        geo.id,
        author,
        conflict,
        capture_source_tag,
        source_snapshot_url=_wayback_of("https://elsewhere.test/x"),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_original_mismatch"

    db.expire_all()
    assert _copies(db, geo.id) == []
    assert db.query(Event).filter(Event.id == geo.id).one().status == STATUS_DETECTED


def test_a_fulfilment_archives_the_requesters_source(
    db, author, second_user, conflict, capture_source_tag
):
    """A fulfiller may not rewrite the requester's source URL, so their paste is
    checked against the URL the row keeps, not the one the form posted."""
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


# ── a changed source URL never keeps the old copy ──────────────────────


def test_changing_the_source_url_drops_the_copy_of_the_old_one(
    db, author, conflict, capture_source_tag
):
    """The archived source must be a copy of the source: an edit that corrects
    the URL and pastes nothing leaves the event unarchived rather than showing
    a snapshot of the link it just disowned."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    assert _post(geo.id, author).status_code == 200

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
    """The old URL demoted to a mirror is still a link the event carries, so its
    copy stays and is re-filed under the origin it now has."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    assert _post(geo.id, author).status_code == 200

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
    """The correction and its archive travel together: one write swaps the
    source URL and the copy filed against it."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    assert _post(geo.id, author).status_code == 200

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
    """The reconcile only bites on a mismatch: an edit that leaves the source
    alone leaves its archived copy alone too."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE, with_media=True)
    assert _post(geo.id, author).status_code == 200

    response = _geolocate(geo.id, author, conflict, capture_source_tag)
    assert response.status_code == 200, response.text
    assert response.json()["archived_source"] == {"url": WAYBACK, "provider": "wayback"}


# ── the read shape ─────────────────────────────────────────────────────


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
    """No copy is the ordinary state: archival is an act the owner performs, so
    the surface renders the grey affordance rather than a state it cannot claim."""
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
    """``archived_secondary_sources`` is index-aligned with
    ``secondary_source_urls``: entry ``i`` covers mirror ``i``. The alignment is
    the contract the detail surface reads, so a copy must not slide onto the
    neighbouring mirror when only some of the list is archived."""
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
    """An event declaring no mirror serialises both lists empty, so the surface
    reads one shape rather than branching on a missing key."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["secondary_source_urls"] == []
    assert body["archived_secondary_sources"] == []
