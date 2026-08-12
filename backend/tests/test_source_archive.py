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
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError

from app.database import SessionLocal
from app.models.event import (
    SOURCE_URL_MAX_LENGTH,
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_REQUESTED,
    Event,
    EventSourceLink,
)
from app.models.source_archive import SourceArchive
from app.models.user import User
from app.services import source_archive
from app.services.auth import hash_password
from app.services.sanitize import extract_link_hrefs

SOURCE = "https://x.com/analyst/status/1234567890"
PROOF_LINK = "https://example.org/report"
MIRROR = "https://t.me/channel/42"
CAPTURE_TS = "20260811120000"
ARCHIVE_TODAY_SNAPSHOT = f"https://archive.ph/abcde/{SOURCE}"


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


@pytest.fixture
def published_event(db, owner):
    """A published event, the only kind the catalog backfill sweeps.

    ``requested`` is the cheapest published state to build (no coordinate, no
    geolocation stamp). What the backfill reads is that the row is public, not
    which published state it holds.
    """
    row = Event(
        owner_id=owner.id,
        title="Published event",
        source_url=SOURCE,
        proof=_proof_doc(PROOF_LINK),
        status=STATUS_REQUESTED,
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
    through them. The credential pair and the archive.today kill switch are
    pinned to their defaults so a populated local ``.env`` cannot change what a
    test exercises: both providers are attempted, which is what production
    does. The queue starts empty because ``claim_next`` claims the oldest
    runnable row in the whole table: rows another module's event write left
    behind would otherwise be what a claim assertion here sees.
    """
    monkeypatch.setattr(source_archive, "REQUEST_SPACING", timedelta(0))
    monkeypatch.setattr(source_archive, "_STATUS_POLL_INTERVAL_S", 0)
    monkeypatch.setattr(source_archive.settings, "archive_org_access_key", "")
    monkeypatch.setattr(source_archive.settings, "archive_org_secret_key", "")
    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", True)
    db.query(SourceArchive).delete(synchronize_session=False)
    db.commit()


def _spn_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _wayback_ok(request: httpx.Request) -> httpx.Response:
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


def _archive_today_ok(_request: httpx.Request) -> httpx.Response:
    """archive.today's happy path: the snapshot URL arrives in a header."""
    return httpx.Response(302, headers={"Refresh": f"0; url={ARCHIVE_TODAY_SNAPSHOT}"})


def _both_ok(request: httpx.Request) -> httpx.Response:
    """Both providers capture. The default shape of a pass in production."""
    if request.url.host == "web.archive.org":
        return _wayback_ok(request)
    return _archive_today_ok(request)


WAYBACK_CAPTURE = f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"


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
    assert all(r.wayback_url is None and r.archive_today_url is None for r in rows)


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


def test_enqueue_catalog_covers_an_event_written_before_archival(db, published_event):
    result = source_archive.enqueue_catalog(db)
    assert result["links_enqueued"] >= 2
    assert (
        db.query(SourceArchive)
        .filter(
            SourceArchive.event_id == published_event.id,
            SourceArchive.original_url == SOURCE,
        )
        .count()
        == 1
    )


def test_enqueue_catalog_skips_events_it_already_covered(db, published_event):
    """The scan converges: an event whose links are all queued drops out of the
    next click's scan entirely."""
    source_archive.enqueue_event(db, published_event)
    assert published_event.id not in {
        row[0] for row in source_archive._backfill_chunk(db, None, 500)
    }
    source_archive.enqueue_catalog(db)
    assert source_archive.enqueue_catalog(db)["links_enqueued"] == 0
    assert db.query(SourceArchive).filter(SourceArchive.event_id == published_event.id).count() == 2


def test_enqueue_catalog_reaches_a_mirror_on_an_already_queued_event(db, published_event):
    """The widened scan's reason to exist: an event whose ``source_url`` is
    already queued still qualifies while one of its mirrors is not.

    A scan keyed on "carries no archival rows at all" would drop this event and
    the mirror would never be captured. The mirrors come from the child table,
    which the chunk's keyset column walk does not select, so this also pins
    that read.
    """
    source_archive.enqueue_catalog(db)
    assert source_archive.enqueue_catalog(db)["links_enqueued"] == 0

    _with_mirrors(db, published_event, MIRROR)
    assert published_event.id in {row[0] for row in source_archive._backfill_chunk(db, None, 500)}
    assert source_archive.enqueue_catalog(db)["links_enqueued"] == 1
    rows = db.query(SourceArchive).filter(SourceArchive.event_id == published_event.id).all()
    assert {(r.original_url, r.origin) for r in rows} == {
        (SOURCE, "source_url"),
        (MIRROR, "secondary_source"),
        (PROOF_LINK, "proof_link"),
    }
    # And it converges again: nothing is left unqueued.
    assert source_archive.enqueue_catalog(db)["links_enqueued"] == 0


def test_enqueue_catalog_leaves_an_unpublished_draft_alone(db, event):
    """The archiving services are public and timestamped, so a machine
    ``detected`` draft is not submitted by the admin backfill either; its
    promotion enqueues it."""
    _with_mirrors(db, event, MIRROR)
    assert event.id not in {row[0] for row in source_archive._backfill_chunk(db, None, 500)}
    source_archive.enqueue_catalog(db)
    assert db.query(SourceArchive).filter(SourceArchive.event_id == event.id).count() == 0


def test_enqueue_catalog_leaves_a_rejected_draft_alone(db, owner):
    """A draft closed off ``detected`` is a rejected detection: it was never
    published, so closing it does not hand its links to a public archive."""
    row = Event(
        owner_id=owner.id,
        title="Rejected detection",
        source_url=SOURCE,
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
        closed_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    source_archive.enqueue_catalog(db)
    assert db.query(SourceArchive).filter(SourceArchive.event_id == row.id).count() == 0


def test_enqueue_catalog_skips_demo_rows(db, owner):
    """Seeded demo events carry a sentinel source that resolves nowhere;
    submitting it would spend real Wayback budget on nothing."""
    row = Event(
        owner_id=owner.id,
        title="Demo event",
        source_url="https://vidit.app/demo-data",
        is_demo=True,
        status=STATUS_REQUESTED,
    )
    db.add(row)
    db.commit()
    source_archive.enqueue_catalog(db)
    assert db.query(SourceArchive).filter(SourceArchive.event_id == row.id).count() == 0


def test_enqueue_catalog_walks_past_an_event_with_no_links(db, owner, published_event):
    """An event whose stored source the allowlist refuses yields nothing to
    enqueue, so it never leaves the scan; the keyset cursor still advances, or
    the sweep would re-read it forever and never reach the rest."""
    row = Event(
        owner_id=owner.id,
        title="Unarchivable source",
        source_url="ftp://files.example.org/clip.mp4",
        status=STATUS_REQUESTED,
    )
    db.add(row)
    db.commit()
    result = source_archive.enqueue_catalog(db)
    assert result["events_scanned"] >= 2
    assert (
        db.query(SourceArchive)
        .filter(
            SourceArchive.event_id == published_event.id,
            SourceArchive.original_url == SOURCE,
        )
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


def test_capture_submits_to_both_providers_and_returns_both_urls():
    """The rule the whole feature rests on: every link goes to both services,
    and each answer is stored under its own provider."""
    with _spn_client(_both_ok) as client:
        outcome = source_archive.capture(SOURCE, client=client)
    assert outcome.captures == {
        "wayback": WAYBACK_CAPTURE,
        "archive_today": ARCHIVE_TODAY_SNAPSHOT,
    }
    assert outcome.errors == {}


def test_capture_still_reaches_archive_today_when_wayback_refuses():
    """The peers are independent: one service refusing costs the other nothing,
    which is the whole reason both are attempted."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            return httpx.Response(503)
        return _archive_today_ok(request)

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, client=client)
    assert outcome.captures == {"archive_today": ARCHIVE_TODAY_SNAPSHOT}
    assert outcome.errors == {"wayback": "service error 503"}


def test_capture_still_reaches_wayback_when_archive_today_refuses():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            return _wayback_ok(request)
        return httpx.Response(403, text="blocked")

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, client=client)
    assert outcome.captures == {"wayback": WAYBACK_CAPTURE}
    assert "archive_today" in outcome.errors


def test_capture_attempts_only_the_providers_it_is_given():
    """What a claimed row hands in: the captures it is still missing."""
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return _both_ok(request)

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, providers=["archive_today"], client=client)
    assert outcome.captures == {"archive_today": ARCHIVE_TODAY_SNAPSHOT}
    assert hosts == ["archive.ph"]


def test_capture_uses_an_inline_existing_snapshot_without_polling():
    """A submit that answers with a capture directly costs no status poll."""
    polled = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/save":
            polled.append(request.url.path)
        return httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, providers=["wayback"], client=client)
    assert outcome.captures["wayback"].endswith(SOURCE)
    assert polled == []


def test_capture_records_a_rate_limit_rather_than_raising():
    """A refusal is a per-provider outcome, never an exception: raising would
    take the peer's attempt down with it."""
    with _spn_client(lambda _r: httpx.Response(429, text="slow down")) as client:
        outcome = source_archive.capture(SOURCE, client=client)
    assert outcome.captures == {}
    assert outcome.errors == {
        "wayback": "rate limited",
        # archive.today has no status contract to read, so its refusal is named
        # by what the response did not carry.
        "archive_today": "no snapshot in response 429",
    }


def test_capture_records_the_reason_a_job_reports():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/save":
            return httpx.Response(200, json={"job_id": "job-1"})
        return httpx.Response(200, json={"status": "error", "message": "robots blocked"})

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, providers=["wayback"], client=client)
    assert outcome.errors == {"wayback": "robots blocked"}


def test_capture_records_a_transport_failure_per_provider():
    """The real outage case: a host refuses the connection.

    A transport failure never reaches the service's own error contract, so
    without this the peer's attempt would be lost to an escaping exception.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            raise httpx.ConnectError("no route to host")
        return _archive_today_ok(request)

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, client=client)
    assert outcome.captures == {"archive_today": ARCHIVE_TODAY_SNAPSHOT}
    assert outcome.errors == {"wayback": "transport: ConnectError"}


def test_capture_sends_the_key_pair_when_configured(monkeypatch):
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})

    monkeypatch.setattr(source_archive.settings, "archive_org_access_key", "KEY")
    monkeypatch.setattr(source_archive.settings, "archive_org_secret_key", "SECRET")
    with _spn_client(handler) as client:
        source_archive.capture(SOURCE, providers=["wayback"], client=client)
    assert seen["authorization"] == "LOW KEY:SECRET"


def test_the_kill_switch_drops_the_archive_today_leg(monkeypatch):
    """``ARCHIVE_TODAY_ENABLED`` is an operator switch, not a feature flag: on
    by default, and turning it off stops that leg from being submitted at all,
    leaving the Wayback capture the only one a link can get."""
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return _both_ok(request)

    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", False)
    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, client=client)
    assert outcome.captures == {"wayback": WAYBACK_CAPTURE}
    assert "archive.ph" not in hosts


def test_capture_spaces_its_two_provider_submissions(monkeypatch):
    """The rate ceiling counts submissions, not links, so one row's two legs
    are spaced exactly as two rows are."""
    slept: list[float] = []
    monkeypatch.setattr(source_archive, "REQUEST_SPACING", timedelta(seconds=6))
    monkeypatch.setattr(source_archive.time, "sleep", lambda seconds: slept.append(seconds))

    inline = lambda r: (  # noqa: E731
        httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})
        if r.url.host == "web.archive.org"
        else _archive_today_ok(r)
    )
    with _spn_client(inline) as client:
        source_archive.capture(SOURCE, client=client)
    # Two providers, so exactly one gap, and never one after the last leg.
    assert slept == [6.0]


def test_capture_rejects_a_snapshot_url_that_is_not_a_link():
    """archive.today's snapshot URL comes off a header this code parses itself
    and the detail surface renders as an href, so a non-http(s) value is a
    failed capture rather than something to store."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Refresh": "0; url=javascript:alert(1)"})

    with _spn_client(handler) as client:
        outcome = source_archive.capture(SOURCE, providers=["archive_today"], client=client)
    assert outcome.captures == {}
    assert "not an http" in outcome.errors["archive_today"]


