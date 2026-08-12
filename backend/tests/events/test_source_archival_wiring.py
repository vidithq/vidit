"""Where source archival is wired into the write paths, and where it is not.

Archival is a publication act: Save Page Now is public and timestamped, so a
link is submitted when the event carrying it becomes public. These tests drive
the HTTP endpoints and read the ``source_archives`` table directly, because the
wiring is exactly what a refactor drops silently: the queue keeps working, it
just stops being fed.

The detected-draft half of the contract (no rows for unpublished machine work)
lives with the detection spine in ``tests/test_detection.py``.
"""

from __future__ import annotations

import json
import uuid

from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.media import Media
from app.models.source_archive import SourceArchive
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client, proof_file_part

SOURCE = "https://x.com/analyst/status/424242"
PROOF_LINK = "https://example.org/corroborating-report"
MIRROR = "https://t.me/channel/424242"
DETECTED_FROM = "https://x.com/analyst/status/909090"


def _proof_with_link_and_image(filename: str = "proof-1.jpg") -> str:
    """The placeholder-image proof the floor requires, plus one cited link."""
    return json.dumps(
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "corroboration",
                            "marks": [{"type": "link", "attrs": {"href": PROOF_LINK}}],
                        }
                    ],
                },
                {"type": "image", "attrs": {"src": f"placeholder://{filename}"}},
            ],
        }
    )


def _archived(db, event_id) -> dict[str, str]:
    """``{original_url: origin}`` for one event's queue rows."""
    rows = db.query(SourceArchive).filter(SourceArchive.event_id == event_id).all()
    return {row.original_url: row.origin for row in rows}


def _cleanup(db, event_id) -> None:
    db.query(Media).filter(Media.event_id == event_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.id == event_id).delete(synchronize_session=False)
    db.commit()


def test_create_geolocated_enqueues_its_links(db, author, conflict, capture_source_tag):
    """A directly created geolocation is public on arrival: the source, every
    submitted mirror, and every proof-body citation land in the queue, each
    tagged with where it was found."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "Strike on a depot",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": SOURCE,
            "secondary_source_urls": [MIRROR],
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "proof": _proof_with_link_and_image(),
            "tag_ids": json.dumps([str(capture_source_tag.id)]),
            "conflict_ids": json.dumps([str(conflict.id)]),
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part()],
    )
    assert response.status_code == 201, response.text
    event_id = uuid.UUID(response.json()["id"])

    assert _archived(db, event_id) == {
        SOURCE: "source_url",
        MIRROR: "secondary_source",
        PROOF_LINK: "proof_link",
    }
    _cleanup(db, event_id)


def test_create_request_enqueues_its_source(db, author):
    """A request is public content the moment it lands, so it archives on the
    same terms as a geolocation."""
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Who can place this?",
            "source_url": SOURCE,
            "source_posted_at": "2026-05-01T12:00",
        },
        files={"file": ("tiny.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    event_id = uuid.UUID(response.json()["id"])

    assert _archived(db, event_id) == {SOURCE: "source_url"}
    _cleanup(db, event_id)


def test_geolocate_enqueues_at_publication(db, author, conflict, capture_source_tag):
    """The promotion is where a draft's links first reach a public archive.

    The draft carries none while it is unpublished; publishing enqueues the
    published set, including the source the geolocate form supplies, the
    mirrors it submits, and a citation the proof body gained in the same
    submit.
    """
    draft = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        source_url=None,
        with_media=True,
    )
    assert _archived(db, draft.id) == {}

    response = client.post(
        f"/api/v1/events/{draft.id}/geolocate",
        headers=login_as(client, author),
        data={
            "title": "Depot strike, verified",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": SOURCE,
            "secondary_source_urls": [MIRROR],
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "proof": _proof_with_link_and_image(),
            "tag_ids": json.dumps([str(capture_source_tag.id)]),
            "conflict_ids": json.dumps([str(conflict.id)]),
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == STATUS_GEOLOCATED

    assert _archived(db, draft.id) == {
        SOURCE: "source_url",
        MIRROR: "secondary_source",
        PROOF_LINK: "proof_link",
    }


def test_geolocate_enqueues_the_provenance_link(db, author, conflict, capture_source_tag):
    """The analyst's own post is provenance the catalog keeps readable, so the
    promotion queues ``detected_from_url`` alongside the footage source.

    It is queued at publication like every other link: the draft carries no row
    for it while nobody has vouched for the coordinates.
    """
    draft = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        source_url=None,
        detected_from_url=DETECTED_FROM,
        with_media=True,
    )
    assert _archived(db, draft.id) == {}

    response = client.post(
        f"/api/v1/events/{draft.id}/geolocate",
        headers=login_as(client, author),
        data={
            "title": "Depot strike, verified",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": SOURCE,
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "proof": _proof_with_link_and_image(),
            "tag_ids": json.dumps([str(capture_source_tag.id)]),
            "conflict_ids": json.dumps([str(conflict.id)]),
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 200, response.text

    assert _archived(db, draft.id) == {
        SOURCE: "source_url",
        DETECTED_FROM: "detected_from",
        PROOF_LINK: "proof_link",
    }


def test_event_detail_serialises_the_provenance_link_copies(db, author):
    """``archived_detected_from`` carries the provenance link's captures, in the
    same shape as the source's, so the Detected from row renders the same
    affordance the Source row does."""
    geo = _make_geo(db, author=author, source_url=SOURCE, detected_from_url=DETECTED_FROM)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=DETECTED_FROM,
            origin="detected_from",
            status="done",
            wayback_url=f"https://web.archive.org/web/20260811120003/{DETECTED_FROM}",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["detected_from_url"] == DETECTED_FROM
    assert body["archived_detected_from"] == {
        "wayback": f"https://web.archive.org/web/20260811120003/{DETECTED_FROM}",
        "archive_today": None,
        "unavailable": False,
    }
    # The source's own record stays its own: one row per link, matched by URL.
    assert body["archived_source"] is None


def test_event_detail_archived_detected_from_is_null_on_a_draft(db, author):
    """A draft's provenance link is queued only at publication, so the field is
    null and the surface says "archived when published" from the status
    instead of inventing a record."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        source_url=None,
        detected_from_url=DETECTED_FROM,
    )

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["detected_from_url"] == DETECTED_FROM
    assert body["archived_detected_from"] is None


