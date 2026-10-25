"""Analyst-recorded archival of a source's links: check a pasted snapshot URL.

The analyst archives a link from their own browser and pastes the snapshot URL
beside it in the event form (``SourceLinkCreate.snapshot_url``); it lands on the
``source_links`` row in the same transaction as the event.

The capture is not attempted server side: most sources are ``x.com``, which
Save Page Now refuses, and archive.today has no API and bans hosts that submit
in bursts. This module checks what comes back.

Recording a copy on a ``geolocated`` event is a tracked change: the edit files
the superseded version (``services/events/revision``). A paste equal to the
stored copy (:func:`same_snapshot`) changes nothing.

:func:`validate_snapshot` checks where a snapshot lives (``https``, a host in
:data:`PROVIDER_HOSTS`, that provider's path shape), never what it captured.
The server must not fetch the page, and the pasting owner is the one a wrong
link degrades; the forms warn, without blocking, on a snapshot that visibly
replays another link.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from app.models.source import SOURCE_URL_MAX_LENGTH, ArchiveProvider
from app.services.sanitize import normalised_host

# Hosts a snapshot may live on. The allowlist is the abuse bound: the catalog
# renders the URL as an outbound link. archive.today serves one set of
# snapshots under six interchangeable domains. Mirrored by
# ``frontend/src/lib/snapshots.ts::SNAPSHOT_HOSTS`` (keys) and ``snapshotProvider``
# (providers); change both.
PROVIDER_HOSTS: dict[str, ArchiveProvider] = {
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
    """The pasted URL is not a snapshot address.

    The per-instance ``code`` is translated by
    :func:`app.routers._errors.raise_typed_error` and says which check failed.
    """

    code: str = "snapshot_url_invalid"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


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


def validate_snapshot(snapshot_url: str) -> ArchiveProvider:
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


def provider_of(snapshot_url: str) -> ArchiveProvider | None:
    """The provider a stored snapshot URL lives on, read off its host."""
    return PROVIDER_HOSTS.get((urlparse(snapshot_url).hostname or "").lower())
