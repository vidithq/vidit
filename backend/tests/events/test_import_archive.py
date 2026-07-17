"""Endpoint + worker tests for the ``import-archive`` job pipeline.

``POST /geolocations/import-archive`` now stages the zip and returns a
``queued`` job (202); the worker (``services/archive_jobs``) claims it and
drives the real backfill (extract guard → read_tweets → stitch → detect →
assemble). Tests drain the queue inline with ``run_once``, so the whole
seam runs synchronously. The happy-path tweet carries a coordinate but no
media, so a ``detected`` row lands with zero S3 work.
"""

from __future__ import annotations

import asyncio
import io
import uuid
import zipfile

import pytest

from app.models.archive_import_job import ArchiveImportJob
from app.models.event import STATUS_CLOSED, STATUS_DETECTED, Event
from app.services import archive_jobs
from app.services.storage import get_storage
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


@pytest.fixture(autouse=True)
def _clean_jobs(db):
    yield
    db.query(ArchiveImportJob).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def sent_emails(monkeypatch):
    sent = []
    monkeypatch.setattr(archive_jobs.email, "send", sent.append)
    return sent


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


def _drain(db) -> int:
    return asyncio.run(archive_jobs.run_once(db))


def _import(author, db, zip_bytes: bytes) -> dict:
    """Enqueue + drain + return the terminal job payload, as the panel sees it."""
    accepted = _post(author, zip_bytes)
    assert accepted.status_code == 202, accepted.text
    job_id = accepted.json()["id"]
    assert _drain(db) == 1
    polled = client.get(f"/api/v1/events/import-archive/{job_id}", headers=login_as(client, author))
    assert polled.status_code == 200
    return polled.json()


def _counts(job: dict) -> dict:
    return {k: job[k] for k in ("created", "skipped", "recreated", "failed")}


# ── The endpoint: enqueue + poll ────────────────────────────────────────────


def test_upload_returns_queued_job_and_stages_the_zip(db, author):
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS, "account.js": b"private"}))
    assert accepted.status_code == 202, accepted.text
    body = accepted.json()
    assert body["status"] == "queued"
    assert _counts(body) == {"created": 0, "skipped": 0, "recreated": 0, "failed": 0}

    job = db.get(ArchiveImportJob, uuid.UUID(body["id"]))
    assert job is not None and job.owner_id == author.id
    # The zip is staged for the worker under the job's key.
    assert get_storage().get_bytes(job.zip_key)


def test_job_poll_is_owner_only(db, author, second_user):
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    job_id = accepted.json()["id"]
    other = client.get(
        f"/api/v1/events/import-archive/{job_id}", headers=login_as(client, second_user)
    )
    assert other.status_code == 404  # indistinguishable from unknown


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


# ── The worker: backfill + terminal states + email ──────────────────────────


def test_import_creates_detected_rows_owned_by_caller(db, author, sent_emails):
    job = _import(author, db, _zip_bytes({"tweets.js": _TWEETS, "account.js": b"private"}))
    assert job["status"] == "done"
    assert _counts(job) == {"created": 1, "skipped": 0, "recreated": 0, "failed": 0}

    rows = db.query(Event).filter(Event.owner_id == author.id).all()
    assert len(rows) == 1
    assert rows[0].status == "detected"
    assert rows[0].detected_from_url  # provenance link set

    # The owner got the completion email; the staged zip is gone.
    assert [e.subject for e in sent_emails] == ["Your X archive import is done"]
    assert author.email == sent_emails[0].to
    with pytest.raises(FileNotFoundError):
        get_storage().get_bytes(archive_jobs.staging_key(uuid.UUID(job["id"])))


def test_reimport_is_idempotent(db, author, sent_emails):
    zip_bytes = _zip_bytes({"tweets.js": _TWEETS})
    assert _counts(_import(author, db, zip_bytes))["created"] == 1
    # Same archive again: the pair already lives, so nothing new is created.
    second = _import(author, db, zip_bytes)
    assert _counts(second) == {"created": 0, "skipped": 1, "recreated": 0, "failed": 0}


