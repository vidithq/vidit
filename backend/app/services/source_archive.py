"""The durable source-archival queue: enqueue at event write, drain in the worker.

A source tweet gets deleted and an account gets suspended, which destroys
exactly the evidence the catalog promises to preserve. Every event, whatever
its status (a machine ``detected`` draft included, since a draft can wait weeks
before publication and its source can die in the interval), gets its links
pushed to the Wayback Machine so a dead original still has a readable copy.

Which links: the event's ``source_url`` plus every ``http(s)`` href carried by
a link mark in the proof body's Tiptap document. One
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
most :data:`PASS_BUDGET` rows and spaces its calls by
:data:`REQUEST_SPACING`. A failed attempt goes back to ``queued`` with an
exponential ``next_attempt_at`` (:data:`BASE_BACKOFF` doubling per attempt,
capped at :data:`MAX_BACKOFF`); :data:`MAX_ATTEMPTS` bounds the retries so a
permanently uncapturable link (a login wall, a robots block) lands ``failed``
instead of consuming budget forever.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import Event
from app.models.source_archive import SourceArchive, SourceArchiveOrigin
from app.services.sanitize import extract_link_hrefs

logger = logging.getLogger(__name__)

# One pass takes at most this many rows. Bounds a pass's wall-clock cost (each
# capture is a submit plus a status poll) and keeps the worker's other queues
# from starving behind a large backfill.
PASS_BUDGET = 20
# Minimum gap between two capture submissions. Save Page Now's documented
# ceiling is well above this; the gap is what keeps a backfill from reading as
# a burst.
REQUEST_SPACING = timedelta(seconds=6)
MAX_ATTEMPTS = 5
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

    Only ``http(s)`` URLs with a hostname. Filters the sentinel sources demo
    seeding writes (they resolve nowhere) and any pre-allowlist row that
    predates :func:`sanitize._safe_link_href`.
    """
    parsed = urlparse(url)
    return parsed.scheme.lower() in {"http", "https"} and bool(parsed.hostname)


def collect_links(event: Event) -> list[tuple[str, SourceArchiveOrigin]]:
    """Every archivable link on an event, ``source_url`` first, deduped.

    The proof body's hrefs come from :func:`sanitize.extract_link_hrefs`, so
    the Tiptap walk has one home. A link that appears both as the source and
    inside the proof is kept once, attributed to the source (the stronger
    provenance).
    """
    links: list[tuple[str, SourceArchiveOrigin]] = []
    seen: set[str] = set()

    def add(url: str, origin: SourceArchiveOrigin) -> None:
        if url in seen or not _is_archivable(url):
            return
        seen.add(url)
        links.append((url, origin))

    if event.source_url:
        add(event.source_url, "source_url")
    for href in extract_link_hrefs(event.proof):
        add(href, "proof_link")
    return links


def enqueue_event(db: Session, event: Event) -> int:
    """Insert the ``queued`` rows for an event's links; return how many landed.

    Idempotent on ``(event_id, original_url)``, so the create paths, the
    geolocate promotion, an edit that adds a citation, and the backfill all
    call it freely. Commits: the caller's event write is already durable by
    this point, and the archival rows are not part of its transaction contract.

    Never raises on a losing race. Two concurrent enqueues of the same event
    (an edit landing while the backfill sweeps) both see an empty pre-check and
    one hits the unique constraint; the loser's row is already there, which is
    the outcome either way.
    """
    links = collect_links(event)
    if not links:
        return 0
    existing = set(
        db.scalars(
            select(SourceArchive.original_url).where(SourceArchive.event_id == event.id)
        ).all()
    )
    inserted = 0
    for url, origin in links:
        if url in existing:
            continue
        db.add(SourceArchive(event_id=event.id, original_url=url, origin=origin))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        inserted += 1
    return inserted


def enqueue_event_best_effort(db: Session, event: Event) -> None:
    """:func:`enqueue_event`, with a database failure downgraded to a log line.

    What every write path calls. The event write it follows is already
    committed, so letting an enqueue failure escape would turn a durable create
    into a 500 for the analyst; the archival rows are recoverable from the
    catalog backfill and no event write should be judged by them.
    """
    try:
        enqueue_event(db, event)
    except SQLAlchemyError:
        db.rollback()
        logger.warning("could not queue source archival for event %s", event.id)


