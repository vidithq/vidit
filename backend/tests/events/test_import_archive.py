"""Endpoint + worker tests for the ``import-archive`` job pipeline.

The upload is presigned direct-to-storage: ``POST /import-archive/presign``
mints the key, the client POSTs the zip to the returned URL (the dev upload
endpoint against ``LocalStorage``, standing in for S3's POST policy), and the
JSON ``POST /import-archive`` verifies the staged object and returns a
``queued`` job (202); the worker (``services/archive_jobs``) claims it and
drives the real backfill (extract guard → read_tweets → stitch → detect →
assemble). Tests drain the queue inline with ``run_once``, so the whole
seam runs synchronously. The happy-path tweet carries a coordinate but no
media, so a ``detected`` row lands with zero S3 work.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import uuid
import zipfile

import pytest

from app.main import app
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


def _presign(author) -> dict:
    resp = client.post("/api/v1/events/import-archive/presign", headers=login_as(client, author))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _upload(author, presign: dict, zip_bytes: bytes):
    """POST the zip to the presigned target, as the browser would (fields
    first, then the file). The URL is absolute (the browser needs it); the
    TestClient takes its path."""
    path = presign["upload"]["url"].removeprefix("http://localhost:8000")
    return client.post(
        path,
        headers=login_as(client, author),
        data=presign["upload"]["fields"],
        files={"file": ("archive.zip", zip_bytes, "application/zip")},
    )


def _enqueue(author, upload_key: str, post_estimate: int | None = 3):
    return client.post(
        "/api/v1/events/import-archive",
        headers=login_as(client, author),
        json={"upload_key": upload_key, "post_estimate": post_estimate},
    )


def _post(author, zip_bytes: bytes):
    """The whole two-step client flow: presign → direct upload → JSON enqueue."""
    presign = _presign(author)
    uploaded = _upload(author, presign, zip_bytes)
    assert uploaded.status_code == 204, uploaded.text
    return _enqueue(author, presign["upload_key"])


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


# ── The endpoints: presign + upload + enqueue + poll ───────────────────────


def test_presign_mints_owner_bound_key_and_upload_target(author):
    presign = _presign(author)
    key = presign["upload_key"]
    assert key.startswith(f"{archive_jobs.STAGING_PREFIX}{author.id}/")
    assert key.endswith(".zip")
    assert archive_jobs.is_staging_key(key)
    # The upload half carries the URL + the form fields the browser must POST
    # ahead of the file; against LocalStorage the fields pin the same key.
    assert presign["upload"]["url"]
    assert presign["upload"]["fields"]["key"] == key
    assert presign["upload"]["fields"]["Content-Type"] == "application/zip"


def test_presign_requires_auth():
    assert client.post("/api/v1/events/import-archive/presign").status_code == 401


def test_presign_is_rate_limited(author):
    # conftest's autouse fixture disables the limiter; re-enable it for the
    # wiring check (10/hour on presign: the 11th call in the window is a 429).
    limiter = app.state.limiter
    limiter.reset()
    limiter.enabled = True
    try:
        headers = login_as(client, author)
        for _ in range(10):
            assert (
                client.post("/api/v1/events/import-archive/presign", headers=headers).status_code
                == 200
            )
        assert (
            client.post("/api/v1/events/import-archive/presign", headers=headers).status_code == 429
        )
    finally:
        limiter.enabled = False
        limiter.reset()


def test_enqueue_returns_queued_job_for_staged_upload(db, author):
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS, "account.js": b"private"}))
    assert accepted.status_code == 202, accepted.text
    body = accepted.json()
    assert body["status"] == "queued"
    assert body["post_estimate"] == 3  # the client-supplied strip estimate
    assert _counts(body) == {"created": 0, "skipped": 0, "recreated": 0, "failed": 0}

    job = db.get(ArchiveImportJob, uuid.UUID(body["id"]))
    assert job is not None and job.owner_id == author.id
    # The staged object is where the job row points.
    assert get_storage().get_bytes(job.zip_key)


def test_job_poll_is_owner_only(db, author, second_user):
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    job_id = accepted.json()["id"]
    other = client.get(
        f"/api/v1/events/import-archive/{job_id}", headers=login_as(client, second_user)
    )
    assert other.status_code == 404  # indistinguishable from unknown


def test_enqueue_requires_auth():
    resp = client.post(
        "/api/v1/events/import-archive",
        json={"upload_key": "archive-imports/x/y.zip", "post_estimate": 1},
    )
    assert resp.status_code == 401


def test_enqueue_rejects_key_with_no_staged_object(author):
    presign = _presign(author)  # minted but never uploaded
    resp = _enqueue(author, presign["upload_key"])
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "archive_upload_missing"


def test_enqueue_rejects_oversized_staged_object(author, monkeypatch):
    key = archive_jobs.mint_staging_key(author.id)
    get_storage().put_bytes_sync(_zip_bytes({"tweets.js": _TWEETS}), key, "application/zip")
    monkeypatch.setattr(archive_zip, "MAX_UPLOAD_BYTES", 10)
    resp = _enqueue(author, key)
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "archive_too_large"


def test_enqueue_rejects_foreign_and_malformed_keys(author, second_user):
    # Someone else's staged object: minted + uploaded by second_user, enqueued
    # by author.
    presign = _presign(second_user)
    assert _upload(second_user, presign, _zip_bytes({"tweets.js": _TWEETS})).status_code == 204
    resp = _enqueue(author, presign["upload_key"])
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "archive_upload_invalid"

    # Arbitrary bucket keys and traversal shapes never reach storage.
    for key in ("../../etc/passwd", "uploads/anything.zip", f"archive-imports/{author.id}.zip"):
        resp = _enqueue(author, key)
        assert resp.status_code == 400, key
        assert resp.json()["detail"]["code"] == "archive_upload_invalid"


def test_dev_upload_rejects_non_staging_key(author):
    presign = _presign(author)
    presign["upload"]["fields"]["key"] = "uploads/escape.zip"
    resp = _upload(author, presign, _zip_bytes({"tweets.js": _TWEETS}))
    assert resp.status_code == 400


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
    row = db.get(ArchiveImportJob, uuid.UUID(job["id"]))
    with pytest.raises(FileNotFoundError):
        get_storage().get_bytes(row.zip_key)


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


def test_malformed_staged_zip_fails_in_the_worker(db, author, sent_emails):
    """Zip-shape validation moved off the enqueue (the endpoint never opens
    the staged object): a non-zip upload lands as a ``failed`` job + the
    failure email, not a synchronous 4xx."""
    accepted = _post(author, b"not a zip at all")
    assert accepted.status_code == 202
    assert _drain(db) == 1

    job = db.get(ArchiveImportJob, uuid.UUID(accepted.json()["id"]))
    db.refresh(job)
    assert job.status == "failed"
    assert job.error == "MalformedArchiveError"
    assert [e.subject for e in sent_emails] == ["Your X archive import failed"]


def test_worker_fails_job_whose_staged_object_vanished(db, author, sent_emails):
    """The claim-time guard: an object deleted (or never re-verifiable)
    between enqueue and claim fails the job cleanly instead of raising out
    of the download."""
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    job = db.get(ArchiveImportJob, uuid.UUID(accepted.json()["id"]))
    get_storage().delete_many([job.zip_key])

    assert _drain(db) == 1
    db.refresh(job)
    assert job.status == "failed"
    assert job.error == "staged object missing"
    assert [e.subject for e in sent_emails] == ["Your X archive import failed"]


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


def test_worker_heartbeat_restamps_started_at(db, author, sent_emails, monkeypatch):
    """While a job runs, the worker re-stamps ``started_at`` so a legitimately
    long import never crosses the stale-reclaim window (and a second worker
    can't double-run it)."""
    from datetime import timedelta

    monkeypatch.setattr(archive_jobs, "HEARTBEAT_INTERVAL", timedelta(milliseconds=10))

    async def _slow_backfill(*args, **kwargs):
        await asyncio.sleep(0.08)  # several heartbeat ticks
        raise RuntimeError("stop after heartbeats")

    monkeypatch.setattr(archive_jobs, "backfill_from_archive", _slow_backfill)
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    job = db.get(ArchiveImportJob, uuid.UUID(accepted.json()["id"]))

    claimed_at = None

    async def _run():
        nonlocal claimed_at
        claimed = archive_jobs.claim_next(db)
        claimed_at = claimed.started_at
        with contextlib.suppress(RuntimeError):
            await archive_jobs.process(db, claimed)

    asyncio.run(_run())
    db.expire_all()
    refreshed = db.get(ArchiveImportJob, job.id)
    assert refreshed.started_at is not None and claimed_at is not None
    assert refreshed.started_at > claimed_at


def test_job_carries_estimate_and_live_progress(db, author, sent_emails):
    """The enqueue stamps the zip-metadata post estimate; the worker stamps
    the exact scan position (done / total) as rows land, so the upload
    page's poll can render live progress."""
    accepted = _post(author, _zip_bytes({"tweets.js": _TWEETS}))
    body = accepted.json()
    assert body["post_estimate"] >= 1
    assert body["progress_done"] == 0 and body["progress_total"] is None

    assert _drain(db) == 1
    polled = client.get(
        f"/api/v1/events/import-archive/{body['id']}", headers=login_as(client, author)
    ).json()
    assert polled["status"] == "done"
    # One geo tweet: the scan is 1 / 1 at the end.
    assert polled["progress_done"] == 1
    assert polled["progress_total"] == 1