def test_reimport_recreates_after_the_detection_is_closed_through_the_api(db, author, sent_emails):
    """The full owner-facing loop, both halves through their real endpoints:
    import once, reject the resulting detection with the real
    ``POST /{id}/close``, then re-run the same archive. A closed detection
    (``before_closed_status='detected'``) is a dismissed pair, so the
    re-import recreates a fresh live row instead of skipping it.
    """
    zip_bytes = _zip_bytes({"tweets.js": _TWEETS})
    first = _import(author, db, zip_bytes)
    assert _counts(first) == {"created": 1, "skipped": 0, "recreated": 0, "failed": 0}

    detected = db.query(Event).filter(Event.owner_id == author.id).one()
    assert detected.status == STATUS_DETECTED

    close_response = client.post(
        f"/api/v1/events/{detected.id}/close",
        headers=login_as(client, author),
        json={"close_reason": "Bot misread the coordinates"},
    )
    assert close_response.status_code == 200, close_response.text
    assert close_response.json()["before_closed_status"] == STATUS_DETECTED

    second = _import(author, db, zip_bytes)
    assert _counts(second) == {"created": 1, "skipped": 0, "recreated": 1, "failed": 0}

    db.expire_all()
    rows = db.query(Event).filter(Event.owner_id == author.id).order_by(Event.created_at).all()
    assert len(rows) == 2
    # The original stays exactly as the close left it: visible, closed,
    # dismissed-as-detected. The re-import didn't touch it.
    assert rows[0].id == detected.id
    assert rows[0].status == STATUS_CLOSED
    assert rows[0].before_closed_status == STATUS_DETECTED
    # The recreated row is a fresh, live detection at the same coordinate pair.
    assert rows[1].status == STATUS_DETECTED
    assert rows[1].detected_from_url == detected.detected_from_url


def test_failed_run_lands_failed_and_notifies(db, author, sent_emails, monkeypatch):
    async def _boom(*args, **kwargs):
        raise RuntimeError("backfill exploded")

    monkeypatch.setattr(archive_jobs, "backfill_from_archive", _boom)
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    assert _drain(db) == 1

    job = db.get(ArchiveImportJob, uuid.UUID(accepted.json()["id"]))
    db.refresh(job)
    assert job.status == "failed"
    assert "RuntimeError" in (job.error or "")
    assert [e.subject for e in sent_emails] == ["Your X archive import failed"]
    # Failed jobs release their staged zip too.
    with pytest.raises(FileNotFoundError):
        get_storage().get_bytes(job.zip_key)


def test_worker_reclaims_stale_running_job_and_caps_attempts(db, author, sent_emails):
    """A worker death leaves ``running``: past the stale window the job is
    claimable again, and once the attempt budget is spent it lands ``failed``
    instead of looping forever (the poison-pill guard)."""
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    job = db.get(ArchiveImportJob, uuid.UUID(accepted.json()["id"]))

    from datetime import UTC, datetime

    stale = datetime.now(UTC) - archive_jobs.STALE_RUNNING_AFTER * 2
    job.status = "running"
    job.started_at = stale
    job.attempts = 1
    db.commit()

    claimed = archive_jobs.claim_next(db)
    assert claimed is not None and claimed.id == job.id
    assert claimed.attempts == 2

    # Burn the budget: a job stuck at MAX_ATTEMPTS is failed, not re-claimed.
    claimed.status = "running"
    claimed.started_at = stale
    claimed.attempts = archive_jobs.MAX_ATTEMPTS
    db.commit()
    assert archive_jobs.claim_next(db) is None
    db.refresh(job)
    assert job.status == "failed"
    assert job.error == "attempt budget spent"
    assert [e.subject for e in sent_emails] == ["Your X archive import failed"]
