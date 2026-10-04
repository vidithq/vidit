"""Analyst-recorded source archival: validate a pasted snapshot, store one row.

The analyst archives a link from their own browser and pastes the snapshot
URL into the form (``source_snapshot_url``, ``secondary_snapshot_urls``,
``detected_from_snapshot_url``); it lands in the same transaction as the event.

The capture is not attempted server side: most sources are ``x.com``, which
Save Page Now refuses, and archive.today has no API and bans hosts that submit
in bursts. This module checks and stores what comes back.

Archivable links: ``source_url``, the secondary mirrors, ``detected_from_url``,
and every ``http(s)`` link mark in the proof body. :func:`collect_links` is the
one walk, and :func:`reconcile_source_archive` re-files stored rows against it.

Recording a copy on a ``geolocated`` event is a tracked change: the edit files
the superseded version via ``services/versions.file_version`` (change name
*Archived copies*). Below publication nothing is versioned. A paste equal to
the stored copy (:func:`same_snapshot`) changes nothing.

One copy per link: ``SourceArchive`` is unique on ``(event_id, original_url)``,
so a better paste corrects the row.

:func:`validate_snapshot` checks where a snapshot lives (``https``, a host in
:data:`PROVIDER_HOSTS`, that provider's path shape), never what it captured.
The server must not fetch the page, and the pasting owner is the one a wrong
link degrades; the forms warn, without blocking, on a snapshot that visibly
replays another link.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.event import SOURCE_URL_MAX_LENGTH, Event
from app.models.source_archive import (
    SourceArchive,
    SourceArchiveOrigin,
    SourceArchiveProvider,
)
from app.services.sanitize import extract_link_hrefs, normalised_host, safe_link_href

# Hosts a snapshot may live on. The allowlist is the abuse bound: the catalog
# renders the URL as an outbound link. archive.today serves one set of
# snapshots under six interchangeable domains. Mirrored by
# `ArchivedCopies.tsx::SNAPSHOT_HOSTS` (keys) and `lib/snapshots.ts`
# (`WAYBACK_HOST`, `ARCHIVE_TODAY_HOSTS`).
PROVIDER_HOSTS: dict[str, SourceArchiveProvider] = {
    "web.archive.org": "wayback",
    "archive.ph": "archive_today",
    "archive.today": "archive_today",
    "archive.is": "archive_today",
    "archive.md": "archive_today",
    "archive.li": "archive_today",
    "archive.vn": "archive_today",
    "ghostarchive.org": "ghostarchive",
}

# Wayback replay path ``/web/<timestamp>/<original url>``: up to 14 digits
# (``YYYYMMDDhhmmss``, truncated on older captures) plus an optional replay
# modifier (``id_``, ``if_``, ...). Mirrored by `lib/snapshots.ts`.
_WAYBACK_REPLAY_RE = re.compile(r"^/web/(\d{4,14})(?:[a-z]{2}_)?/(.+)$", re.IGNORECASE)

# archive.today snapshot path: ``/<code>`` (short base62; the ceiling is
# headroom) or ``/<timestamp>/<original url>`` (see the capture regex).
_ARCHIVE_TODAY_CODE_RE = re.compile(r"^/([A-Za-z0-9]{4,16})/?$")

# The digit timestamp tells a capture from ``/newest/<url>``, a lookup that
# resolves to whatever the service holds today. Mirrored by `lib/snapshots.ts`.
_ARCHIVE_TODAY_CAPTURE_RE = re.compile(r"^/\d{4,14}/.+$")

# ``/archive/<id>`` (page) or ``/varchive/<id>`` (video, a YouTube id).
# Bounded charset and length as an abuse bound, not the exact id grammar.
_GHOSTARCHIVE_PATH_RE = re.compile(r"^/v?archive/[A-Za-z0-9_-]{4,20}/?$")

# Same ceiling as the source URL column; a longer paste is an accident.
SNAPSHOT_URL_MAX_LENGTH = SOURCE_URL_MAX_LENGTH


class SnapshotRejected(Exception):
    """The pasted URL is not a snapshot address, or names a link the event lacks.

    The per-instance ``code`` is translated by
    :func:`app.routers._errors.raise_typed_error` and says which check failed.
    """

    code: str = "snapshot_url_invalid"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _is_archivable(url: str) -> bool:
    """Whether a stored link can have a copy recorded.

    Uses :func:`sanitize.safe_link_href`, plus a length ceiling: a value past
    the ``source_url`` limit would abort the insert on the unique btree index.
    """
    if len(url.encode()) > SOURCE_URL_MAX_LENGTH:
        return False
    return safe_link_href(url) is not None


def collect_links(event: Event) -> list[tuple[str, SourceArchiveOrigin]]:
    """Every archivable link on an event, ``source_url`` first, deduped.

    A duplicate keeps the first origin reached (source, mirror, detected-from,
    proof citation), the strongest provenance. The forms offer an archive
    affordance for this set, and :func:`reconcile_source_archive` files against it.
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
    for link in event.source_links:
        add(link.url, "secondary_source")
    if event.detected_from_url:
        add(event.detected_from_url, "detected_from")
    for href in extract_link_hrefs(event.proof):
        add(href, "proof_link")
    return links


