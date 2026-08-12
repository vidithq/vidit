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
from sqlalchemy.exc import IntegrityError, OperationalError

from app.database import SessionLocal
from app.models.event import SOURCE_URL_MAX_LENGTH, STATUS_DETECTED, Event, EventSourceLink
from app.models.source_archive import SourceArchive
from app.models.user import User
from app.services import source_archive
from app.services.auth import hash_password
from app.services.sanitize import extract_link_hrefs

SOURCE = "https://x.com/analyst/status/1234567890"
PROOF_LINK = "https://example.org/report"
MIRROR = "https://t.me/channel/42"
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


def _with_mirrors(db, event, *urls: str) -> Event:
    """Give an event the ordered secondary source links ``urls``."""
    event.source_links = [
        EventSourceLink(position=index, url=url) for index, url in enumerate(urls)
    ]
    db.commit()
    db.refresh(event)
    return event


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


def test_collect_links_drops_a_url_the_parse_refuses(db, owner):
    """A malformed URL is a link to skip, not a 500 on a committed write.

    ``urlparse`` raises on an unterminated IPv6 literal; a crafted
    ``source_url`` reaching the enqueue must not turn a durable event write
    into an error response.
    """
    row = Event(
        owner_id=owner.id,
        title="Malformed source",
        source_url="http://[::1",
        proof=_proof_doc("https://[fe80::1"),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    assert source_archive.collect_links(row) == []


def test_collect_links_drops_an_oversized_url(db, owner):
    """A href past the ``source_url`` column width would abort the insert that
    carries it, so it never enters the queue."""
    long_url = "https://example.org/" + "a" * SOURCE_URL_MAX_LENGTH
    assert (
        source_archive.collect_links(
            Event(owner_id=owner.id, title="Long href", proof=_proof_doc(long_url))
        )
        == []
    )


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


def test_collect_links_includes_the_secondary_source_links(db, event):
    """The analyst-submitted mirrors are evidence with the same link-rot risk
    as the primary source, so they queue too, tagged for where they came
    from."""
    _with_mirrors(db, event, MIRROR, "https://rumble.com/v-mirror")
    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (MIRROR, "secondary_source"),
        ("https://rumble.com/v-mirror", "secondary_source"),
        (PROOF_LINK, "proof_link"),
    ]


def test_collect_links_keeps_a_mirror_of_the_source_url_once(db, event):
    """A stored mirror equal to ``source_url`` is one link, attributed to the
    source: a second row would trip the unique constraint the enqueue paths
    rely on."""
    _with_mirrors(db, event, SOURCE, PROOF_LINK)
    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (PROOF_LINK, "secondary_source"),
    ]


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


def test_enqueue_event_queues_a_mirror_of_the_source_url_once(db, event):
    """Idempotency end to end: a mirror equal to the primary is one row, and a
    second enqueue neither duplicates it nor errors."""
    _with_mirrors(db, event, SOURCE, MIRROR)
    assert source_archive.enqueue_event(db, event) == 3
    assert source_archive.enqueue_event(db, event) == 0
    rows = db.query(SourceArchive).filter(SourceArchive.event_id == event.id).all()
    assert {(r.original_url, r.origin) for r in rows} == {
        (SOURCE, "source_url"),
        (MIRROR, "secondary_source"),
        (PROOF_LINK, "proof_link"),
    }


