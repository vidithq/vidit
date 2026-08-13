"""Batch completion: ``POST /events/batch-complete``.

The import queue's bulk publish. What these lock in is the property the batch
lives or dies on: it is the SAME evidence floor as the single-row geolocate,
applied one transaction per row, so a mixed selection publishes the drafts that
clear it and leaves the others exactly as they were, each with its reason.
"""

from __future__ import annotations

import uuid

from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event, EventGeolocator
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client

_URL = "/api/v1/events/batch-complete"

# A draft's proof as the import leaves it: prose plus the annotation image the
# thread carried. Already-uploaded URLs count towards the proof-image floor
# exactly like the submit form's ``placeholder://`` srcs.
_PROOF_WITH_IMAGE = {
    "type": "doc",
    "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Matched the treeline."}]},
        {"type": "image", "attrs": {"src": "https://cdn.example.com/annotation.jpg"}},
    ],
}
_PROOF_TEXT_ONLY = {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "No image here."}]}],
}


def _draft(db, author, *, proof: dict | None = None, **kwargs) -> Event:
    """A machine draft as the archive import leaves it: coordinates, a source,
    its footage, and an annotated proof body. Tagless: the conflict and the
    capture source are exactly what the batch supplies."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url=kwargs.pop("source_url", "https://x.com/a/status/1"),
        with_media=kwargs.pop("with_media", True),
        **kwargs,
    )
    geo.proof = _PROOF_WITH_IMAGE if proof is None else proof
    db.commit()
    db.refresh(geo)
    return geo


def _body(conflict, rows: list[tuple[Event, uuid.UUID]]) -> dict:
    return {
        "conflict_ids": [str(conflict.id)],
        "rows": [
            {"event_id": str(geo.id), "capture_source_tag_id": str(tag_id)} for geo, tag_id in rows
        ],
    }


def _by_id(payload: dict) -> dict[str, dict]:
    return {row["event_id"]: row for row in payload["rows"]}


def test_batch_complete_requires_authentication(db, author, conflict, capture_source_tag):
    draft = _draft(db, author)
    response = client.post(_URL, json=_body(conflict, [(draft, capture_source_tag.id)]))
    assert response.status_code == 401


def test_batch_complete_publishes_a_ready_draft(db, author, conflict, capture_source_tag, free_tag):
    """The whole promotion: state, stamp, the conflict set once, the picked
    capture source, and the durable geolocator credit. Tags the import already
    put on the row survive."""
    draft = _draft(db, author, tags=[free_tag])

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(draft, capture_source_tag.id)]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "published": 1,
        "failed": 0,
        "rows": [
            {"event_id": str(draft.id), "published": True, "code": None, "message": None},
        ],
    }

    db.expire_all()
    row = db.query(Event).filter(Event.id == draft.id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.geolocated_at is not None
    assert [c.id for c in row.conflicts] == [conflict.id]
    assert {t.id for t in row.tags} == {capture_source_tag.id, free_tag.id}
    credit = (
        db.query(EventGeolocator)
        .filter(EventGeolocator.event_id == draft.id, EventGeolocator.user_id == author.id)
        .first()
    )
    assert credit is not None


def test_batch_complete_replaces_an_imported_capture_source(
    db, author, conflict, capture_source_tag
):
    """Capture source is single-valued, so the row's pick replaces whatever the
    import guessed rather than landing beside it."""
    from app.models.tag import Tag

    imported = Tag(name=f"capture-{uuid.uuid4().hex[:8]}", category="capture_source")
    db.add(imported)
    db.commit()
    imported_id = imported.id
    draft = _draft(db, author, tags=[imported])

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(draft, capture_source_tag.id)]),
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    row = db.query(Event).filter(Event.id == draft.id).one()
    assert {t.id for t in row.tags} == {capture_source_tag.id}
    row.tags = []
    db.commit()
    db.execute(Tag.__table__.delete().where(Tag.id == imported_id))
    db.commit()


def test_batch_complete_publishes_what_clears_the_floor(db, author, conflict, capture_source_tag):
    """The mixed selection: the ready rows publish, the one missing its proof
    image stays a draft carrying its reason, and neither outcome touches the
    other."""
    ready_one = _draft(db, author)
    ready_two = _draft(db, author)
    imageless = _draft(db, author, proof=_PROOF_TEXT_ONLY)

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(
            conflict,
            [
                (ready_one, capture_source_tag.id),
                (imageless, capture_source_tag.id),
                (ready_two, capture_source_tag.id),
            ],
        ),
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
    # The failed row is untouched: still a draft, still tagless.
    assert statuses[str(imageless.id)] == STATUS_DETECTED
    untouched = db.query(Event).filter(Event.id == imageless.id).one()
    assert untouched.tags == []
    assert untouched.conflicts == []


def test_batch_complete_reports_each_floor_miss_against_its_row(
    db, author, conflict, capture_source_tag, free_tag
):
    """One code per way a draft can miss the floor, each landing on its own row
    while the rest of the selection is unaffected."""
    no_media = _draft(db, author, with_media=False)
    no_source = _draft(db, author, source_url=None)
    wrong_tag = _draft(db, author)
    already_published = _make_geo(db, author=author)
    gone = uuid.uuid4()

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json={
            "conflict_ids": [str(conflict.id)],
            "rows": [
                {"event_id": str(no_media.id), "capture_source_tag_id": str(capture_source_tag.id)},
                {
                    "event_id": str(no_source.id),
                    "capture_source_tag_id": str(capture_source_tag.id),
                },
                # A free tag is not a capture source, so the row fails the same
                # floor an unknown tag id would.
                {"event_id": str(wrong_tag.id), "capture_source_tag_id": str(free_tag.id)},
                {
                    "event_id": str(already_published.id),
                    "capture_source_tag_id": str(capture_source_tag.id),
                },
                {"event_id": str(gone), "capture_source_tag_id": str(capture_source_tag.id)},
            ],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["published"], body["failed"]) == (0, 5)
    codes = {event_id: row["code"] for event_id, row in _by_id(body).items()}
    assert codes[str(no_media.id)] == "media_required"
    assert codes[str(no_source.id)] == "source_url_required"
    assert codes[str(wrong_tag.id)] == "tag_requirements_not_met"
    assert codes[str(already_published.id)] == "invalid_state"
    assert codes[str(gone)] == "event_not_found"


def test_batch_complete_reports_a_pointless_draft_as_coordinates_required(
    db, author, conflict, capture_source_tag
):
    """A draft the import could not place fails on absent coordinates, not
    malformed ones: the code is the ``*_required`` shape every other floor leg
    uses, so a client reads "this draft is missing a piece" rather than "the
    client sent a bad number"."""
    pointless = _draft(db, author)
    pointless.event_coords = None
    db.commit()

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(pointless, capture_source_tag.id)]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["published"], body["failed"]) == (0, 1)
    assert body["rows"][0]["code"] == "coordinates_required"

    db.expire_all()
    assert db.query(Event).filter(Event.id == pointless.id).one().status == STATUS_DETECTED