def origin_of(event: Event, url: str) -> SourceArchiveOrigin | None:
    """The origin of ``url`` on ``event``, or ``None`` if the event lacks it."""
    for candidate, origin in collect_links(event):
        if candidate == url:
            return origin
    return None


def _normalised_target(url: str) -> tuple[str, str, str] | None:
    """``(host, path, query)`` for comparing two spellings of one link.

    Drops scheme, host case, leading ``www.`` (via :func:`sanitize.normalised_host`)
    and trailing slash.
    """
    host = normalised_host(url)
    if host is None:
        return None
    # ``normalised_host`` already proved the value parses.
    parsed = urlparse(url)
    return host, parsed.path.rstrip("/"), parsed.query


def same_snapshot(stored: str | None, pasted: str) -> bool:
    """Whether ``pasted`` names the copy a link already holds.

    Folds through :func:`_normalised_target` so a re-paste with a trailing
    slash or other host case is not filed as a correction. ``None`` never matches.
    """
    if stored is None:
        return False
    if stored == pasted:
        return True
    left = _normalised_target(stored)
    return left is not None and left == _normalised_target(pasted)


def validate_snapshot(snapshot_url: str) -> SourceArchiveProvider:
    """Return the provider holding a pasted snapshot URL, else raise :class:`SnapshotRejected`.

    Checks, in order:

    * ``https`` only, within :data:`SNAPSHOT_URL_MAX_LENGTH`.
    * The host is in :data:`PROVIDER_HOSTS`.
    * ``web.archive.org``: ``/web/<timestamp>/<original>``.
    * archive.today: ``/<code>`` or ``/<timestamp>/<original url>`` (a
      ``/newest/<url>`` lookup is refused).
    * ``ghostarchive.org``: ``/archive/<id>`` or ``/varchive/<id>``.

    What the snapshot captured is not verified: short codes embed nothing, the
    embedded original spells the link as the platform did at capture time (so
    comparing refuses correct snapshots when platforms change URLs), and
    fetching archive.today from a server gets the IP banned. The host
    allowlist and path shape bound the field; the owner who pastes is the one
    a wrong link degrades.
    """
    if len(snapshot_url.encode()) > SNAPSHOT_URL_MAX_LENGTH:
        raise SnapshotRejected(
            "snapshot_url_too_long", "That link is too long to be an archive snapshot."
        )
    try:
        parsed = urlparse(snapshot_url)
    except ValueError as exc:
        raise SnapshotRejected("snapshot_url_invalid", "That is not a URL.") from exc
    if parsed.scheme != "https":
        raise SnapshotRejected("snapshot_url_not_https", "An archive link must be https.")
    provider = PROVIDER_HOSTS.get((parsed.hostname or "").lower())
    if provider is None:
        raise SnapshotRejected(
            "snapshot_provider_not_allowed",
            "An archive link must be on one of: " + ", ".join(PROVIDER_HOSTS) + ".",
        )
    if provider == "wayback":
        if _WAYBACK_REPLAY_RE.match(parsed.path) is None:
            raise SnapshotRejected(
                "snapshot_not_a_replay_url",
                "A Wayback Machine link must be a snapshot URL "
                "(web.archive.org/web/<timestamp>/<original link>).",
            )
        return provider
    if provider == "ghostarchive":
        if _GHOSTARCHIVE_PATH_RE.match(parsed.path) is None:
            raise SnapshotRejected(
                "snapshot_not_a_snapshot_code",
                "A Ghostarchive link must be a snapshot path "
                "(ghostarchive.org/archive/<id> or ghostarchive.org/varchive/<id>).",
            )
        return provider
    if (
        _ARCHIVE_TODAY_CODE_RE.match(parsed.path) is None
        and _ARCHIVE_TODAY_CAPTURE_RE.match(parsed.path) is None
    ):
        raise SnapshotRejected(
            "snapshot_not_a_snapshot_code",
            "An archive.today link must be a snapshot code (archive.ph/<code>) or a "
            "capture URL (archive.ph/<timestamp>/<original link>).",
        )
    return provider


def stage_snapshot(
    db: Session,
    *,
    event: Event,
    original_url: str,
    origin: SourceArchiveOrigin,
    snapshot_url: str,
) -> None:
    """Validate a snapshot and stage its row without committing.

    The one write for the standalone endpoint and for the snapshot a submit or
    edit carries; a later caller failure takes the row down with its write.

    An upsert on ``(event_id, original_url)``: a second snapshot replaces the
    first. ``origin`` refreshes too, since the URL may have moved between pastes.
    """
    provider = validate_snapshot(snapshot_url)
    now = datetime.now(UTC)
    db.execute(
        pg_insert(SourceArchive)
        .values(
            id=uuid.uuid4(),
            event_id=event.id,
            original_url=original_url,
            origin=origin,
            snapshot_url=snapshot_url,
            provider=provider,
            created_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_source_archives_event_url",
            set_={
                "origin": origin,
                "snapshot_url": snapshot_url,
                "provider": provider,
                "created_at": now,
            },
        )
    )


