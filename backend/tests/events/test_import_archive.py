"""Endpoint tests for ``POST /geolocations/import-archive``.

Drives the real backfill (extract guard → read_tweets → stitch → detect →
assemble) over a tiny in-memory zip. The happy-path tweet carries a coordinate
but no media, so a ``detected`` row lands with zero S3 work.
"""

from __future__ import annotations

import io
import zipfile

from app.models.event import Event
from app.services.tweet_ingest import archive_zip
from tests.conftest import login_as
from tests.events._helpers import client

# One geo tweet: a parseable coordinate, no media.
_TWEETS = (
    b"window.YTD.tweets.part0 = ["
    b'{"tweet": {"id_str": "1", '
    b'"full_text": "Strike at 48.012345, 37.802411", '
    b'"created_at": "Wed Nov 12 14:33:00 +0000 2025"}}]'
)


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _post(author, zip_bytes: bytes):
    return client.post(
        "/api/v1/events/import-archive",
        headers=login_as(client, author),
        files={"file": ("archive.zip", zip_bytes, "application/zip")},
    )


def test_import_creates_detected_rows_owned_by_caller(db, author):
    resp = _post(author, _zip_bytes({"tweets.js": _TWEETS, "account.js": b"private"}))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"created": 1, "skipped": 0, "recreated": 0, "failed": 0}

    rows = db.query(Event).filter(Event.author_id == author.id).all()
    assert len(rows) == 1
    assert rows[0].status == "detected"
    assert rows[0].detected_from_url  # provenance link set


def test_reimport_is_idempotent(db, author):
    zip_bytes = _zip_bytes({"tweets.js": _TWEETS})
    assert _post(author, zip_bytes).json()["created"] == 1
    # Same archive again: the pair already lives, so nothing new is created.
    second = _post(author, zip_bytes).json()
    assert second == {"created": 0, "skipped": 1, "recreated": 0, "failed": 0}


def test_requires_auth():
    resp = client.post(
        "/api/v1/events/import-archive",
        files={"file": ("a.zip", _zip_bytes({"tweets.js": _TWEETS}), "application/zip")},
    )
    assert resp.status_code == 401


def test_rejects_non_zip(author):
    resp = client.post(
        "/api/v1/events/import-archive",
        headers=login_as(client, author),
        files={"file": ("a.zip", b"not a zip at all", "application/zip")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "archive_malformed"


def test_rejects_archive_without_tweets(author):
    resp = _post(author, _zip_bytes({"account.js": b"x"}))
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "archive_no_tweets"


def test_rejects_oversize_upload(author, monkeypatch):
    monkeypatch.setattr(archive_zip, "MAX_UPLOAD_BYTES", 10)
    resp = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "archive_too_large"
