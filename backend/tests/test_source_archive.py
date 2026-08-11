"""Tests for the source-archival queue.

Every archiving call is served through ``httpx.MockTransport``, so no test
touches web.archive.org. The pass pacing and the status poll are patched to
zero where they would otherwise dominate the runtime; the scheduling arithmetic
they guard is asserted directly instead.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.exc import OperationalError

from app.database import SessionLocal
from app.models.event import STATUS_DETECTED, Event
from app.models.source_archive import SourceArchive
from app.models.user import User
from app.services import source_archive
from app.services.auth import hash_password
from app.services.sanitize import extract_link_hrefs

SOURCE = "https://x.com/analyst/status/1234567890"
PROOF_LINK = "https://example.org/report"
CAPTURE_TS = "20260811120000"


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def owner(db):
    user = User(
        username=f"arc{uuid.uuid4().hex[:8]}",
        email=f"arc-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _proof_doc(*hrefs: str) -> dict:
    """A Tiptap document whose paragraph carries one link mark per href."""
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "see this",
                        "marks": [{"type": "link", "attrs": {"href": href}}],
                    }
                    for href in hrefs
                ],
            }
        ],
    }


@pytest.fixture
def event(db, owner):
    row = Event(
        owner_id=owner.id,
        title="Archived event",
        source_url=SOURCE,
        proof=_proof_doc(PROOF_LINK),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    yield row
    db.expire_all()
    db.query(Event).filter(Event.id == row.id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture(autouse=True)
def _deterministic_pacing_and_providers(db, monkeypatch):
    """Collapse the wall-clock waits, pin the providers, empty the queue.

    ``REQUEST_SPACING`` and the status-poll interval only exist to stay under a
    rate ceiling; the tests assert the scheduling values rather than sit
    through them. The credential pair and the archive.today leg are pinned to
    their defaults so a populated local ``.env`` cannot change what a test
    exercises. The queue starts empty because ``claim_next`` claims the oldest
    runnable row in the whole table: rows another module's event write left
    behind would otherwise be what a claim assertion here sees.
    """
    monkeypatch.setattr(source_archive, "REQUEST_SPACING", timedelta(0))
    monkeypatch.setattr(source_archive, "_STATUS_POLL_INTERVAL_S", 0)
    monkeypatch.setattr(source_archive.settings, "archive_org_access_key", "")
    monkeypatch.setattr(source_archive.settings, "archive_org_secret_key", "")
    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", False)
    db.query(SourceArchive).delete(synchronize_session=False)
    db.commit()


def _spn_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _success_handler(request: httpx.Request) -> httpx.Response:
    """Save Page Now's two-leg happy path: submit answers a job, poll succeeds."""
    if request.url.path == "/save":
        return httpx.Response(200, json={"job_id": "job-1"})
    return httpx.Response(
        200,
        json={
            "status": "success",
            "timestamp": CAPTURE_TS,
            "original_url": SOURCE,
        },
    )


# ── link collection ────────────────────────────────────────────────────


def test_extract_link_hrefs_reads_link_marks_and_dedupes():
    doc = _proof_doc(PROOF_LINK, PROOF_LINK, "https://other.example/a")
    assert extract_link_hrefs(doc) == [PROOF_LINK, "https://other.example/a"]


def test_extract_link_hrefs_drops_non_http_schemes():
    assert extract_link_hrefs(_proof_doc("javascript:alert(1)")) == []


def test_collect_links_orders_source_first_and_tags_origin(event):
    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (PROOF_LINK, "proof_link"),
    ]


def test_collect_links_attributes_a_shared_link_to_the_source(db, owner):
    row = Event(
        owner_id=owner.id,
        title="Self-citing",
        source_url=SOURCE,
        proof=_proof_doc(SOURCE),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    assert source_archive.collect_links(row) == [(SOURCE, "source_url")]


# ── enqueue ────────────────────────────────────────────────────────────


def test_enqueue_event_inserts_one_row_per_link(db, event):
    assert source_archive.enqueue_event(db, event) == 2
    rows = db.query(SourceArchive).filter(SourceArchive.event_id == event.id).all()
    assert {r.original_url for r in rows} == {SOURCE, PROOF_LINK}
    assert {r.status for r in rows} == {"queued"}
    assert all(r.archived_url is None for r in rows)


def test_enqueue_event_is_idempotent(db, event):
    source_archive.enqueue_event(db, event)
    assert source_archive.enqueue_event(db, event) == 0
    assert db.query(SourceArchive).filter(SourceArchive.event_id == event.id).count() == 2


def test_enqueue_event_picks_up_a_link_added_later(db, event):
    source_archive.enqueue_event(db, event)
    event.proof = _proof_doc(PROOF_LINK, "https://added.example/late")
    db.commit()
    assert source_archive.enqueue_event(db, event) == 1
    assert db.query(SourceArchive).filter(SourceArchive.event_id == event.id).count() == 3


def test_enqueue_event_best_effort_swallows_a_database_failure(db, event, monkeypatch):
    """A durable event write must not 500 because the queue insert failed."""

    def boom(*_args, **_kwargs):
        raise OperationalError("insert", {}, Exception("connection lost"))

    monkeypatch.setattr(source_archive, "enqueue_event", boom)
    source_archive.enqueue_event_best_effort(db, event)
    assert db.query(SourceArchive).filter(SourceArchive.event_id == event.id).count() == 0


def test_enqueue_catalog_covers_an_event_written_before_archival(db, event):
    result = source_archive.enqueue_catalog(db)
    assert result["links_enqueued"] >= 2
    assert (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.original_url == SOURCE)
        .count()
        == 1
    )


