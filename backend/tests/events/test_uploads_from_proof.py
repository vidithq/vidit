"""``POST /uploads/from-proof``: a copy of a proof image, staged as ``POST /uploads`` stages a file."""

from __future__ import annotations

import json
import uuid

import pytest

from app.models.event import STATUS_DETECTED, STATUS_REQUESTED, Event
from app.models.media import Media
from app.services import uploads as uploads_service
from app.services.storage import content_sha256, get_storage
from tests._fixtures import TINY_JPEG, store_bytes, stored_bytes, stored_keys, stored_path
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client, source_spec, sources_field, stage_file

SOURCE_URL = "https://example.com/source"


def _with_proof_image(db, geo: Event, key: str = "proof/u/footage.jpg") -> str:
    """Store a proof image of ``geo`` at ``key`` and name it in the proof body; its URL."""
    store_bytes(TINY_JPEG, key)
    url = get_storage().public_url(key)
    db.add(
        Media(
            event_id=geo.id,
            storage_url=url,
            kind="image",
            sha256=content_sha256(TINY_JPEG),
            original_filename="footage.jpg",
        )
    )
    geo.proof = f'<p>Footage.</p><img src="{url}">'
    db.commit()
    return url


def _detection(db, author, **kw) -> tuple[Event, str]:
    """A detection whose source is a link with no file, beside a proof image: the two halves
    of ``source_footage_missing`` the promote answers."""
    geo = _make_geo(db, author=author, status=STATUS_DETECTED, source_url=SOURCE_URL, **kw)
    return geo, _with_proof_image(db, geo)


def _promote(user, event_id, url: str):
    return client.post(
        "/api/v1/uploads/from-proof",
        headers=login_as(client, user),
        json={"event_id": str(event_id), "url": url},
    )


def _refused(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["detail"]["code"] == code


def test_a_proof_image_is_copied_into_a_staged_source_file(db, author):
    geo, url = _detection(db, author)

    response = _promote(author, geo.id, url)

    assert response.status_code == 201, response.text
    staged = response.json()
    assert staged["kind"] == "image"
    assert staged["original_filename"] == "footage.jpg"
    # The bytes land as they are: the copy keeps the proof's fingerprint.
    assert staged["sha256"] == content_sha256(TINY_JPEG)
    key = staged["storage_url"].split("/local-storage/", 1)[1]
    assert key.startswith("uploads/") and stored_bytes(key) == TINY_JPEG
    # A source image gets its derivatives, as one uploaded through the form.
    assert stored_path(key.replace(".jpg", "_hero.jpg")).exists()
    assert stored_path(key.replace(".jpg", "_thumb.jpg")).exists()
    # The proof keeps its own object.
    assert stored_bytes("proof/u/footage.jpg") == TINY_JPEG


def test_the_staged_copy_fills_the_detections_source_on_the_publish(db, author, conflict):
    geo, url = _detection(db, author)
    staged = _promote(author, geo.id, url).json()
    [source] = geo.sources

    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        headers=login_as(client, author),
        data={
            "title": "Strike",
            "lat": "48.5",
            "lng": "34.5",
            "occurred_date": "2026-05-01",
            "proof": geo.proof,
            "conflict_ids": json.dumps([str(conflict.id)]),
            "sources": sources_field(
                source_spec(SOURCE_URL, id=str(source.id), upload_id=staged["id"])
            ),
            "version_no": "0",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "geolocated"
    [published] = body["sources"]
    assert published["media"]["storage_url"] == staged["storage_url"]
    assert published["media"]["sha256"] == content_sha256(TINY_JPEG)
    # The proof still holds its image, so the proof floor holds too.
    assert url in body["proof"]


def test_anyone_may_copy_a_proof_image_of_an_open_request(db, author, second_user):
    geo = _make_geo(db, author=author, status=STATUS_REQUESTED, with_media=True)
    url = _with_proof_image(db, geo)

    assert _promote(second_user, geo.id, url).status_code == 201


@pytest.mark.parametrize(
    "case", ["another_owner", "deleted", "unknown_event", "another_event", "source_file"]
)
def test_an_image_that_is_not_your_events_proof_image_is_refused(db, author, second_user, case):
    geo, url = _detection(db, author, deleted=case == "deleted")
    caller, event_id = author, geo.id
    if case == "another_owner":
        caller = second_user
    elif case == "unknown_event":
        event_id = uuid.uuid4()
    elif case == "another_event":
        event_id = _make_geo(db, author=author, status=STATUS_DETECTED).id
    elif case == "source_file":
        sourced = _make_geo(db, author=author, status=STATUS_DETECTED, with_media=True)
        event_id, url = sourced.id, sourced.sources[0].media.storage_url
    before = stored_keys()

    _refused(_promote(caller, event_id, url), 404, "proof_image_not_found")

    assert stored_keys() == before


def test_the_copy_counts_against_the_staged_file_cap(db, author, monkeypatch):
    geo, url = _detection(db, author)
    monkeypatch.setattr(uploads_service, "MAX_PENDING_UPLOADS_PER_USER", 1)
    stage_file(author)

    _refused(_promote(author, geo.id, url), 429, "too_many_uploads")
