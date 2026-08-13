"""``POST /events/{event_id}/archives`` and the archived copies it feeds.

Two halves of one contract, tested through HTTP because that is where they
meet: the owner records a copy of one of their event's links, and every read of
that event serialises it beside the link it archives.
"""

from __future__ import annotations

from app.models.event import STATUS_DETECTED
from app.models.source_archive import SourceArchive
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client

SOURCE = "https://x.com/analyst/status/424242"
MIRROR = "https://t.me/channel/424242"
DETECTED_FROM = "https://x.com/analyst/status/909090"
CAPTURE_TS = "20260811120000"
WAYBACK = f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"
ARCHIVE_TODAY = "https://archive.ph/abcde"


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


def test_a_draft_owner_can_archive_its_links(db, author):
    """Archival is no longer tied to publication, so an unpublished draft's
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
