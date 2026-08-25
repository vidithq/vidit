"""The secondary source links: normalization, snapshot pairing, child rows.

One home for the list every write form posts, so the cap, the de-duplication
and the ``position`` numbering read the same on the create, geolocate, edit and
ingest paths.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.event import MAX_SECONDARY_SOURCE_LINKS, Event, EventSourceLink

from .errors import TooManySourceLinksError


def _clean_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """Strip, drop blanks, drop duplicates and drop the primary, order-preserving.

    The shared body of :func:`normalize_secondary_source_urls` (the write forms)
    and :func:`truncate_secondary_source_urls` (the ingest prefill); the two
    differ only in what they do past the cap. Dropping an entry equal to
    ``source_url`` keeps the primary anchor from being listed twice.
    """
    primary = (source_url or "").strip()
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in urls:
        url = raw.strip()
        if not url or url == primary or url in seen:
            continue
        seen.add(url)
        cleaned.append(url)
    return cleaned


def normalize_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """The submitted secondary source links, normalized: the one home every write
    path runs before the rows are written.

    Raises :class:`TooManySourceLinksError` past
    :data:`MAX_SECONDARY_SOURCE_LINKS`. Rejecting rather than truncating is the
    point: an analyst who pasted eleven mirrors should be told, not have the
    eleventh silently dropped.
    """
    cleaned = _clean_secondary_source_urls(urls, source_url)
    if len(cleaned) > MAX_SECONDARY_SOURCE_LINKS:
        raise TooManySourceLinksError(
            f"An event carries at most {MAX_SECONDARY_SOURCE_LINKS} secondary source links"
        )
    return cleaned


def truncate_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """The machine-path variant: same normalization, over-cap links dropped.

    A tweet that links twelve mirrors is not an error the ingest can report to
    anyone, so the prefill keeps the first ten and the owner adds the rest by
    hand if they matter.
    """
    return _clean_secondary_source_urls(urls, source_url)[:MAX_SECONDARY_SOURCE_LINKS]


def pair_secondary_snapshots(urls: list[str], snapshots: list[str]) -> dict[str, str]:
    """Map each submitted mirror to the archived copy posted beside it.

    The forms post two aligned repeated fields, ``secondary_source_urls`` and
    ``secondary_snapshot_urls``, one entry each per row, blank where the analyst
    archived nothing. Position is how they arrive and the link is how they are
    stored, so the pairing happens here, on the raw lists, before
    :func:`normalize_secondary_source_urls` drops the blank, duplicate and
    primary-equal rows that would shift every later index.

    A short or absent snapshot list pairs what it covers and leaves the rest
    unarchived, so a client that posts no copies posts nothing extra. The first
    entry wins on a repeated mirror, matching the one the normalization keeps.
    """
    paired: dict[str, str] = {}
    for url, snapshot in zip(urls, snapshots, strict=False):
        link, copy = url.strip(), snapshot.strip()
        if link and copy:
            paired.setdefault(link, copy)
    return paired


def build_source_link_rows(urls: list[str]) -> list[EventSourceLink]:
    """The ordered child rows for an event's secondary links: one home so
    ``position`` is always the list index."""
    return [EventSourceLink(position=index, url=url) for index, url in enumerate(urls)]


def replace_source_links(db: Session, geo: Event, urls: list[str]) -> None:
    """Swap an existing event's secondary links for ``urls``.

    The deletes are FLUSHED before the replacements insert: SQLAlchemy emits a
    mapper's inserts ahead of its deletes, so a reused ``position`` would
    otherwise collide on the composite PK mid-flush.
    """
    geo.source_links.clear()
    db.flush()
    geo.source_links = build_source_link_rows(urls)
