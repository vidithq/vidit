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
    """A directly created geolocation is public on arrival: source and every
    proof-body citation land in the queue, each tagged with where it was
    found."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "Strike on a depot",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": SOURCE,
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

    assert _archived(db, event_id) == {SOURCE: "source_url", PROOF_LINK: "proof_link"}
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
    published set, including the source the geolocate form supplies and a
    citation the proof body gained in the same submit.
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

    assert _archived(db, draft.id) == {SOURCE: "source_url", PROOF_LINK: "proof_link"}


def test_event_detail_serialises_the_archived_source(db, author):
    """``archived_source_url`` is the capture of the event's own source: NULL
    while the worker has none, the replay URL once the row is done."""
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=SOURCE,
            origin="source_url",
            status="done",
            provider="wayback",
            archived_url=f"https://web.archive.org/web/20260811120000/{SOURCE}",
        )
    )
    # A proof-body capture is stored but never rendered as the source fallback.
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=PROOF_LINK,
            origin="proof_link",
            status="done",
            provider="wayback",
            archived_url="https://web.archive.org/web/20260811120001/other",
        )
    )
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["source_url"] == SOURCE
    assert body["archived_source_url"] == f"https://web.archive.org/web/20260811120000/{SOURCE}"


def test_event_detail_archived_source_is_null_without_a_capture(db, author):
    geo = _make_geo(db, author=author, source_url=SOURCE)
    db.add(SourceArchive(event_id=geo.id, original_url=SOURCE, origin="source_url"))
    db.commit()

    body = client.get(f"/api/v1/events/{geo.id}").json()
    assert body["archived_source_url"] is None