def stage_source_snapshot(db: Session, *, event: Event, snapshot_url: str) -> None:
    """Stage the copy of ``event.source_url`` posted as ``source_snapshot_url``.

    Filed under origin ``source_url``; no membership walk is needed since the
    link is the one being written. Call after ``event.id`` exists and before
    the caller's commit.
    """
    if event.source_url is None:
        raise SnapshotRejected(
            "original_url_not_on_event", "That link is not one of this event's sources."
        )
    stage_snapshot(
        db,
        event=event,
        original_url=event.source_url,
        origin="source_url",
        snapshot_url=snapshot_url,
    )


def stage_detected_from_snapshot(db: Session, *, event: Event, snapshot_url: str) -> None:
    """Stage the copy of ``event.detected_from_url`` posted as ``detected_from_snapshot_url``.

    Provenance twin of :func:`stage_source_snapshot`, filed under origin
    ``detected_from``. The link is immutable, so nothing reconciles.
    """
    if event.detected_from_url is None:
        raise SnapshotRejected(
            "original_url_not_on_event", "That link is not one of this event's sources."
        )
    stage_snapshot(
        db,
        event=event,
        original_url=event.detected_from_url,
        origin="detected_from",
        snapshot_url=snapshot_url,
    )


def stage_secondary_snapshots(db: Session, *, event: Event, snapshots: dict[str, str]) -> None:
    """Stage the copies of the mirrors posted beside them, under origin ``secondary_source``.

    ``snapshots`` maps a mirror URL to its snapshot
    (``services/events.pair_secondary_snapshots``). It is keyed by link, not
    position, because normalization drops blank, duplicate and primary-equal
    entries; a snapshot beside a dropped mirror is dropped too.

    Call once ``event.source_links`` holds the submitted list, before the
    caller's commit.
    """
    for link in event.source_links:
        snapshot = snapshots.get(link.url)
        if snapshot:
            stage_snapshot(
                db,
                event=event,
                original_url=link.url,
                origin="secondary_source",
                snapshot_url=snapshot,
            )


def reconcile_source_archive(db: Session, *, event: Event) -> None:
    """Keep the copy filed as the declared source matching ``source_url``.

    A row under origin ``source_url`` whose ``original_url`` is no longer the
    source URL is a mismatch that must not survive a write:

    * the old URL is still one of the event's links: the row stays and takes
      that link's origin;
    * it is gone from the event: the row is deleted.

    Conversely, a copy recorded against a mirror, proof citation or provenance
    link takes origin ``source_url`` when that link becomes the source, rather
    than a second row being minted.

    An edit that changes the source and pastes no snapshot leaves no archived
    source rather than a stale one.

    Runs in the caller's transaction. Mirrors are already replaced, but the
    proof body is still the stored one (a write applies its proof at commit).
    """
    for row in list(event.archives):
        if row.original_url == event.source_url:
            row.origin = "source_url"
            continue
        if row.origin != "source_url":
            continue
        origin = origin_of(event, row.original_url)
        if origin is None:
            db.delete(row)
        else:
            row.origin = origin


def drop_mirror_archives(db: Session, *, event: Event, kept: list[str]) -> None:
    """Delete the copies of mirrors a write no longer carries.

    Mirror twin of :func:`reconcile_source_archive`. Only ``secondary_source``
    rows for removed links go; other origins are left to reconcile.

    The event's ``source_url`` row is never dropped here: normalization strips
    the mirror equal to the source, so promoting an archived mirror hands a
    ``kept`` list without it, and deleting would destroy that copy.
    :func:`reconcile_source_archive` then re-files it.

    ``kept`` is the normalized mirror list being stored. Call after the
    superseded version is filed (it keeps its copies) and before the commit.
    """
    surviving = set(kept)
    for row in list(event.archives):
        if row.original_url == event.source_url:
            continue
        if row.origin == "secondary_source" and row.original_url not in surviving:
            db.delete(row)


def archive_row_for(event: Event, url: str | None) -> SourceArchive | None:
    """This event's archived copy of one of its links, or ``None``.

    Reads the loaded ``archives`` collection, so read surfaces avoid a query per event.
    """
    if not url:
        return None
    for row in event.archives:
        if row.original_url == url:
            return row
    return None


__all__ = [
    "PROVIDER_HOSTS",
    "SNAPSHOT_URL_MAX_LENGTH",
    "SnapshotRejected",
    "archive_row_for",
    "collect_links",
    "drop_mirror_archives",
    "origin_of",
    "reconcile_source_archive",
    "same_snapshot",
    "stage_detected_from_snapshot",
    "stage_secondary_snapshots",
    "stage_snapshot",
    "stage_source_snapshot",
    "validate_snapshot",
]
