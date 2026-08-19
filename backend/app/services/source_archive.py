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
on :data:`PROVIDER_HOSTS`, and a per-provider shape check. A Wayback replay URL
embeds the original it captured, so it is checked against ``original_url``
directly. archive.today short codes embed nothing, so only the code's shape is
checked; see that function for why the server does not fetch the page to
verify it.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse, urlunparse

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
# service" is spelled out as three hosts rather than inferred from the URL.
PROVIDER_HOSTS: dict[str, SourceArchiveProvider] = {
    "web.archive.org": "wayback",
    "archive.ph": "archive_today",
    "archive.today": "archive_today",
}

# A Wayback replay path: ``/web/<timestamp>/<original url>``. The timestamp is
# up to 14 digits (``YYYYMMDDhhmmss``, truncated on an older capture) and may
# carry one of the replay modifiers the player appends (``id_``, ``if_``,
# ``im_``, ``js_``, ``cs_``, ``oe_``).
_WAYBACK_REPLAY_RE = re.compile(r"^/web/(\d{4,14})(?:[a-z]{2}_)?/(.+)$", re.IGNORECASE)

# An archive.today snapshot path: ``/<code>`` and nothing else. The service
# mints a short base62 code per capture; the ceiling is headroom, not a
# measurement of today's length.
_ARCHIVE_TODAY_CODE_RE = re.compile(r"^/([A-Za-z0-9]{4,16})/?$")

# Same ceiling the archivable links themselves carry, applied to the snapshot:
# ``original_url`` and ``snapshot_url`` are both Text, but a URL past the
# column limit the event's own source obeys is a paste accident rather than a
# snapshot.
SNAPSHOT_URL_MAX_LENGTH = SOURCE_URL_MAX_LENGTH


class SnapshotRejected(Exception):
    """The pasted URL is not a snapshot of this link.

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

    Wayback stores the URL it crawled, which is rarely the byte-for-byte string
    the analyst submitted: it settles on a scheme of its own, folds the host to
    lower case, and a copied link picks up or loses a trailing slash on the way
    through a browser. Comparing the raw strings would reject a correct
    snapshot for a difference that names the same page, so the scheme, the host
    case, a leading ``www.`` and a trailing slash come off both sides. What is
    left is host, path and query, which is what makes the snapshot a snapshot
    *of this link*.

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
    fold is :func:`_normalised_target`, the same one that decides whether a
    Wayback replay URL names the link it claims to archive, so one notion of
    "the same URL" serves both.

    ``None`` (the link holds no copy) is never the same as a paste.
    """
    if stored is None:
        return False
    if stored == pasted:
        return True
    left = _normalised_target(stored)
    return left is not None and left == _normalised_target(pasted)


def _wayback_target(path: str, query: str, fragment: str) -> str | None:
    """The original URL embedded in a Wayback replay URL, or ``None``.

    The embedded original is not a path segment: it is a whole URL, so its own
    query and fragment were parsed off the replay URL and have to be put back
    before it can be compared with anything.
    """
    match = _WAYBACK_REPLAY_RE.match(path)
    if match is None:
        return None
    return urlunparse(("", "", match.group(2), "", query, fragment))


def validate_snapshot(*, original_url: str, snapshot_url: str) -> SourceArchiveProvider:
    """Check a pasted snapshot against the link it claims to archive.

    Returns the provider the snapshot belongs to, inferred from its host, and
    raises :class:`SnapshotRejected` otherwise. The checks, in order:

    * ``https`` only, and no longer than :data:`SNAPSHOT_URL_MAX_LENGTH`.
    * The host is one of :data:`PROVIDER_HOSTS`.
    * A ``web.archive.org`` URL is a replay URL (``/web/<timestamp>/<original>``)
      whose embedded original names the same page as ``original_url``
      (see :func:`_normalised_target`).
    * An ``archive.ph`` / ``archive.today`` URL is a bare short code
      (``/<code>``).

    The archive.today branch stops at the shape on purpose. A short code embeds
    nothing, so the only way to learn what it captured is to fetch it, and
    fetching archive.today from a server is precisely what gets the deployment's
    IP banned. The trade is deliberate: the paste comes from the authenticated
    owner of the event, whose own catalog entry a wrong code degrades, and the
    host allowlist plus the code shape is what bounds the abuse.
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
            "Only web.archive.org, archive.ph and archive.today links are accepted.",
        )
    if provider == "wayback":
        target = _wayback_target(parsed.path, parsed.query, parsed.fragment)
        if target is None:
            raise SnapshotRejected(
                "snapshot_not_a_replay_url",
                "A Wayback Machine link must be a snapshot URL "
                "(web.archive.org/web/<timestamp>/<original link>).",
            )
        captured = _normalised_target(target)
        wanted = _normalised_target(original_url)
        if captured is None or wanted is None or captured != wanted:
            raise SnapshotRejected(
                "snapshot_original_mismatch",
                "That snapshot is of a different link.",
            )
        return provider
    if _ARCHIVE_TODAY_CODE_RE.match(parsed.path) is None:
        raise SnapshotRejected(
            "snapshot_not_a_snapshot_code",
            "An archive.today link must be a snapshot code (archive.ph/<code>).",
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
    provider = validate_snapshot(original_url=original_url, snapshot_url=snapshot_url)
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
    caller's commit. Each paste runs the same :func:`validate_snapshot` against
    the mirror it claims to archive, so a snapshot of another page raises the
    same :class:`SnapshotRejected` codes here as anywhere else.
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

    Either way nothing claims to archive the source URL but the copy of the
    source URL, so an edit that changes the source and pastes no new snapshot
    leaves the event with no archived source rather than a stale one. Pasting
    a ``source_snapshot_url`` with the same write fills the slot back in.

    Runs inside the caller's transaction, and reads the links the event carries
    at that moment: the mirrors are already replaced, while the proof body is
    still the stored one, since a write applies its new proof at commit.
    """
    for row in list(event.archives):
        if row.origin != "source_url" or row.original_url == event.source_url:
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

    ``kept`` is the normalized mirror list this write stores. Call it after the
    version this write supersedes is filed, so that version keeps the copies it
    held, and before the caller's commit: the rows go with the rest of the
    write if anything downstream fails.
    """
    surviving = set(kept)
    for row in list(event.archives):
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
