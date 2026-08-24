"""Analyst-recorded source archival: validate a pasted snapshot, store one row.

A source tweet gets deleted and an account gets suspended, which destroys
exactly the evidence the catalog promises to preserve. An archived copy is what
keeps a dead original readable, and the analyst is who makes it: they open the
provider's own submit page from their own browser and paste the snapshot URL
back. The forms are the one path that paste takes: they carry one field per
link they declare, ``source_snapshot_url`` beside the source URL, one
``secondary_snapshot_urls`` entry beside each mirror, and
``detected_from_snapshot_url`` beside the provenance link on the edit form, so
the copies are made while the links are in front of the analyst and land in the
same transaction as the event they belong to.

The capture is not attempted server side. Roughly nine in ten sources here are
``x.com``, which Save Page Now structurally refuses, and archive.today has no
API and answers a burst of server-side submissions by banning the submitting
host. Both are worked from a browser by the OSINT community every day, so the
browser is where the submission belongs; this module's job is to check what
comes back and to store it.

Which links can be archived: the event's ``source_url``, its secondary source
links (the analyst-submitted mirrors in ``event_source_links``), its
``detected_from_url`` (the analyst's post a machine detection came from),
and every ``http(s)`` href carried by a link mark in the proof body's Tiptap
document. :func:`collect_links` is the one home for that walk, and it is what
:func:`reconcile_source_archive` re-files a stored row against, so a copy never
claims to archive a URL the event does not carry.

An archived copy is part of what a published record says, so recording one on a
``geolocated`` event is a tracked change: the edit that carries the paste files
the version it supersedes through ``services/versions.file_version``, and the
history names the change *Archived copies*. Below publication (``requested`` /
``detected``) nothing is versioned, so the copy is stored on its own. A paste
equal to the copy the link already carries changes nothing and files nothing,
compared through :func:`same_snapshot` so a non-canonical spelling of the
stored copy is not read as a correction.

One copy per link, from whichever provider produced it. Two snapshots of one
link is redundancy the reader never asked for, and the read surface renders a
single icon; :data:`~app.models.source_archive.SourceArchive` is unique on
``(event_id, original_url)``, so the owner pasting a better snapshot corrects
the row rather than adding a competing one.

What counts as a snapshot is :func:`validate_snapshot`: ``https`` only, a host
on :data:`PROVIDER_HOSTS`, and that provider's path shape. It checks where a
snapshot lives, never what it captured. Most providers embed nothing to compare
against, the server must not fetch the page to find out, and the analyst pasting
the link is the authenticated owner of the record a wrong one degrades; the
submit forms warn on a Wayback URL that visibly replays another link, and the
warning blocks nothing.
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

# Every host a snapshot may live on, and the provider each one is. The
# allowlist is the abuse bound: the field takes a URL from an authenticated
# analyst and the catalog renders it as an outbound link, so "an archiving
# service" is spelled out host by host rather than inferred from the URL.
#
# archive.today serves one set of snapshots under six interchangeable domains,
# and which one an analyst is handed depends on where they are and which domain
# resolves for them, so all six map to one provider rather than five of them
# being read as somewhere else.
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

# A Wayback replay path: ``/web/<timestamp>/<original url>``. The timestamp is
# up to 14 digits (``YYYYMMDDhhmmss``, truncated on an older capture) and may
# carry one of the replay modifiers the player appends (``id_``, ``if_``,
# ``im_``, ``js_``, ``cs_``, ``oe_``).
_WAYBACK_REPLAY_RE = re.compile(r"^/web/(\d{4,14})(?:[a-z]{2}_)?/(.+)$", re.IGNORECASE)

# An archive.today snapshot path, in either spelling the service mints:
# ``/<code>``, the short base62 code a capture is addressed by, and
# ``/<timestamp>/<original url>``, the long form its own result pages link. The
# code ceiling is headroom, not a measurement of today's length.
_ARCHIVE_TODAY_CODE_RE = re.compile(r"^/([A-Za-z0-9]{4,16})/?$")

# The long form's first segment is a capture timestamp, and that is what tells it
# apart from ``/newest/<url>``: a lookup resolves to whatever the service holds
# today rather than to one fixed capture, so it is not a snapshot. A timestamp is
# digits and ``newest`` is not, which is the whole distinction.
_ARCHIVE_TODAY_CAPTURE_RE = re.compile(r"^/\d{4,14}/.+$")

# A ghostarchive snapshot path: ``/archive/<id>`` for a page capture and
# ``/varchive/<id>`` for a video one, whose id is the YouTube video id. Bounded
# charset and length rather than the exact id grammar, the latitude the
# archive.today code check takes for the same reason: the shape is an abuse
# bound, not a claim about what the id resolves to.
_GHOSTARCHIVE_PATH_RE = re.compile(r"^/v?archive/[A-Za-z0-9_-]{4,20}/?$")

# Same ceiling the archivable links themselves carry, applied to the snapshot:
# ``original_url`` and ``snapshot_url`` are both Text, but a URL past the
# column limit the event's own source obeys is a paste accident rather than a
# snapshot.
SNAPSHOT_URL_MAX_LENGTH = SOURCE_URL_MAX_LENGTH


class SnapshotRejected(Exception):
    """The pasted URL is not a snapshot address, or names a link the event lacks.

    Carries the stable ``code`` :func:`app.routers._errors.raise_typed_error`
    translates, so the analyst is told which of the checks their paste failed
    rather than "invalid". One class with a per-instance code rather than a
    subclass per check: every one of them is the same 400 about the same field.
    """

    code: str = "snapshot_url_invalid"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _is_archivable(url: str) -> bool:
    """Whether a stored link is one an analyst can record a copy of.

    The allowlist is :func:`sanitize.safe_link_href` (``http(s)`` with a
    hostname), called rather than restated, so a link the proof editor would
    refuse is not one this table tracks. On top of it, a length ceiling:
    ``(event_id, original_url)`` is a unique btree index, and a value past the
    ``source_url`` column's own limit would abort the insert carrying it.
    """
    if len(url.encode()) > SOURCE_URL_MAX_LENGTH:
        return False
    return safe_link_href(url) is not None


def collect_links(event: Event) -> list[tuple[str, SourceArchiveOrigin]]:
    """Every archivable link on an event, ``source_url`` first, deduped.

    The proof body's hrefs come from :func:`sanitize.extract_link_hrefs`, so
    the Tiptap walk has one home. Duplicates collapse to the first origin the
    walk reaches: the declared source, then an analyst-submitted mirror, then
    the post a machine detection came from, then a proof citation. That is
    the strongest provenance the event carries for the URL.

    Both halves of the archival contract read this: it is the set the forms
    offer an archive affordance for, and the set :func:`reconcile_source_archive`
    re-files a stored row against when the source URL moves.
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
    # The analyst's own post, which carries the geolocation claim: evidence of
    # who said what and when, with the same link rot as the footage source.
    if event.detected_from_url:
        add(event.detected_from_url, "detected_from")
    for href in extract_link_hrefs(event.proof):
        add(href, "proof_link")
    return links


