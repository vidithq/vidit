"""The v0.4 gold-path integration pass: the curated-onboarding seam end to end.

Every hop below has its own unit suite (registration, archive intake, the
detection spine, the owner flow, the read surfaces); this test pins the
handoffs between them, driving only public HTTP endpoints:

register → confirm (signed in) → archive upload → a ``detected`` row lands
(media persisted + hashed, proof body set, ``detected_from_url`` provenance)
→ rendered marked on every read surface (list, detail, map points, the
owner's detections queue) → the owner geolocates over the evidence floor →
the row freezes ``geolocated``, unmarks, and is anonymously visible.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile

import pytest

from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.pending_registration import PendingRegistration
from app.routers import auth as auth_router
from app.services import email
from app.services.auth_cookies import CSRF_COOKIE, CSRF_HEADER
from tests._fixtures import TINY_JPEG
from tests.events._helpers import client, proof_file_part, proof_form_field
from tests.events.conftest import _delete_user_and_events

# One geo tweet shaped like a real export entry: a parseable coordinate in the
# text plus one photo. The archive's own media is annotation, so it lands as a
# hashed ``proof`` row; the tweet declares no source, so ``source_url`` stays
# NULL until the owner supplies one at geolocate (the honest source contract).
_TWEET_ID = "9001"
_TWEETS_JS = (
    "window.YTD.tweets.part0 = "
    + json.dumps(
        [
            {
                "tweet": {
                    "id_str": _TWEET_ID,
                    "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                    "full_text": "Strike on the depot 48.213000, 37.512000",
                    "extended_entities": {
                        "media": [
                            {
                                "type": "photo",
                                "id_str": "91",
                                "media_url_https": "https://pbs.twimg.com/media/GOLD1.jpg",
                            }
                        ]
                    },
                }
            }
        ]
    )
).encode()


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def email_recorder(monkeypatch):
    sent: list[email.Email] = []
    monkeypatch.setattr(auth_router.email, "send", sent.append)
    return sent


@pytest.fixture
def invite_code(db):
    row = InviteCode(code=f"gold-invite-{uuid.uuid4().hex}")
    db.add(row)
    db.commit()
    yield row
    db.query(PendingRegistration).filter(PendingRegistration.invite_code_id == row.id).delete()
    db.delete(row)
    db.commit()


def _extract_token(text: str) -> str:
    marker = "?token="
    idx = text.index(marker) + len(marker)
    end = idx
    while end < len(text) and not text[end].isspace():
        end += 1
    return text[idx:end]


def test_gold_path_register_import_geolocate_publish(
    db, email_recorder, invite_code, conflict, capture_source_tag
):
    handle = f"gold{uuid.uuid4().hex[:8]}"
    user_id = None
    try:
        # ── 1. Register + confirm through the real endpoints ────────────
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "username": handle,
                "email": f"{handle}@example.com",
                "password": "validpass123",
                "invite_code": invite_code.code,
            },
        )
        assert registered.status_code == 202, registered.text
        confirmed = client.post(
            "/api/v1/auth/confirm-registration",
            json={"token": _extract_token(email_recorder[-1].text)},
        )
        assert confirmed.status_code == 200, confirmed.text
        user_id = uuid.UUID(confirmed.json()["id"])
        # Confirm signs the analyst in: the session + CSRF cookies are on the
        # jar; mutating calls echo the CSRF cookie as the double-submit header.
        auth_headers = {CSRF_HEADER: client.cookies[CSRF_COOKIE]}

        # ── 2. Upload the archive; a detected draft lands ───────────────
        archive = _zip_bytes(
            {
                "tweets.js": _TWEETS_JS,
                f"tweets_media/{_TWEET_ID}-GOLD1.jpg": TINY_JPEG,
                "account.js": b"never read",
            }
        )
        imported = client.post(
            "/api/v1/events/import-archive",
            headers=auth_headers,
            files={"file": ("archive.zip", archive, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        assert imported.json() == {"created": 1, "skipped": 0, "recreated": 0, "failed": 0}

        row = db.query(Event).filter(Event.owner_id == user_id).one()
        assert row.status == STATUS_DETECTED
        assert row.detected_from_url == f"https://x.com/{handle}/status/{_TWEET_ID}"
        assert row.source_url is None  # the tweet declared no source
        assert row.proof is not None  # the tweet text became the proof body
        media = db.query(Media).filter(Media.event_id == row.id).all()
        assert [(m.role, m.media_type) for m in media] == [("proof", "image")]
        assert media[0].sha256  # content-hashed at persist
        event_id = str(row.id)

        # ── 3. Marked ``detected`` on every read surface ────────────────
        listed = {r["id"]: r for r in client.get("/api/v1/events").json()}
        assert listed[event_id]["status"] == STATUS_DETECTED

        detail = client.get(f"/api/v1/events/{event_id}")
        assert detail.status_code == 200
        assert detail.json()["status"] == STATUS_DETECTED
        assert detail.json()["detected_from_url"] == row.detected_from_url

        points = {p[0]: p for p in client.get("/api/v1/events/points").json()}
        assert points[event_id][5] == 1  # the ``detected`` marker flag

        queue = client.get("/api/v1/events/detections", headers=auth_headers)
        assert event_id in {r["id"] for r in queue.json()["items"]}

        # ── 4. The owner geolocates over the evidence floor ─────────────
        geolocated = client.post(
            f"/api/v1/events/{event_id}/geolocate",
            data={
                "title": "Depot strike, verified",
                "lat": "48.213",
                "lng": "37.512",
                "source_url": f"https://x.com/{handle}/status/{_TWEET_ID}",
                "event_date": "2025-11-12",
                "source_posted_at": "2025-11-12T14:33",
                "proof": proof_form_field(),
                "tag_ids": json.dumps([str(capture_source_tag.id)]),
                "conflict_ids": json.dumps([str(conflict.id)]),
            },
            files=[
                ("files", ("footage.jpg", TINY_JPEG, "image/jpeg")),
                proof_file_part(),
            ],
            headers=auth_headers,
        )
        assert geolocated.status_code == 200, geolocated.text
        body = geolocated.json()
        assert body["status"] == STATUS_GEOLOCATED
        assert body["geolocated_at"] is not None
        assert [g["username"] for g in body["geolocators"]] == [handle]

        # Frozen: a second geolocate 409s.
        frozen = client.post(
            f"/api/v1/events/{event_id}/geolocate",
            data={
                "title": "x",
                "lat": "1",
                "lng": "1",
                "source_url": "https://example.com/s",
                "event_date": "2025-11-12",
                "source_posted_at": "2025-11-12T14:33",
            },
            headers=auth_headers,
        )
        assert frozen.status_code == 409

        # ── 5. Unmarked and publicly visible, signed out ────────────────
        client.cookies.clear()
        points = {p[0]: p for p in client.get("/api/v1/events/points").json()}
        assert points[event_id][5] == 0  # marker gone
        public = client.get(f"/api/v1/events/{event_id}")
        assert public.status_code == 200
        assert public.json()["status"] == STATUS_GEOLOCATED
    finally:
        client.cookies.clear()
        if user_id is not None:
            # The confirm stamped ``used_by``; detach it so the user row (and
            # everything hanging off it) can go, then the fixture drops the
            # invite itself.
            db.query(InviteCode).filter(InviteCode.used_by == user_id).update(
                {InviteCode.used_by: None}, synchronize_session=False
            )
            db.commit()
            _delete_user_and_events(db, user_id)