def test_batch_complete_rejects_a_draft_listed_twice(db, author, conflict, capture_source_tag):
    """One row per draft. The second occurrence could only ever fail (the first
    published the row), which would report a state error against a draft that
    did publish and inflate ``failed``; the shape is rejected instead."""
    draft = _draft(db, author)

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(draft, capture_source_tag.id), (draft, capture_source_tag.id)]),
    )
    assert response.status_code == 422

    db.expire_all()
    assert db.query(Event).filter(Event.id == draft.id).one().status == STATUS_DETECTED


def test_batch_complete_rejects_a_selection_without_a_conflict(db, author, capture_source_tag):
    """No conflict means no row could ever clear the floor, so the call fails
    whole rather than reporting the same miss N times."""
    draft = _draft(db, author)
    headers = login_as(client, author)

    empty = client.post(
        _URL,
        headers=headers,
        json={
            "conflict_ids": [],
            "rows": [
                {"event_id": str(draft.id), "capture_source_tag_id": str(capture_source_tag.id)}
            ],
        },
    )
    assert empty.status_code == 422

    unknown = client.post(
        _URL,
        headers=headers,
        json={
            "conflict_ids": [str(uuid.uuid4())],
            "rows": [
                {"event_id": str(draft.id), "capture_source_tag_id": str(capture_source_tag.id)}
            ],
        },
    )
    assert unknown.status_code == 400
    assert unknown.json()["detail"]["code"] == "tag_requirements_not_met"

    db.expire_all()
    assert db.query(Event).filter(Event.id == draft.id).one().status == STATUS_DETECTED


def test_batch_complete_refuses_another_analysts_draft_before_publishing_any(
    db, author, second_user, conflict, capture_source_tag
):
    """Ownership fails the whole call, and it fails it BEFORE the first commit:
    a selection reaching for someone else's draft publishes nothing at all."""
    mine = _draft(db, author)
    theirs = _draft(db, second_user)

    response = client.post(
        _URL,
        headers=login_as(client, author),
        json=_body(conflict, [(mine, capture_source_tag.id), (theirs, capture_source_tag.id)]),
    )
    assert response.status_code == 403

    db.expire_all()
    assert db.query(Event).filter(Event.id == mine.id).one().status == STATUS_DETECTED
    assert db.query(Event).filter(Event.id == theirs.id).one().status == STATUS_DETECTED