def origin_of(event: Event, url: str) -> SourceArchiveOrigin | None:
    """Where ``url`` sits on ``event``, or ``None`` when it sits nowhere.

    The membership test and the origin to store, in one call: both answers come
    from the same walk, so a link cannot be accepted under one rule and
    labelled under another.
    """
    for candidate, origin in collect_links(event):
        if candidate == url:
            return origin
    return None


def _normalised_target(url: str) -> tuple[str, str, str] | None:
    """``(host, path, query)`` for comparing two spellings of one link.

    A URL reaches the form through a browser, which is where a trailing slash, a
    host in another case and a scheme of the browser's choosing come from.
    Comparing the raw strings would read two spellings of one address as two
    addresses, so the scheme, the host case, a leading ``www.`` and a trailing
    slash come off both sides. What is left is host, path and query.

    The host leg is :func:`sanitize.normalised_host`, the one home for that
    folding.
    """
    host = normalised_host(url)
    if host is None:
        return None
    # Safe to parse again: ``normalised_host`` already proved the value parses.
    parsed = urlparse(url)
    return host, parsed.path.rstrip("/"), parsed.query


def same_snapshot(stored: str | None, pasted: str) -> bool:
    """Whether ``pasted`` names the copy a link already holds.

    The no-change leg of an edit that carries archived copies. A snapshot URL
    reaches the form through a browser, which is where a trailing slash or a
    host in another case comes from, so comparing the raw strings would read a
    re-paste of the stored copy as a correction and file a version for it. The
    fold is :func:`_normalised_target`.

    ``None`` (the link holds no copy) is never the same as a paste.
    """
    if stored is None:
        return False
    if stored == pasted:
        return True
    left = _normalised_target(stored)
    return left is not None and left == _normalised_target(pasted)


