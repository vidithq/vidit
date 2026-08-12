"""The durable source-archival queue: enqueue at publication, drain in the worker.

A source tweet gets deleted and an account gets suspended, which destroys
exactly the evidence the catalog promises to preserve. Publishing an event
pushes its links to the Wayback Machine so a dead original still has a
readable copy.

Publication is the trigger, not creation: Save Page Now is a public,
timestamped service, so submitting a link announces it. An event that is
public already (a directly created geolocation, a request, a draft the
analyst promotes with ``geolocate``) loses nothing by that; a machine
``detected`` draft is unpublished working state, so its links are not
submitted until it is published, and the promotion enqueues them then.

Which links: the event's ``source_url``, its secondary source links (the
analyst-submitted mirrors in ``event_source_links``), and every ``http(s)``
href carried by a link mark in the proof body's Tiptap document. One
:class:`~app.models.source_archive.SourceArchive` row per link, unique on
``(event_id, original_url)``, so every enqueue path (create, the geolocate
promotion, an edit that adds a citation, the catalog backfill) is safe to run
repeatedly.

Off-request by construction: the write paths only insert rows, and the
always-on worker (``scripts/run_import_worker.py``, the same process that
drains archive imports and bot mentions) claims them with ``FOR UPDATE SKIP
LOCKED``, calls the archiving service, and stamps ``archived_url`` in place.
The row is both the job and the result, so nothing is copied between a queue
table and a read table.

Rate limits shape the drain rather than the other way round: Save Page Now
caps captures per minute and answers a burst with 429, so one pass takes at
most :data:`PASS_BUDGET` rows, stops claiming past :data:`PASS_MAX_SECONDS`,
and spaces its calls by :data:`REQUEST_SPACING`. A failed attempt goes back to
``queued`` with an exponential ``next_attempt_at`` (:data:`BASE_BACKOFF`
doubling per attempt, capped at :data:`MAX_BACKOFF`); :data:`MAX_ATTEMPTS`
bounds the retries so a permanently uncapturable link (a login wall, a robots
block) lands ``failed`` instead of consuming budget forever.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import or_, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import SOURCE_URL_MAX_LENGTH, Event, EventSourceLink
from app.models.source_archive import (
    SourceArchive,
    SourceArchiveOrigin,
    SourceArchiveProvider,
)
from app.services.sanitize import extract_link_hrefs, safe_link_href

logger = logging.getLogger(__name__)

# One pass takes at most this many rows. Bounds a pass's cost (each capture is
# a submit plus a status poll) so the worker's archival thread comes back to
# a fresh session and a fresh claim order at a predictable rhythm.
PASS_BUDGET = 10
# A pass stops claiming new rows once it has run this long, whatever the
# budget: a row whose capture sits through the full poll window costs ~35 s,
# so the budget alone is not a wall-clock bound.
PASS_MAX_SECONDS = 300.0
# Minimum gap between two capture submissions. Save Page Now's documented
# ceiling is well above this; the gap is what keeps a backfill from reading as
# a burst.
REQUEST_SPACING = timedelta(seconds=6)
# Attempts and cap are set together: the delay doubles from BASE_BACKOFF and
# the last attempts sit at MAX_BACKOFF, so the ladder spans about 28 hours
# (15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 12 h). Long enough to ride out a
# day-long provider outage, bounded so a dead link stops costing budget.
MAX_ATTEMPTS = 8
BASE_BACKOFF = timedelta(minutes=15)
MAX_BACKOFF = timedelta(hours=12)
# A row claimed by a worker that then died is reclaimed once this old.
STALE_RUNNING_AFTER = timedelta(minutes=30)
# Save Page Now returns an existing capture instead of re-crawling when one is
# this fresh, which makes a re-enqueued link cost no crawl at all.
IF_NOT_ARCHIVED_WITHIN = "30d"

_SPN_SUBMIT_URL = "https://web.archive.org/save"
_SPN_STATUS_URL = "https://web.archive.org/save/status"
_WAYBACK_REPLAY = "https://web.archive.org/web"
_ARCHIVE_TODAY_SUBMIT = "https://archive.ph/submit/"
_HTTP_TIMEOUT_S = 30.0
_USER_AGENT = "VidItArchiver/1.0 (+https://vidit.app)"
# How long to wait for one Save Page Now job to report a capture. A submit that
# is accepted but still pending past this returns no URL and the row retries;
# the capture usually completes anyway and the retry then reads it back cheaply
# through ``if_not_archived_within``.
_STATUS_POLL_ATTEMPTS = 10
_STATUS_POLL_INTERVAL_S = 3.0


class ArchiveUnavailableError(Exception):
    """The archiving service did not produce a capture for this attempt.

    Always retryable: a 429, a 5xx, a network error, or a job still pending
    when the poll budget ran out. The caller schedules the backoff.
    """


def _is_archivable(url: str) -> bool:
    """Whether a stored link is worth handing to an archiving service.

    The allowlist is :func:`sanitize.safe_link_href` (``http(s)`` with a
    hostname), called rather than restated, so a link the proof editor would
    refuse is not one this queue submits. On top of it, a length ceiling:
    ``(event_id, original_url)`` is a unique btree index, and a value past the
    ``source_url`` column's own limit would abort the insert carrying it, so an
    oversized proof href is dropped instead of taking a backfill chunk down.
    """
    if len(url.encode()) > SOURCE_URL_MAX_LENGTH:
        return False
    return safe_link_href(url) is not None


def collect_links(event: Event) -> list[tuple[str, SourceArchiveOrigin]]:
    """Every archivable link on an event, ``source_url`` first, deduped.

    The proof body's hrefs come from :func:`sanitize.extract_link_hrefs`, so
    the Tiptap walk has one home. Duplicates collapse to the first origin the
    walk reaches, which is the strongest provenance available for that URL: the
    declared source, then an analyst-submitted mirror, then a proof citation.
    """
    return _collect_links(event.source_url, event.proof, [link.url for link in event.source_links])


def _collect_links(
    source_url: str | None, proof: Any, secondary_urls: list[str]
) -> list[tuple[str, SourceArchiveOrigin]]:
    """:func:`collect_links` over the three sources it reads.

    Split out so the backfill can walk lightweight column tuples instead of
    hydrating ORM rows it would only re-expire on the next commit.
    """
    links: list[tuple[str, SourceArchiveOrigin]] = []
    seen: set[str] = set()

    def add(url: str, origin: SourceArchiveOrigin) -> None:
        if url in seen or not _is_archivable(url):
            return
        seen.add(url)
        links.append((url, origin))

    if source_url:
        add(source_url, "source_url")
    for url in secondary_urls:
        add(url, "secondary_source")
    for href in extract_link_hrefs(proof):
        add(href, "proof_link")
    return links


def _secondary_links_for(db: Session, event_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    """One backfill chunk's secondary source links, keyed by event, in order.

    One query for the whole chunk: hydrating each event's ``source_links``
    relationship instead would cost a round trip per event, and the chunk is
    deliberately column tuples rather than ORM rows.
    """
    if not event_ids:
        return {}
    by_event: dict[uuid.UUID, list[str]] = {}
    rows = (
        db.query(EventSourceLink.event_id, EventSourceLink.url)
        .filter(EventSourceLink.event_id.in_(event_ids))
        .order_by(EventSourceLink.event_id, EventSourceLink.position)
        .all()
    )
    for event_id, url in rows:
        by_event.setdefault(event_id, []).append(url)
    return by_event


def _insert_links(db: Session, rows: list[dict]) -> int:
    """Insert queue rows in one statement; return how many landed.

    ``ON CONFLICT DO NOTHING`` on ``(event_id, original_url)`` carries the
    idempotency, so no caller reads the existing rows first and a losing race
    (an edit landing while the backfill sweeps) is a no-op rather than an
    error. Commits: the caller's event write is already durable by this point,
    and the archival rows are not part of its transaction contract.
    """
    if not rows:
        return 0
    now = datetime.now(UTC)
    # ``RETURNING`` is what counts the insert: with DO NOTHING it yields the
    # rows that actually landed, so the count excludes the links another
    # enqueue path already tracked.
    landed = db.execute(
        pg_insert(SourceArchive)
        .values(
            [
                {
                    "id": uuid.uuid4(),
                    "status": "queued",
                    "attempts": 0,
                    "created_at": now,
                    "next_attempt_at": now,
                    **row,
                }
                for row in rows
            ]
        )
        .on_conflict_do_nothing(constraint="uq_source_archives_event_url")
        .returning(SourceArchive.id)
    ).all()
    db.commit()
    return len(landed)


def _queue_rows(event_id: uuid.UUID, links: list[tuple[str, SourceArchiveOrigin]]) -> list[dict]:
    return [{"event_id": event_id, "original_url": url, "origin": origin} for url, origin in links]


def enqueue_event(db: Session, event: Event) -> int:
    """Insert the ``queued`` rows for an event's links; return how many landed.

    Idempotent on ``(event_id, original_url)``, so the publication paths (a
    direct geolocated create, a request, the geolocate promotion), an edit that
    adds a citation, and the backfill all call it freely.
    """
    return _insert_links(db, _queue_rows(event.id, collect_links(event)))


def enqueue_event_best_effort(db: Session, event: Event) -> None:
    """:func:`enqueue_event`, with any failure downgraded to a log line.

    What every write path calls. The event write it follows is already
    committed, so letting an enqueue failure escape would turn a durable create
    into a 500 for the analyst; the archival rows are recoverable from the
    catalog backfill and no event write should be judged by them. Broad on
    purpose: a database error is not the only way this fails (a stored URL the
    parse refuses, a provider constant gone stale), and none of those may
    surface as the response to a write that already landed.
    """
    try:
        enqueue_event(db, event)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("could not queue source archival for event %s", event.id, exc_info=True)


# How many events one backfill chunk hydrates. The walk is keyset-paged rather
# than one big result set, so a large catalog costs bounded memory and each
# chunk's inserts are one statement.
_BACKFILL_CHUNK = 200


def _backfill_chunk(
    db: Session, after: tuple[datetime, uuid.UUID] | None, size: int
) -> list[tuple[uuid.UUID, str | None, Any, datetime]]:
    """One page of events that carry no archival rows at all, oldest first.

    ``NOT EXISTS`` is what makes the sweep converge: an event enqueued by a
    previous click or by its own write path drops out of the scan, so a second
    click covers the next page instead of re-reading the same head of the
    catalog. Demo rows are excluded outright (their sentinel source resolves
    nowhere and a capture attempt would spend real Wayback budget), and the
    keyset cursor is ``(created_at, id)`` so an event that yields no links
    still advances the walk.
    """
    query = db.query(Event.id, Event.source_url, Event.proof, Event.created_at).filter(
        Event.deleted_at.is_(None),
        Event.is_demo.is_(False),
        ~Event.archives.any(),
    )
    if after is not None:
        query = query.filter(tuple_(Event.created_at, Event.id) > after)
    return query.order_by(Event.created_at, Event.id).limit(size).all()


def enqueue_catalog(db: Session, *, limit: int | None = None) -> dict[str, int]:
    """Enqueue archival for live events that carry no archival rows.

    The backfill over the existing catalog, exposed as an admin Maintenance
    action. Walks live non-demo events oldest first (the ones whose sources
    have had the longest to die), enqueues whatever they carry, and returns the
    counts. No HTTP happens here: the rows are queue entries the worker drains
    at its own paced rate. ``limit`` caps one click's scan, and because an
    enqueued event leaves the scan, the next click continues past it rather
    than re-reading the same page.
    """
    events_scanned = 0
    links_enqueued = 0
    after: tuple[datetime, uuid.UUID] | None = None
    while limit is None or events_scanned < limit:
        size = _BACKFILL_CHUNK if limit is None else min(_BACKFILL_CHUNK, limit - events_scanned)
        chunk = _backfill_chunk(db, after, size)
        if not chunk:
            break
        secondary = _secondary_links_for(db, [row[0] for row in chunk])
        rows: list[dict] = []
        for event_id, source_url, proof, created_at in chunk:
            events_scanned += 1
            after = (created_at, event_id)
            try:
                rows.extend(
                    _queue_rows(
                        event_id,
                        _collect_links(source_url, proof, secondary.get(event_id, [])),
                    )
                )
            except Exception:  # noqa: BLE001
                # One unreadable proof body (a stored doc nested past what the
                # walk can recurse) is a row to skip, not the end of the sweep.
                logger.warning(
                    "source archival backfill could not read event %s", event_id, exc_info=True
                )
        links_enqueued += _insert_chunk(db, rows)
    return {"events_scanned": events_scanned, "links_enqueued": links_enqueued}


def _insert_chunk(db: Session, rows: list[dict]) -> int:
    """A chunk's rows in one statement, falling back to per-event inserts.

    One value Postgres refuses to store (a NUL byte inside a URL) would
    otherwise take the whole chunk down with it, so a failed chunk is replayed
    one event at a time and the sweep loses only the bad row.
    """
    try:
        return _insert_links(db, rows)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("source archival backfill chunk failed, retrying per event", exc_info=True)
    inserted = 0
    by_event: dict[uuid.UUID, list[dict]] = {}
    for row in rows:
        by_event.setdefault(row["event_id"], []).append(row)
    for event_id, event_rows in by_event.items():
        try:
            inserted += _insert_links(db, event_rows)
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.warning("source archival backfill skipped event %s", event_id, exc_info=True)
    return inserted


def claim_next(db: Session) -> SourceArchive | None:
    """Claim the oldest runnable row, or ``None`` when nothing is due.

    Runnable: ``queued`` with ``next_attempt_at`` in the past (a fresh row is
    due immediately, a retried one after its backoff), or ``running`` past the
    stale window (a worker died mid-capture). ``FOR UPDATE SKIP LOCKED`` makes
    the claim safe under concurrent workers; the commit publishes the
    ``running`` stamp and releases the lock, and the stale window is what
    guards a crash after that point.

    Rows whose event has been soft-deleted are skipped: an admin taking an
    event down must not be followed by this queue pushing its links to a
    public archive. ``OF source_archives`` keeps the join from locking the
    ``events`` row alongside the queue row.
    """
    now = datetime.now(UTC)
    row = (
        db.query(SourceArchive)
        .join(Event, Event.id == SourceArchive.event_id)
        .filter(
            Event.deleted_at.is_(None),
            or_(
                (SourceArchive.status == "queued") & (SourceArchive.next_attempt_at <= now),
                (SourceArchive.status == "running")
                & (SourceArchive.started_at < now - STALE_RUNNING_AFTER),
            ),
        )
        .order_by(SourceArchive.next_attempt_at)
        .with_for_update(skip_locked=True, of=SourceArchive)
        .first()
    )
    if row is None:
        return None
    row.status = "running"
    row.attempts += 1
    row.started_at = now
    db.commit()
    db.refresh(row)
    return row


def _spn_headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": _USER_AGENT}
    if settings.archive_org_access_key and settings.archive_org_secret_key:
        headers["Authorization"] = (
            f"LOW {settings.archive_org_access_key}:{settings.archive_org_secret_key}"
        )
    return headers


def _spn_json(response: httpx.Response) -> dict:
    """The JSON body of a Save Page Now response, or a retryable failure.

    Save Page Now answers an over-quota submit with 429 and an outage with
    5xx / HTML; either way there is no capture to store, so both fold into the
    one retryable error the caller backs off on.
    """
    if response.status_code == 429:
        raise ArchiveUnavailableError("rate limited")
    if response.status_code >= 500:
        raise ArchiveUnavailableError(f"service error {response.status_code}")
    try:
        body = response.json()
    except ValueError as exc:
        raise ArchiveUnavailableError("unparseable response") from exc
    if not isinstance(body, dict):
        raise ArchiveUnavailableError("unexpected response shape")
    return body


def _archive_wayback(url: str, *, client: httpx.Client) -> str:
    """Capture one URL through Save Page Now; return its replay URL.

    Two legs, per the SPN2 contract: a submit that answers with a ``job_id``,
    then a status poll until that job reports ``success`` with the capture
    timestamp. ``if_not_archived_within`` makes a recently captured URL come
    back from the existing snapshot instead of costing a fresh crawl.
    """
    submit = client.post(
        _SPN_SUBMIT_URL,
        headers=_spn_headers(),
        data={
            "url": url,
            "if_not_archived_within": IF_NOT_ARCHIVED_WITHIN,
            # Outlinks and screenshots multiply the crawl cost for evidence
            # nobody reads back; the page itself is what has to survive.
            "capture_outlinks": "0",
            "capture_screenshot": "0",
            "skip_first_archive": "1",
        },
    )
    body = _spn_json(submit)
    # A submit can answer with the existing capture directly (no job to poll).
    if body.get("timestamp") and body.get("original_url"):
        return _replay_url(str(body["timestamp"]), str(body["original_url"]))
    job_id = body.get("job_id")
    if not job_id:
        # A refusal with a reason (robots-blocked, a host SPN cannot reach) is
        # still counted retryable: the reasons are frequently transient, and
        # MAX_ATTEMPTS is what stops a permanent one.
        raise ArchiveUnavailableError(str(body.get("message") or "submit refused"))

    for _ in range(_STATUS_POLL_ATTEMPTS):
        time.sleep(_STATUS_POLL_INTERVAL_S)
        status = _spn_json(client.get(f"{_SPN_STATUS_URL}/{job_id}", headers=_spn_headers()))
        state = status.get("status")
        if state == "success":
            timestamp = status.get("timestamp")
            captured = status.get("original_url") or url
            if not timestamp:
                raise ArchiveUnavailableError("success without a timestamp")
            return _replay_url(str(timestamp), str(captured))
        if state == "error":
            raise ArchiveUnavailableError(str(status.get("message") or "capture failed"))
    raise ArchiveUnavailableError("capture still pending")


def _replay_url(timestamp: str, original: str) -> str:
    """The stable Wayback replay URL for one capture."""
    return f"{_WAYBACK_REPLAY}/{timestamp}/{original}"


def _archive_today(url: str, *, client: httpx.Client) -> str:
    """Capture one URL through archive.today; return its snapshot URL.

    No API: the submit form answers either with a ``Refresh`` header pointing
    at the fresh snapshot or with a redirect to an existing one, so the
    snapshot URL is read off the response rather than a documented field.
    Opt-in (``archive_today_enabled``) and only ever the second leg.
    """
    response = client.get(
        _ARCHIVE_TODAY_SUBMIT,
        params={"url": url},
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=False,
    )
    refresh = response.headers.get("refresh", "")
    if "url=" in refresh:
        return _validated_snapshot(refresh.split("url=", 1)[1].strip())
    location = response.headers.get("location")
    if location:
        return _validated_snapshot(location)
    raise ArchiveUnavailableError(f"no snapshot in response {response.status_code}")


def _validated_snapshot(url: str) -> str:
    """A snapshot URL read off a response header, checked before it is stored.

    archive.today has no API contract, so the value comes from a header the
    service writes and the read surface later renders as an ``href``. It goes
    through the same predicate every stored link does; a value that fails it is
    a failed capture, not something to persist.
    """
    if not _is_archivable(url):
        raise ArchiveUnavailableError("snapshot URL is not an http(s) link")
    return url


def capture(url: str, *, client: httpx.Client | None = None) -> tuple[SourceArchiveProvider, str]:
    """Archive one URL; return ``(provider, archived_url)``.

    Wayback first, archive.today second when it is enabled: the fallback only
    runs on a Wayback failure, so the normal path stays one provider and the
    optional one absorbs a Wayback outage. Raises
    :class:`ArchiveUnavailableError` when neither produced a capture.

    A transport failure hands over to the fallback the same way a refusal
    does: a Wayback outage is exactly the case where the second provider earns
    its place, and it reaches this code as ``httpx.ConnectError`` or a timeout
    rather than as a refusal from the service.
    """

    def run(c: httpx.Client) -> tuple[SourceArchiveProvider, str]:
        try:
            return "wayback", _archive_wayback(url, client=c)
        except (ArchiveUnavailableError, httpx.HTTPError) as exc:
            if not settings.archive_today_enabled:
                raise
            logger.info("wayback capture failed (%s), trying archive.today", type(exc).__name__)
        return "archive_today", _archive_today(url, client=c)

    if client is not None:
        return run(client)
    with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own:
        return run(own)


def _backoff(attempts: int) -> timedelta:
    """Exponential delay before the next attempt, capped.

    Doubles per attempt from :data:`BASE_BACKOFF`, capped at
    :data:`MAX_BACKOFF`, which the last wait of the :data:`MAX_ATTEMPTS`
    ladder actually reaches.
    """
    # The exponent is clamped before the multiply, not after: a large attempt
    # count would otherwise build a timedelta past its own representable range
    # and raise instead of capping.
    steps = min(max(attempts - 1, 0), 16)
    return min(BASE_BACKOFF * (2**steps), MAX_BACKOFF)


def process(db: Session, row: SourceArchive, *, client: httpx.Client | None = None) -> bool:
    """Run one claimed row to a terminal or retry state; ``True`` on capture.

    Success stamps ``archived_url`` + ``provider`` and lands ``done``. A
    failure goes back to ``queued`` behind :func:`_backoff`, or lands ``failed``
    once the attempt budget is spent (the poison-pill guard: a link behind a
    login wall must not consume the pass budget forever). Never raises for a
    capture failure; the row carries the outcome.
    """
    try:
        provider, archived_url = capture(row.original_url, client=client)
    except ArchiveUnavailableError as exc:
        return _reschedule(db, row, str(exc)[:500])
    except httpx.HTTPError as exc:
        # A transport failure is the same class of retryable as a 5xx; keeping
        # it out of ArchiveUnavailableError means the provider legs don't have
        # to wrap every call site.
        return _reschedule(db, row, f"transport: {type(exc).__name__}")
    except Exception as exc:  # noqa: BLE001
        # Anything the two branches above did not name (a provider answering a
        # shape the parse trips on) would otherwise escape and leave the row
        # ``running`` until the stale window expires. The queue heals itself
        # instead: same ladder, same attempt budget.
        logger.warning("unexpected failure archiving %s", row.original_url, exc_info=True)
        return _reschedule(db, row, f"unexpected: {type(exc).__name__}")

    row.status = "done"
    row.provider = provider
    row.archived_url = archived_url
    row.error = None
    row.finished_at = datetime.now(UTC)
    db.commit()
    return True


def _reschedule(db: Session, row: SourceArchive, reason: str) -> bool:
    """Send a failed attempt back to ``queued``, or bury it once out of budget.

    Always returns ``False`` so a caller can ``return`` it directly as the
    "no capture" outcome.
    """
    if row.attempts >= MAX_ATTEMPTS:
        row.status = "failed"
        row.finished_at = datetime.now(UTC)
    else:
        row.status = "queued"
        row.next_attempt_at = datetime.now(UTC) + _backoff(row.attempts)
        # ``started_at`` belongs to the claim that just ended. Leaving the old
        # stamp on a queued row makes it look like a claim in flight to anyone
        # reading the table, and it is what the stale-window reclaim measures.
        row.started_at = None
    row.error = reason
    db.commit()
    return False


def run_once(db: Session, *, budget: int = PASS_BUDGET, client: httpx.Client | None = None) -> int:
    """Drain up to ``budget`` runnable rows; return how many were attempted.

    Blocking by design: the pacing below and the status poll are
    ``time.sleep``, and the worker runs this on a thread of its own so those
    waits are the archiving services' problem rather than the other queues'
    (see ``scripts/run_import_worker.py``). Tests pass their own ``client`` to
    run an enqueued capture synchronously.

    A pass ends at ``budget`` rows or :data:`PASS_MAX_SECONDS`, whichever comes
    first. The :data:`REQUEST_SPACING` gap is paid before each capture except
    the first, so a pass never sleeps after its last row, and one HTTP client
    is reused across the pass so connection setup isn't repaid per capture.
    """
    deadline = time.monotonic() + PASS_MAX_SECONDS

    def drain(c: httpx.Client) -> int:
        handled = 0
        while handled < budget and time.monotonic() < deadline:
            if (row := claim_next(db)) is None:
                break
            if handled:
                time.sleep(REQUEST_SPACING.total_seconds())
            process(db, row, client=c)
            handled += 1
        return handled

    if client is not None:
        return drain(client)
    with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own:
        return drain(own)


def archived_url_for(event: Event, url: str | None) -> str | None:
    """The archived copy of one of the event's links, or ``None``.

    Reads the already-loaded ``archives`` collection rather than querying, so
    the read surfaces pay one eager load for the whole payload instead of a
    lookup per event.
    """
    if not url:
        return None
    for row in event.archives:
        if row.original_url == url and row.archived_url:
            return row.archived_url
    return None


__all__ = [
    "ArchiveUnavailableError",
    "archived_url_for",
    "capture",
    "claim_next",
    "collect_links",
    "enqueue_catalog",
    "enqueue_event",
    "enqueue_event_best_effort",
    "process",
    "run_once",
]