def enqueue_catalog(db: Session, *, limit: int | None = None) -> dict[str, int]:
    """Enqueue archival for live events that have untracked links.

    The backfill over the existing catalog, exposed as an admin Maintenance
    action. Walks live events oldest first (the ones whose sources have had the
    longest to die), enqueues whatever they carry, and returns the counts. The
    per-event idempotency means a second run only picks up what the first
    missed or what has been written since, so the button is safe to click
    twice; ``limit`` caps one click's scan when the catalog is large.
    """
    query = db.query(Event).filter(Event.deleted_at.is_(None)).order_by(Event.created_at)
    if limit is not None:
        query = query.limit(limit)
    events_scanned = 0
    links_enqueued = 0
    for event in query.all():
        events_scanned += 1
        links_enqueued += enqueue_event(db, event)
    return {"events_scanned": events_scanned, "links_enqueued": links_enqueued}


def claim_next(db: Session) -> SourceArchive | None:
    """Claim the oldest runnable row, or ``None`` when nothing is due.

    Runnable: ``queued`` with ``next_attempt_at`` in the past (a fresh row is
    due immediately, a retried one after its backoff), or ``running`` past the
    stale window (a worker died mid-capture). ``FOR UPDATE SKIP LOCKED`` makes
    the claim safe under concurrent workers; the commit publishes the
    ``running`` stamp and releases the lock, and the stale window is what
    guards a crash after that point.
    """
    now = datetime.now(UTC)
    row = (
        db.query(SourceArchive)
        .filter(
            or_(
                (SourceArchive.status == "queued") & (SourceArchive.next_attempt_at <= now),
                (SourceArchive.status == "running")
                & (SourceArchive.started_at < now - STALE_RUNNING_AFTER),
            )
        )
        .order_by(SourceArchive.next_attempt_at)
        .with_for_update(skip_locked=True)
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
        return refresh.split("url=", 1)[1].strip()
    location = response.headers.get("location")
    if location and location.startswith("http"):
        return location
    raise ArchiveUnavailableError(f"no snapshot in response {response.status_code}")


def capture(url: str, *, client: httpx.Client | None = None) -> tuple[str, str]:
    """Archive one URL; return ``(provider, archived_url)``.

    Wayback first, archive.today second when it is enabled: the fallback only
    runs on a Wayback failure, so the normal path stays one provider and the
    optional one absorbs a Wayback outage. Raises
    :class:`ArchiveUnavailableError` when neither produced a capture.
    """

    def run(c: httpx.Client) -> tuple[str, str]:
        try:
            return "wayback", _archive_wayback(url, client=c)
        except ArchiveUnavailableError:
            if not settings.archive_today_enabled:
                raise
            logger.info("wayback capture failed, trying archive.today")
        return "archive_today", _archive_today(url, client=c)

    if client is not None:
        return run(client)
    with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own:
        return run(own)


def _backoff(attempts: int) -> timedelta:
    """Exponential delay before the next attempt, capped.

    Doubles per attempt from :data:`BASE_BACKOFF`. Capped so a link that has
    burned several attempts still gets its last one inside a day.
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

    row.status = "done"
    row.provider = provider  # type: ignore[assignment]
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
    row.error = reason
    db.commit()
    return False


def run_once(db: Session, *, budget: int = PASS_BUDGET, client: httpx.Client | None = None) -> int:
    """Drain up to ``budget`` runnable rows; return how many were attempted.

    The worker loop calls this every pass; tests pass their own ``client`` to
    run an enqueued capture synchronously. Calls are spaced by
    :data:`REQUEST_SPACING` (the gap is skipped after the last row, so a
    single-row pass pays nothing), and one HTTP client is reused across the
    pass so connection setup isn't repaid per capture.
    """

    def drain(c: httpx.Client) -> int:
        handled = 0
        while handled < budget and (row := claim_next(db)) is not None:
            process(db, row, client=c)
            handled += 1
            if handled < budget:
                time.sleep(REQUEST_SPACING.total_seconds())
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