# ── process + retry policy ─────────────────────────────────────────────


def test_process_stamps_both_capture_columns(db, event):
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    with _spn_client(_both_ok) as client:
        assert source_archive.process(db, row, client=client) is True
    db.refresh(row)
    assert row.status == "done"
    assert row.wayback_url == WAYBACK_CAPTURE
    assert row.archive_today_url == ARCHIVE_TODAY_SNAPSHOT
    assert row.error is None
    assert row.finished_at is not None


def test_one_capture_finishes_the_row_and_the_peer_is_never_retried(db, event):
    """A single copy is what the feature promises, so the first capture ends
    the job: the row leaves the claim query with the other column empty, and no
    later pass touches it. The refusal stays in ``error`` as the only record of
    why that column is empty."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.archive.org":
            return _wayback_ok(request)
        return httpx.Response(403)

    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    row_id = row.id
    with _spn_client(handler) as client:
        assert source_archive.process(db, row, client=client) is True
    db.refresh(row)
    assert row.status == "done"
    assert row.wayback_url == WAYBACK_CAPTURE
    assert row.archive_today_url is None
    assert row.error.startswith("archive.today: ")

    # Not runnable again, whatever the schedule says: ``done`` is out of the
    # claim query, so the missing peer is never re-attempted.
    db.query(SourceArchive).filter(SourceArchive.id == row_id).update(
        {"next_attempt_at": datetime.now(UTC) - timedelta(days=1)}, synchronize_session=False
    )
    db.commit()
    while (claimed := source_archive.claim_next(db)) is not None:
        assert claimed.id != row_id


def test_process_reschedules_when_both_providers_refuse(db, event):
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    before = datetime.now(UTC)
    with _spn_client(lambda _r: httpx.Response(429)) as client:
        assert source_archive.process(db, row, client=client) is False
    db.refresh(row)
    assert row.status == "queued"
    assert row.wayback_url is None
    assert row.archive_today_url is None
    # One clause per provider, so an operator reads why each one refused.
    assert row.error == "wayback: rate limited; archive.today: no snapshot in response 429"
    assert row.next_attempt_at >= before + source_archive.BASE_BACKOFF


def test_process_buries_a_row_once_the_attempt_budget_is_spent(db, event):
    """The terminal state the read surface displays: neither provider captured
    the link and there is no attempt left, so the event page can say the link
    is not archived rather than saying nothing."""
    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    row.attempts = source_archive.MAX_ATTEMPTS
    db.commit()
    with _spn_client(lambda _r: httpx.Response(503)) as client:
        source_archive.process(db, row, client=client)
    db.refresh(row)
    assert row.status == "failed"
    assert row.wayback_url is None
    assert row.archive_today_url is None
    assert row.finished_at is not None


def test_a_row_walks_the_whole_ladder_before_it_is_buried(db, event):
    """The retry horizon end to end: every attempt short of the last returns
    the row to the queue, and only the last one buries it."""
    source_archive.enqueue_event(db, event)
    # One row, so every attempt lands on the same ladder rather than alternating
    # between this event's two links.
    db.query(SourceArchive).filter(SourceArchive.original_url != SOURCE).delete(
        synchronize_session=False
    )
    db.commit()
    with _spn_client(lambda _r: httpx.Response(503)) as client:
        for attempt in range(1, source_archive.MAX_ATTEMPTS + 1):
            db.query(SourceArchive).filter(SourceArchive.status == "queued").update(
                {"next_attempt_at": datetime.now(UTC)}, synchronize_session=False
            )
            db.commit()
            row = source_archive.claim_next(db)
            assert row is not None
            source_archive.process(db, row, client=client)
            db.refresh(row)
            expected = "failed" if attempt == source_archive.MAX_ATTEMPTS else "queued"
            assert row.status == expected, f"attempt {attempt}"


def test_process_reschedules_a_transport_error(db, event):
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    source_archive.enqueue_event(db, event)
    row = source_archive.claim_next(db)
    with _spn_client(handler) as client:
        assert source_archive.process(db, row, client=client) is False
    db.refresh(row)
    assert row.status == "queued"
    assert "transport: ConnectError" in row.error


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
    with _spn_client(_both_ok) as client:
        assert source_archive.run_once(db, budget=1, client=client) == 1
    done = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.status == "done")
        .count()
    )
    assert done == 1


def test_run_once_does_not_sleep_after_the_last_row(db, event, monkeypatch):
    """The pacing gap belongs between two submissions. Paying it after the
    final one is pure latency: an idle worker would hold the pass open for
    nothing."""
    slept: list[float] = []
    monkeypatch.setattr(source_archive, "REQUEST_SPACING", timedelta(seconds=6))
    monkeypatch.setattr(source_archive.time, "sleep", lambda seconds: slept.append(seconds))
    # One provider, so the only gaps a pass can pay are the ones between rows.
    monkeypatch.setattr(source_archive.settings, "archive_today_enabled", False)

    source_archive.enqueue_event(db, event)
    # An inline snapshot, so the only sleep a capture can add is the pacing gap.
    inline = lambda _r: httpx.Response(200, json={"timestamp": CAPTURE_TS, "original_url": SOURCE})  # noqa: E731
    with _spn_client(inline) as client:
        assert source_archive.run_once(db, budget=5, client=client) == 2
    # Two rows, so exactly one gap, and it falls between them.
    assert slept == [6.0]


def test_archive_row_for_matches_the_original(db, event):
    """The read surface looks a link up by its exact stored value, and gets the
    whole row: both capture columns and the state, not one URL."""
    source_archive.enqueue_event(db, event)
    row = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.original_url == SOURCE)
        .one()
    )
    assert source_archive.archive_row_for(event, SOURCE).id == row.id
    assert source_archive.archive_row_for(event, PROOF_LINK).original_url == PROOF_LINK
    # A link the event does not carry, and a source-less event, have no row.
    assert source_archive.archive_row_for(event, "https://elsewhere.example/x") is None
    assert source_archive.archive_row_for(event, None) is None


def test_missing_providers_reads_the_capture_columns(db, event):
    """What a pass attempts, and what makes a row done: derived from the
    columns rather than tracked separately."""
    source_archive.enqueue_event(db, event)
    row = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.original_url == SOURCE)
        .one()
    )
    assert source_archive.missing_providers(row) == list(source_archive.PROVIDERS)
    row.status = "done"
    row.wayback_url = "https://web.archive.org/web/x/y"
    db.commit()
    assert source_archive.missing_providers(row) == ["archive_today"]


def test_the_done_check_constraint_rejects_an_empty_capture_pair(db, event):
    """``ck_source_archives_done_capture`` pins "done means at least one copy"
    at the database, in both directions, which is what lets the read surface
    treat ``failed`` as a real "not archived" state."""
    source_archive.enqueue_event(db, event)
    row = (
        db.query(SourceArchive)
        .filter(SourceArchive.event_id == event.id, SourceArchive.original_url == SOURCE)
        .one()
    )
    row.status = "done"
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    # And the mirror image: a capture on a row that is not done.
    row = db.query(SourceArchive).filter(SourceArchive.original_url == SOURCE).one()
    row.archive_today_url = "https://archive.ph/abcde/x"
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ── migration data mapping ─────────────────────────────────────────────


def _load_dual_provider_migration():
    """The dual-provider migration module, loaded by path.

    ``alembic/versions`` is not a package, so the revision is imported through
    the file loader rather than a normal import. Only its SQL builders are
    read; the ``op``-driven schema half is what ``alembic upgrade`` exercises.
    """
    import importlib.util
    import pathlib

    path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "u3w5y7a9c1e3_source_archive_dual_provider.py"
    )
    spec = importlib.util.spec_from_file_location("dual_provider_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def legacy_table(db):
    """A scratch table in the pre-migration shape, dropped afterwards.

    The mapping is run against this rather than against ``source_archives``:
    the live table is already migrated, and the statements are
    table-parameterised precisely so their data half stays testable.
    """
    name = f"source_archives_legacy_{uuid.uuid4().hex[:8]}"
    db.execute(
        text(
            f"""
            CREATE TABLE {name} (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                archived_url TEXT,
                provider TEXT,
                finished_at TIMESTAMPTZ,
                next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                wayback_url TEXT,
                archive_today_url TEXT
            )
            """
        )
    )
    db.commit()
    yield name
    db.execute(text(f"DROP TABLE {name}"))
    db.commit()


def test_the_migration_maps_each_row_onto_its_provider_column(db, legacy_table):
    """Existing captures keep their provider: a ``wayback`` row's URL lands in
    ``wayback_url``, an ``archive_today`` row's in ``archive_today_url``, and
    ``done`` carries over because either column alone satisfies the new check."""
    migration = _load_dual_provider_migration()
    db.execute(
        text(
            f"""
            INSERT INTO {legacy_table} (id, status, archived_url, provider) VALUES
                ('a', 'done', 'https://web.archive.org/web/1/x', 'wayback'),
                ('b', 'done', 'https://archive.ph/abcde/x', 'archive_today'),
                ('c', 'queued', NULL, NULL),
                ('d', 'failed', NULL, NULL)
            """
        )
    )
    for statement in migration.split_captures_sql(legacy_table):
        db.execute(text(statement))
    db.commit()

    rows = {
        r[0]: r[1:]
        for r in db.execute(
            text(f"SELECT id, status, wayback_url, archive_today_url FROM {legacy_table}")
        )
    }
    assert rows["a"] == ("done", "https://web.archive.org/web/1/x", None)
    assert rows["b"] == ("done", None, "https://archive.ph/abcde/x")
    # Statuses carry over untouched, and an uncaptured row keeps both columns
    # empty, which is what the new check demands of every non-done row.
    assert rows["c"] == ("queued", None, None)
    assert rows["d"] == ("failed", None, None)


def test_the_migration_requeues_a_done_row_with_no_provider(db, legacy_table):
    """A ``done`` row the old code left without a provider maps to no column at
    all, which the new check rejects. It goes back on the queue instead of
    blocking the migration."""
    migration = _load_dual_provider_migration()
    db.execute(
        text(
            f"""
            INSERT INTO {legacy_table} (id, status, archived_url, provider, finished_at)
            VALUES ('e', 'done', 'https://web.archive.org/web/1/x', NULL, now())
            """
        )
    )
    for statement in migration.split_captures_sql(legacy_table):
        db.execute(text(statement))
    db.commit()

    status, finished_at = db.execute(
        text(f"SELECT status, finished_at FROM {legacy_table} WHERE id = 'e'")
    ).one()
    assert status == "queued"
    assert finished_at is None


def test_the_migration_downgrade_folds_the_pair_back(db, legacy_table):
    """Downgrade keeps a capture reachable in the single-column shape, and a
    row holding both keeps the Wayback one as the primary provider."""
    migration = _load_dual_provider_migration()
    db.execute(
        text(
            f"""
            INSERT INTO {legacy_table} (id, status, wayback_url, archive_today_url) VALUES
                ('a', 'done', 'https://web.archive.org/web/1/x', 'https://archive.ph/abcde/x'),
                ('b', 'done', NULL, 'https://archive.ph/fghij/y'),
                ('c', 'failed', NULL, NULL)
            """
        )
    )
    db.execute(text(migration.merge_captures_sql(legacy_table)))
    db.commit()

    rows = {
        r[0]: r[1:]
        for r in db.execute(text(f"SELECT id, archived_url, provider FROM {legacy_table}"))
    }
    assert rows["a"] == ("https://web.archive.org/web/1/x", "wayback")
    assert rows["b"] == ("https://archive.ph/fghij/y", "archive_today")
    assert rows["c"] == (None, None)