# ── claim ──────────────────────────────────────────────────────────────


def test_claim_next_skips_a_row_still_inside_its_backoff(db, event):
    source_archive.enqueue_event(db, event)
    db.query(SourceArchive).filter(SourceArchive.event_id == event.id).update(
        {"next_attempt_at": datetime.now(UTC) + timedelta(hours=1)},
        synchronize_session=False,
    )
    db.commit()
    assert source_archive.claim_next(db) is None
    still_queued = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.status == "queued")
        .count()
    )
    assert still_queued == 2


def test_claim_next_stamps_running_and_counts_the_attempt(db, event):
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    assert row is not None
    assert row.status == "running"
    assert row.attempts == 1
    assert row.started_at is not None


# ── capture ────────────────────────────────────────────────────────────


def test_capture_returns_the_wayback_replay_url():
    with _spn_client(_success_handler) as client:
        provider, url = source_archive.capture(SOURCE, client=client)
    assert provider == "wayback"
    assert url == f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"


def test_capture_uses_an_inline_existing_snapshot_without_polling():
    """A submit that answers with a capture directly costs no status poll."""
    polled = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/save":
            polled.append(request.url.path)
        return httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})

    with _spn_client(handler) as client:
        _, url = source_archive.capture(SOURCE, client=client)
    assert url.endswith(SOURCE)
    assert polled == []


def test_capture_raises_on_rate_limit():
    with (
        _spn_client(lambda _r: httpx.Response(429, text="slow down")) as client,
        pytest.raises(source_archive.ArchiveUnavailableError, match="rate limited"),
    ):
        source_archive.capture(SOURCE, client=client)


def test_capture_raises_when_the_job_reports_an_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/save":
            return httpx.Response(200, json={"job_id": "job-1"})
        return httpx.Response(200, json={"status": "error", "message": "robots blocked"})

    with (
        _spn_client(handler) as client,
        pytest.raises(source_archive.ArchiveUnavailableError, match="robots blocked"),
    ):
        source_archive.capture(SOURCE, client=client)


def test_capture_sends_the_key_pair_when_configured(monkeypatch):
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})

    monkeypatch.setattr(source_archive.settings, "archive_org_access_key", "KEY")
    monkeypatch.setattr(source_archive.settings, "archive_org_secret_key", "SECRET")
    with _spn_client(handler) as client:
        source_archive.capture(SOURCE, client=client)
    assert seen["authorization"] == "LOW KEY:SECRET"


def test_capture_falls_back_to_archive_today_only_when_enabled(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            return httpx.Response(503)
        return httpx.Response(302, headers={"Refresh": f"0; url=https://archive.ph/abcde/{SOURCE}"})

    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", False)
    with (
        _spn_client(handler) as client,
        pytest.raises(source_archive.ArchiveUnavailableError),
    ):
        source_archive.capture(SOURCE, client=client)

    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", True)
    with _spn_client(handler) as client:
        provider, url = source_archive.capture(SOURCE, client=client)
    assert provider == "archive_today"
    assert url.startswith("https://archive.ph/")


# ── process + retry policy ─────────────────────────────────────────────


def test_process_stamps_the_archived_url(db, event):
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    with _spn_client(_success_handler) as client:
        assert source_archive.process(db, row, client=client) is True
    db.refresh(row)
    assert row.status == "done"
    assert row.provider == "wayback"
    assert row.archived_url == f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"
    assert row.finished_at is not None


def test_process_reschedules_a_failure_with_backoff(db, event):
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    before = datetime.now(UTC)
    with _spn_client(lambda _r: httpx.Response(429)) as client:
        assert source_archive.process(db, row, client=client) is False
    db.refresh(row)
    assert row.status == "queued"
    assert row.archived_url is None
    assert row.error == "rate limited"
    assert row.next_attempt_at >= before + source_archive.BASE_BACKOFF


def test_process_buries_a_row_once_the_attempt_budget_is_spent(db, event):
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    row.attempts = source_archive.MAX_ATTEMPTS
    db.commit()
    with _spn_client(lambda _r: httpx.Response(503)) as client:
        source_archive.process(db, row, client=client)
    db.refresh(row)
    assert row.status == "failed"
    assert row.finished_at is not None


def test_process_reschedules_a_transport_error(db, event):
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    with _spn_client(handler) as client:
        assert source_archive.process(db, row, client=client) is False
    db.refresh(row)
    assert row.status == "queued"
    assert row.error.startswith("transport:")


def test_backoff_grows_and_is_capped():
    assert source_archive._backoff(1) == source_archive.BASE_BACKOFF
    assert source_archive._backoff(2) == source_archive.BASE_BACKOFF * 2
    assert source_archive._backoff(99) == source_archive.MAX_BACKOFF


# ── drain ──────────────────────────────────────────────────────────────


def test_run_once_stops_at_the_pass_budget(db, event):
    source_archive.enqueue_event(db, event)
    with _spn_client(_success_handler) as client:
        assert source_archive.run_once(db, budget=1, client=client) == 1
    done = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.status == "done")
        .count()
    )
    assert done == 1


def test_archived_url_for_matches_the_original(db, event):
    source_archive.enqueue_event(db, event)
    row = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.original_url == SOURCE)
        .one()
    )
    assert source_archive.archived_url_for(event, SOURCE) is None
    row.status = "done"
    row.archived_url = "https://web.archive.org/web/x/y"
    db.commit()
    db.refresh(event)
    assert source_archive.archived_url_for(event, SOURCE) == "https://web.archive.org/web/x/y"
    assert source_archive.archived_url_for(event, PROOF_LINK) is None
    assert source_archive.archived_url_for(event, None) is None
