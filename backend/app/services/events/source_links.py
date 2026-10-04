"""An event's secondary source links: normalized, paired, written as rows."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.event import MAX_SECONDARY_SOURCE_LINKS, Event, EventSourceLink

from .errors import TooManySourceLinksError


def _clean_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """Strip, drop blanks, duplicates and the primary, keeping order."""
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
    """Normalize the submitted secondary links before the rows are written.

    Raises :class:`TooManySourceLinksError` past
    :data:`MAX_SECONDARY_SOURCE_LINKS` rather than silently dropping the excess.
    """
    cleaned = _clean_secondary_source_urls(urls, source_url)
    if len(cleaned) > MAX_SECONDARY_SOURCE_LINKS:
        raise TooManySourceLinksError(
            f"An event carries at most {MAX_SECONDARY_SOURCE_LINKS} secondary source links"
        )
    return cleaned


def truncate_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """Ingest variant: same normalization, over-cap links dropped (no one to report to)."""
    return _clean_secondary_source_urls(urls, source_url)[:MAX_SECONDARY_SOURCE_LINKS]


def pair_secondary_snapshots(urls: list[str], snapshots: list[str]) -> dict[str, str]:
    """Map each mirror to the archived copy posted at the same index.

    Pair on the raw lists, before :func:`normalize_secondary_source_urls` drops
    rows and shifts indexes. A short snapshot list pairs what it covers. The
    first entry wins on a repeated mirror.
    """
    paired: dict[str, str] = {}
    for url, snapshot in zip(urls, snapshots, strict=False):
        link, copy = url.strip(), snapshot.strip()
        if link and copy:
            paired.setdefault(link, copy)
    return paired


def build_source_link_rows(urls: list[str]) -> list[EventSourceLink]:
    """Child rows with ``position`` set to the list index."""
    return [EventSourceLink(position=index, url=url) for index, url in enumerate(urls)]


def replace_source_links(db: Session, geo: Event, urls: list[str]) -> None:
    """Swap an event's secondary links for ``urls``.

    Flush the deletes first: SQLAlchemy inserts before deleting, so a reused
    ``position`` would collide on the composite PK.
    """
    geo.source_links.clear()
    db.flush()
    geo.source_links = build_source_link_rows(urls)