def test_event_detail_archived_detected_from_is_null_for_a_human_submit(db, author):
    """A human submit has no provenance link at all, so there is nothing to
    look up and the field is null on the same terms."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["detected_from_url"] is None
    assert body["archived_detected_from"] is None


def test_event_detail_serialises_both_provider_copies(db, author):
    """``archived_source`` carries the event's own source captures: one field
    per provider, and ``unavailable`` false while a copy exists."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=SOURCE,
            origin="source_url",
            status="done",
            wayback_url=f"https://web.archive.org/web/20260811120000/{SOURCE}",
            archive_today_url=f"https://archive.ph/abcde/{SOURCE}",
        )
    )
    # A proof-body capture is stored but never rendered as the source fallback.
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=PROOF_LINK,
            origin="proof_link",
            status="done",
            wayback_url="https://web.archive.org/web/20260811120001/other",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["source_url"] == SOURCE
    assert body["archived_source"] == {
        "wayback": f"https://web.archive.org/web/20260811120000/{SOURCE}",
        "archive_today": f"https://archive.ph/abcde/{SOURCE}",
        "unavailable": False,
    }


def test_event_detail_serialises_one_captured_provider(db, author):
    """One capture is a finished job, not a half-finished one: the missing
    provider is null and the link is not flagged unavailable."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=SOURCE,
            origin="source_url",
            status="done",
            archive_today_url=f"https://archive.ph/abcde/{SOURCE}",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source"] == {
        "wayback": None,
        "archive_today": f"https://archive.ph/abcde/{SOURCE}",
        "unavailable": False,
    }


def test_event_detail_flags_a_terminally_failed_link(db, author):
    """The state the detail surface displays as "not archived": both providers
    refused and the attempt budget is spent, so no copy is ever coming."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=SOURCE,
            origin="source_url",
            status="failed",
            error="wayback: robots blocked; archive.today: no snapshot",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source"] == {
        "wayback": None,
        "archive_today": None,
        "unavailable": True,
    }


def test_event_detail_archived_source_is_pending_without_a_capture(db, author):
    """A queued link is tracked but uncaptured: an object with both providers
    null and ``unavailable`` false, which the surface reads as in progress."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(SourceArchive(event_id=geo.id, original_url=SOURCE, origin="source_url"))
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source"] == {
        "wayback": None,
        "archive_today": None,
        "unavailable": False,
    }


def test_event_detail_archived_source_is_null_when_the_link_is_untracked(db, author):
    """No queue row at all is a different fact from an uncaptured one: the
    surface renders nothing rather than an archival state it cannot claim."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source"] is None


def test_event_detail_aligns_mirror_captures_with_their_urls(db, author):
    """``archived_secondary_sources`` is index-aligned with
    ``secondary_source_urls``: entry ``i`` covers mirror ``i``. The alignment is
    the contract the detail surface reads, so a capture must not slide onto the
    neighbouring mirror when only some of the list is done."""
    second = "https://rumble.com/v-mirror"
    geo = _make_geo(
        db,
        author=author,
        source_url=SOURCE,
        secondary_source_urls=[MIRROR, second],
    )
    # Only the second mirror has landed, and the queue row order is the reverse
    # of the link order, so an implementation zipping the two collections
    # instead of looking each URL up fails here.
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=second,
            origin="secondary_source",
            status="done",
            wayback_url=f"https://web.archive.org/web/20260811120002/{second}",
        )
    )
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=MIRROR,
            origin="secondary_source",
            status="queued",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["secondary_source_urls"] == [MIRROR, second]
    assert body["archived_secondary_sources"] == [
        {"wayback": None, "archive_today": None, "unavailable": False},
        {
            "wayback": f"https://web.archive.org/web/20260811120002/{second}",
            "archive_today": None,
            "unavailable": False,
        },
    ]


def test_event_detail_mirror_captures_are_empty_without_mirrors(db, author):
    """An event declaring no mirror serialises both lists empty, so the surface
    reads one shape rather than branching on a missing key."""
    geo = _make_geo(db, author=author, source_url=SOURCE)

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["secondary_source_urls"] == []
    assert body["archived_secondary_sources"] == []
