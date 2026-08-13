"""Analyst-recorded source archival: validate a pasted snapshot, store one row.

A source tweet gets deleted and an account gets suspended, which destroys
exactly the evidence the catalog promises to preserve. An archived copy is what
keeps a dead original readable, and the analyst is who makes it: they open the
provider's own submit page from their own browser and paste the snapshot URL
back. Two paths take that paste. The submit and edit forms carry it as
``source_snapshot_url`` beside the source URL it archives, so the copy is made
while the source is in front of the analyst and lands in the same transaction
as the event; ``POST /events/{event_id}/archives`` takes it afterwards, for any
link a live event carries.

The capture is not attempted server side. Roughly nine in ten sources here are
``x.com``, which Save Page Now structurally refuses, and archive.today has no
API and answers a burst of server-side submissions by banning the submitting
host. Both are worked from a browser by the OSINT community every day, so the
browser is where the submission belongs; this module's job is to check what
comes back and to store it.

Which links can be archived: the event's ``source_url``, its secondary source
links (the analyst-submitted mirrors in ``event_source_links``), its
``detected_from_url`` (the analyst's post a machine draft was detected from),
and every ``http(s)`` href carried by a link mark in the proof body's Tiptap
document. :func:`collect_links` is the one home for that walk, and it is what
the endpoint validates ``original_url`` against, so a snapshot cannot be
recorded for a URL the event does not carry.

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
from app.services.sanitize import extract_link_hrefs, safe_link_href

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
    the post a machine draft was detected from, then a proof citation. That is
    the strongest provenance the event carries for the URL.

    Both halves of the archival contract read this: it is the set the detail
    surface offers an archive affordance for, and the set
    :func:`record_snapshot` accepts an ``original_url`` from.
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

    The membership test the endpoint runs and the origin it stores, in one
    call: both answers come from the same walk, so a link cannot be accepted
    under one rule and labelled under another.
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
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if not host:
        return None
    return host, parsed.path.rstrip("/"), parsed.query


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
    the source URL the same write stores, under origin ``source_url``. The
    membership walk :func:`record_snapshot` runs is not needed here, since the
    link is the one being written, but the snapshot check is the same
    :func:`validate_snapshot` and raises the same :class:`SnapshotRejected`
    codes, so a paste is judged identically wherever it arrives.

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


def record_snapshot(
    db: Session, *, event: Event, original_url: str, snapshot_url: str
) -> SourceArchive:
    """Store the archived copy an analyst recorded for one of the event's links.

    ``original_url`` has to be a link the event actually carries
    (:func:`origin_of`), and ``snapshot_url`` has to pass
    :func:`validate_snapshot`; either failing raises
    :class:`SnapshotRejected` with the code the router turns into a 400.

    The write itself is :func:`stage_snapshot`, committed here: this is the
    standalone endpoint, whose whole transaction is the one row.
    """
    origin = origin_of(event, original_url)
    if origin is None:
        raise SnapshotRejected(
            "original_url_not_on_event", "That link is not one of this event's sources."
        )
    stage_snapshot(
        db, event=event, original_url=original_url, origin=origin, snapshot_url=snapshot_url
    )
    db.commit()
    # The collection was loaded before the upsert, so it still holds whatever
    # row the link had, or nothing at all. Expiring it is what makes a caller
    # that serialises the event next read the copy just recorded, and what makes
    # the read below return the stored row rather than a stale one.
    db.expire(event, ["archives"])
    return (
        db.query(SourceArchive)
        .filter(
            SourceArchive.event_id == event.id,
            SourceArchive.original_url == original_url,
        )
        .one()
    )


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
    "origin_of",
    "reconcile_source_archive",
    "record_snapshot",
    "stage_snapshot",
    "stage_source_snapshot",
    "validate_snapshot",
]