def validate_snapshot(snapshot_url: str) -> SourceArchiveProvider:
    """Check that a pasted URL is a snapshot address, and say who holds it.

    Returns the provider the snapshot belongs to, inferred from its host, and
    raises :class:`SnapshotRejected` otherwise. The checks, in order:

    * ``https`` only, and no longer than :data:`SNAPSHOT_URL_MAX_LENGTH`.
    * The host is one of :data:`PROVIDER_HOSTS`.
    * A ``web.archive.org`` URL is a replay URL (``/web/<timestamp>/<original>``).
    * An archive.today URL is a snapshot code (``/<code>``) or a capture URL
      (``/<timestamp>/<original url>``), so a ``/newest/<url>`` lookup, which
      resolves to whatever the service holds today, is refused.
    * A ``ghostarchive.org`` URL is ``/archive/<id>`` or ``/varchive/<id>``.

    Where the snapshot lives is the whole check. What it captured is not
    verified, and cannot be: an archive.today code embeds nothing, ghostarchive
    ids embed nothing, and the one provider that does embed its original spells
    that original in whatever form the source platform used at capture time, so
    comparing it against the stored link refuses correct snapshots every time a
    platform changes its own URLs. Reading the page instead is not open either:
    fetching archive.today from a server is what gets the deployment's IP banned.

    So the trade is stated rather than hidden. The paste comes from the
    authenticated owner of the event, whose own catalog entry a wrong link
    degrades; the host allowlist and the path shape bound what the field can be
    used for; and the submit forms show a non-blocking warning when a Wayback URL
    visibly replays a different link.
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
    """Validate a snapshot and stage its row, leaving the transaction open.

    The one write both archival paths run: the standalone endpoint on a live
    event, and the ``source_snapshot_url`` a submit or an edit carries, which
    has to land in the same transaction as the event it archives. Nothing is
    committed here, so a caller that fails afterwards takes the row down with
    the rest of its write.

    The statement is an upsert on ``(event_id, original_url)``, which is the
    owner's correction path: a second snapshot for a link replaces the first
    rather than competing with it. ``origin`` is refreshed with it, since the
    same URL can have moved from a proof citation to the declared source
    between the two pastes.
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
    """Stage the copy of ``event.source_url`` a write path carried with it.

    What the submit and edit forms post as ``source_snapshot_url``: the analyst
    archived the source while filling the form, so the copy is filed against
    the source URL the same write stores, under origin ``source_url``. No
    membership walk is needed, since the link is the one being written, and the
    snapshot check is :func:`validate_snapshot`, so a paste is judged
    identically wherever it arrives.

    Call it before the caller's own commit and after ``event.id`` exists; the
    row rides that transaction.
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
    """Stage the copy of ``event.detected_from_url`` an edit carried with it.

    The provenance twin of :func:`stage_source_snapshot`. The post a machine
    detection came from carries the geolocation claim, and it rots exactly as
    the footage source does, so the edit form renders the archive mark on that
    locked field too and the paste posts as ``detected_from_snapshot_url``,
    filed under origin ``detected_from``.

    The link is immutable, so there is nothing to reconcile: it either exists
    on the row, in which case the copy is filed against it, or it does not, in
    which case the paste names a link the event does not carry.
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
    """Stage the copies of the mirrors a write path carried beside them.

    The mirror twin of :func:`stage_source_snapshot`: a mirror rots exactly as
    the primary does, so the submit and edit forms carry one archived-copy field
    per secondary source link and the pastes land in the same write, filed under
    origin ``secondary_source``.

    ``snapshots`` maps a mirror URL to the snapshot posted beside it
    (``services/events.pair_secondary_snapshots`` builds it from the two aligned
    form lists). Keyed by the link rather than by position, because
    normalization drops blank, duplicate and primary-equal entries, so a
    position would name a different mirror after the drop. The walk reads the
    links the event now carries, so a snapshot posted beside a mirror the write
    dropped is dropped with it.

    Call it once ``event.source_links`` holds the submitted list and before the
    caller's commit. Each paste runs the same :func:`validate_snapshot`, so a
    value that is not a snapshot address raises the same
    :class:`SnapshotRejected` codes here as anywhere else.
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

    A snapshot is a snapshot *of a link*, so a row filed under origin
    ``source_url`` whose ``original_url`` is no longer the event's source URL
    is a mismatch, and a mismatch must never survive a write. An edit that
    changes the source URL therefore either re-files that row or drops it:

    * the old URL is still one of the event's links (the analyst moved it to
      the mirrors, or cited it in the proof): the copy is real evidence of a
      link the event still carries, so the row stays and takes that link's
      origin;
    * the old URL is gone from the event: the row is deleted.

    The promotion is the same rule read the other way: a copy the analyst
    recorded against a mirror, a proof citation or the provenance link is a copy
    of the declared source once that link becomes ``source_url``, so its row
    takes the ``source_url`` origin instead of a second row being minted for a
    link that already has one.

    Either way nothing claims to archive the source URL but the copy of the
    source URL, so an edit that changes the source and pastes no new snapshot
    leaves the event with no archived source rather than a stale one. Pasting
    a ``source_snapshot_url`` with the same write fills the slot back in.

    Runs inside the caller's transaction, and reads the links the event carries
    at that moment: the mirrors are already replaced, while the proof body is
    still the stored one, since a write applies its new proof at commit.
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
    """Delete the copies of the mirrors a write no longer carries.

    The mirror twin of :func:`reconcile_source_archive`. The submitted list
    replaces the stored one wholesale, so a mirror the analyst removed is gone
    from the event, and a row filed under origin ``secondary_source`` for a link
    the event no longer declares archives nothing the record shows. A row whose
    URL survives elsewhere is left alone: only ``source_url`` demands a
    re-file, since it is the one origin the read surface reads by slot.

    The event's own ``source_url`` is never dropped here, whatever origin its
    row carries. Normalization strips the mirror equal to the source, so an edit
    promoting an archived mirror to ``source_url`` hands a ``kept`` list without
    it; deleting on that absence would destroy the copy of the very link the
    edit made the anchor. :func:`reconcile_source_archive`, which runs after
    this, re-files that row under origin ``source_url``.

    ``kept`` is the normalized mirror list this write stores. Call it after the
    version this write supersedes is filed, so that version keeps the copies it
    held, and before the caller's commit: the rows go with the rest of the
    write if anything downstream fails.
    """
    surviving = set(kept)
    for row in list(event.archives):
        if row.original_url == event.source_url:
            continue
        if row.origin == "secondary_source" and row.original_url not in surviving:
            db.delete(row)


def archive_row_for(event: Event, url: str | None) -> SourceArchive | None:
    """This event's archived copy of one of its links, or ``None``.

    Reads the already-loaded ``archives`` collection rather than querying, so
    the read surfaces pay one eager load for the whole payload instead of a
    lookup per event. ``None`` means no copy has been recorded for the link.
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