def test_the_origin_constraint_accepts_a_secondary_source_row(db, event):
    """``ck_source_archives_origin_valid`` pins the origin domain at the
    database; the model Literal and the constraint are a hand-kept pair."""
    db.add(
        SourceArchive(
            event_id=event.id,
            original_url=MIRROR,
            origin="secondary_source",
            status="queued",
        )
    )
    db.commit()
    stored = db.query(SourceArchive).filter(SourceArchive.original_url == MIRROR).one()
    assert stored.origin == "secondary_source"

    db.add(
        SourceArchive(
            event_id=event.id,
            original_url="https://example.net/other",
            origin="nowhere",
            status="queued",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_enqueue_event_best_effort_swallows_a_database_failure(db, event, monkeypatch):
    """A durable event write must not 500 because the queue insert failed."""

    def boom(*_args, **_kwargs):
        raise OperationalError("insert", {}, Exception("connection lost"))

    monkeypatch.setattr(source_archive, "enqueue_event", boom)
    source_archive.enqueue_event_best_effort(db, event)
    assert db.query(SourceArchive).filter(SourceArchive.event_id == event.id).count() == 0


def test_enqueue_event_best_effort_swallows_any_failure(db, event, monkeypatch):
    """Not only database errors: nothing an enqueue raises may reach the
    analyst as the response to a write that already committed."""

    def boom(*_args, **_kwargs):
        raise RuntimeError("something else entirely")

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


def test_enqueue_catalog_skips_events_it_already_covered(db, event):
    """The scan is an anti-join, so a sweep converges: what the first click
    enqueued drops out of the second click's scan entirely."""
    source_archive.enqueue_event(db, event)
    assert event.id not in {row[0] for row in source_archive._backfill_chunk(db, None, 500)}
    source_archive.enqueue_catalog(db)
    assert source_archive.enqueue_catalog(db)["links_enqueued"] == 0
    assert db.query(SourceArchive).filter(SourceArchive.event_id == event.id).count() == 2


def test_enqueue_catalog_covers_an_event_whose_only_links_are_secondary(db, owner):
    """A draft born without a source URL and without proof citations still
    carries mirrors; the backfill reads them from the child table, which the
    keyset column walk does not select."""
    row = Event(
        owner_id=owner.id,
        title="Mirrors only",
        source_url=None,
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    _with_mirrors(db, row, MIRROR)
    source_archive.enqueue_catalog(db)
    queued = db.query(SourceArchive).filter(SourceArchive.event_id == row.id).all()
    assert [(r.original_url, r.origin) for r in queued] == [(MIRROR, "secondary_source")]


def test_enqueue_catalog_skips_demo_rows(db, owner):
    """Seeded demo events carry a sentinel source that resolves nowhere;
    submitting it would spend real Wayback budget on nothing."""
    row = Event(
        owner_id=owner.id,
        title="Demo event",
        source_url="https://vidit.app/demo-data",
        is_demo=True,
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    source_archive.enqueue_catalog(db)
    assert db.query(SourceArchive).filter(SourceArchive.event_id == row.id).count() == 0


def test_enqueue_catalog_walks_past_an_event_with_no_links(db, owner, event):
    """A source-less draft yields nothing to enqueue; the keyset cursor still
    advances, or the sweep would re-read it forever."""
    row = Event(
        owner_id=owner.id,
        title="Source-less draft",
        source_url=None,
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    result = source_archive.enqueue_catalog(db)
    assert result["events_scanned"] >= 2
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


def test_claim_next_skips_a_soft_deleted_event(db, event):
    """An admin taking an event down must not be followed by this queue
    pushing its links to a public archive."""
    source_archive.enqueue_event(db, event)
    event.deleted_at = datetime.now(UTC)
    db.commit()
    assert source_archive.claim_next(db) is None


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


def test_capture_falls_back_when_wayback_is_unreachable(monkeypatch):
    """The real outage case: web.archive.org refuses the connection.

    A transport failure never reaches the service's own error contract, so
    without this the fallback would be skipped exactly when it is needed.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            raise httpx.ConnectError("no route to host")
        return httpx.Response(302, headers={"Refresh": f"0; url=https://archive.ph/abcde/{SOURCE}"})

    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", True)
    with _spn_client(handler) as client:
        provider, url = source_archive.capture(SOURCE, client=client)
    assert provider == "archive_today"
    assert url.startswith("https://archive.ph/")


def test_capture_rejects_a_snapshot_url_that_is_not_a_link(monkeypatch):
    """archive.today's snapshot URL comes off a header this code parses itself
    and the detail surface renders as an href, so a non-http(s) value is a
    failed capture rather than something to store."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            return httpx.Response(503)
        return httpx.Response(200, headers={"Refresh": "0; url=javascript:alert(1)"})

    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", True)
    with (
        _spn_client(handler) as client,
        pytest.raises(source_archive.ArchiveUnavailableError, match="not an http"),
    ):
        source_archive.capture(SOURCE, client=client)


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


def test_process_reschedules_an_unexpected_failure(db, event, monkeypatch):
    """Anything the named branches miss must still land on the retry ladder;
    an escaping exception would leave the row ``running`` for the whole stale
    window."""

    def boom(*_args, **_kwargs):
        raise ValueError("provider answered something new")

    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    monkeypatch.setattr(source_archive, "capture", boom)
    assert source_archive.process(db, row) is False
    db.refresh(row)
    assert row.status == "queued"
    assert row.error == "unexpected: ValueError"


def test_reschedule_clears_the_claim_stamp(db, event):
    """``started_at`` belongs to the claim that ended; a queued row carrying an
    old one reads as a claim in flight to the stale-window reclaim."""
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    with _spn_client(lambda _r: httpx.Response(429)) as client:
        source_archive.process(db, row, client=client)
    db.refresh(row)
    assert row.status == "queued"
    assert row.started_at is None


def test_backoff_grows_and_is_capped():
    assert source_archive._backoff(1) == source_archive.BASE_BACKOFF
    assert source_archive._backoff(2) == source_archive.BASE_BACKOFF * 2
    assert source_archive._backoff(99) == source_archive.MAX_BACKOFF


def test_the_attempt_ladder_actually_reaches_the_cap():
    """The retry horizon is a claim the docs make, so it is asserted here: the
    last wait before a row is buried is ``MAX_BACKOFF``."""
    last_wait = source_archive._backoff(source_archive.MAX_ATTEMPTS - 1)
    assert last_wait == source_archive.MAX_BACKOFF


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


def test_run_once_does_not_sleep_after_the_last_row(db, event, monkeypatch):
    """The pacing gap belongs between two captures. Paying it after the final
    row is pure latency: an idle worker would hold the pass open for nothing."""
    slept: list[float] = []
    monkeypatch.setattr(source_archive, "REQUEST_SPACING", timedelta(seconds=6))
    monkeypatch.setattr(source_archive.time, "sleep", lambda seconds: slept.append(seconds))

    source_archive.enqueue_event(db, event)
    # An inline snapshot, so the only sleep a capture can add is the pacing gap.
    inline = lambda _r: httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})  # noqa: E731
    with _spn_client(inline) as client:
        assert source_archive.run_once(db, budget=5, client=client) == 2
    # Two rows, so exactly one gap, and it falls between them.
    assert slept == [6.0]


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
