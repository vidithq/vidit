"""Daily sync of the conflicts referential from Wikipedia's ongoing list.

The source is the community-curated page "List of ongoing armed conflicts":
its presence boundary (a conflict is on the page iff editors judge it
ongoing) is exactly the product's ``ongoing`` flag, so syncing it
externalises both the list and the "is it still ongoing" judgement.

Identity is the Wikidata QID resolved from each row's article link, NOT the
displayed name: the page renames conflicts constantly (measured over
2023-2026: ~24 of 35 months had at least one name change, almost all
editorial renames of the same conflict), and the QID survives every rename.
A rename therefore updates ``conflicts.name`` in place; events keep their
association and the map filter never fragments.

Disappearance from the page is ambiguous (really ended, renamed, or slid
below the tier threshold), so rows are deactivated only after
``GRACE_PERIOD_DAYS`` of consecutive absence, and never deleted. Rows the
sync has never seen (``last_seen_at IS NULL``: the manual ``Other``, unseen
seed rows) are never touched.

Parsing is strict: if the page structure stops matching (tier tables
missing, implausible row counts), the sync raises and writes nothing,
leaving the referential as it was.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from app.models.conflict import Conflict

logger = logging.getLogger(__name__)

_API_URL = "https://en.wikipedia.org/w/api.php"
_PAGE_TITLE = "List of ongoing armed conflicts"
_HTTP_TIMEOUT_S = 30.0
_USER_AGENT = "vidit-conflict-sync/1.0 (https://vidit.app)"

# Tier tables to ingest, matched against the heading immediately preceding
# each wikitable, mapped to the ``ConflictTier`` value stored on the row.
# The skirmishes tier (<100 deaths/year) is deliberately excluded: it is
# high-churn editorial noise at the product's granularity.
_TIER_BY_HEADING = {"major wars": "major", "minor wars": "minor", "conflicts": "conflict"}

# Absence tolerated before a row flips ``ongoing=false``. Absorbs editorial
# churn: transient renames, vandalism reverts, tier flapping around the
# death-toll thresholds.
GRACE_PERIOD_DAYS = 14

# Parse sanity bounds on the top-level row count across the ingested tiers.
# The page has held ~36 for years; outside these bounds the structure has
# likely changed and writing would corrupt the referential.
_MIN_EXPECTED = 15
_MAX_EXPECTED = 80

# MediaWiki caps ``titles`` batches at 50 for anonymous clients.
_QID_BATCH_SIZE = 50

# ``conflicts.name`` is VARCHAR(200); names are truncated to fit before any
# write so an over-long page title can't raise a raw DataError.
_NAME_MAX_LENGTH = 200


class ConflictSyncError(Exception):
    """The page could not be fetched or no longer matches the expected shape."""


@dataclass
class SyncResult:
    """What one sync run did, for the script's log line."""

    seen: int = 0
    created: int = 0
    renamed: int = 0
    adopted: int = 0
    deactivated: int = 0
    reactivated: int = 0
    skipped: list[str] = field(default_factory=list)


def _get(client: httpx.Client, params: dict) -> dict:
    try:
        resp = client.get(_API_URL, params={**params, "format": "json", "formatversion": "2"})
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise ConflictSyncError(f"MediaWiki API request failed: {exc}") from exc
    # MediaWiki reports maxlag / rate-limit / bad-request failures as an
    # HTTP 200 whose body carries an ``error`` object.
    if isinstance(data, dict) and "error" in data:
        error = data["error"] if isinstance(data["error"], dict) else {}
        raise ConflictSyncError(
            "MediaWiki API returned an error: "
            f"{error.get('code', 'unknown')} ({error.get('info', 'no detail')})"
        )
    return data


def _fetch_page_html(client: httpx.Client) -> str:
    data = _get(client, {"action": "parse", "page": _PAGE_TITLE, "prop": "text"})
    try:
        return data["parse"]["text"]
    except (KeyError, TypeError) as exc:
        raise ConflictSyncError("MediaWiki parse response missing page HTML") from exc


def _link_depth(a, cell) -> int:
    """List-nesting depth of a link within its table cell.

    The conflict column nests sub-conflicts in inner ``<ul>``s (the treelist
    template); the top-level conflict of a row is the first link at the
    cell's minimal depth.
    """
    depth = 0
    node = a.parent
    while node is not None and node is not cell:
        if node.name in ("ul", "ol", "dl"):
            depth += 1
        node = node.parent
    return depth


@dataclass(frozen=True)
class PageEntry:
    """One top-level conflict as parsed off the page."""

    title: str
    tier: str
    start_year: int | None


def _parse_start_year(cell) -> int | None:
    """First 4-digit number of the row's start cell, None if absent."""
    match = re.search(r"\d{4}", cell.get_text(" ", strip=True))
    return int(match.group()) if match else None


def extract_page_entries(html: str) -> list[PageEntry]:
    """Top-level conflicts of the ingested tier tables, with tier and year.

    Titles (the link ``title`` attribute, i.e. the article name) rather than
    display text: the article is what resolves to a QID. Order preserved,
    duplicates dropped (first tier wins).
    """
    soup = BeautifulSoup(html, "html.parser")
    entries: list[PageEntry] = []
    seen_titles: set[str] = set()
    matched_tiers = 0
    claimed_tables: list = []
    for heading in soup.find_all(["h2", "h3"]):
        heading_text = heading.get_text(" ", strip=True).lower()
        tier = next((t for h, t in _TIER_BY_HEADING.items() if heading_text.startswith(h)), None)
        if tier is None:
            continue
        # Scoped lookup: stop at the next heading, so a tier heading whose
        # own table is missing can't silently claim the next tier's table.
        node = heading.find_next(["table", "h2", "h3"])
        while (
            node is not None
            and node.name == "table"
            and "wikitable" not in (node.get("class") or [])
        ):
            node = node.find_next(["table", "h2", "h3"])
        if node is None or node.name != "table":
            continue
        table = node
        if any(table is claimed for claimed in claimed_tables):
            raise ConflictSyncError(
                f"tier heading {heading_text!r} resolves to an already-claimed table; "
                "page structure changed, refusing to write"
            )
        claimed_tables.append(table)
        matched_tiers += 1
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            cell = cells[1]
            # ``str()``: bs4 types attribute values as ``str | AttributeValueList``
            # (multi-valued attributes); ``title`` is always a plain string.
            links = [
                (_link_depth(a, cell), str(a["title"]))
                for a in cell.find_all("a")
                if a.get("title")
                and not str(a["title"]).startswith(("Edit", "File:", "#"))
                and "does not exist" not in str(a["title"])
            ]
            if not links:
                continue
            min_depth = min(d for d, _ in links)
            title = next(t for d, t in links if d == min_depth)
            # A transient link to a disambiguation page is an editorial
            # accident, not a conflict; the grace period covers the gap.
            if title.endswith("(disambiguation)") or title in seen_titles:
                continue
            seen_titles.add(title)
            entries.append(PageEntry(title, tier, _parse_start_year(cells[0])))

    if matched_tiers != len(_TIER_BY_HEADING):
        raise ConflictSyncError(
            f"expected {len(_TIER_BY_HEADING)} tier tables, matched {matched_tiers}; "
            "page structure changed, refusing to write"
        )
    if not (_MIN_EXPECTED <= len(entries) <= _MAX_EXPECTED):
        raise ConflictSyncError(
            f"parsed {len(entries)} conflicts, outside sanity bounds "
            f"[{_MIN_EXPECTED}, {_MAX_EXPECTED}]; refusing to write"
        )
    return entries


def resolve_qids(client: httpx.Client, titles: list[str]) -> dict[str, str]:
    """Map article title to Wikidata QID, following renames and redirects."""
    qid_by_title: dict[str, str] = {}
    for start in range(0, len(titles), _QID_BATCH_SIZE):
        batch = titles[start : start + _QID_BATCH_SIZE]
        data = _get(
            client,
            {
                "action": "query",
                "titles": "|".join(batch),
                "prop": "pageprops",
                "ppprop": "wikibase_item",
                "redirects": "1",
            },
        )
        query = data.get("query", {})
        # The API normalises and redirects titles; walk the mappings back so
        # the returned dict is keyed by the titles the caller passed in.
        forward: dict[str, str] = {}
        for step in ("normalized", "redirects"):
            for entry in query.get(step, []):
                forward[entry["from"]] = entry["to"]
        qid_by_resolved: dict[str, str] = {}
        for page in query.get("pages", []):
            qid = page.get("pageprops", {}).get("wikibase_item")
            if qid:
                qid_by_resolved[page["title"]] = qid
        for title in batch:
            resolved = title
            hops = 0
            while resolved in forward and hops < 5:
                resolved = forward[resolved]
                hops += 1
            if resolved in qid_by_resolved:
                qid_by_title[title] = qid_by_resolved[resolved]
    return qid_by_title


def sync_conflicts(
    db: Session,
    *,
    client: httpx.Client | None = None,
    now: datetime | None = None,
) -> SyncResult:
    """Run one sync pass: upsert by QID, then grace-period deactivation.

    Per page entry: a row already carrying the QID is refreshed (renamed in
    place if the page renamed it); a QID-less row with the exact same name
    is adopted (claims migrated manual rows and seed rows on first sight);
    otherwise a new ``source='sync'`` row is inserted. A name collision
    against a row with a DIFFERENT QID is skipped and reported rather than
    guessed at. Commits once at the end; any raise leaves the DB untouched.
    """
    now = now or datetime.now(UTC)

    def run(c: httpx.Client) -> SyncResult:
        entries = extract_page_entries(_fetch_page_html(c))
        qid_by_title = resolve_qids(c, [e.title for e in entries])
        # A silently failed pageprops resolution must never age rows toward
        # deactivation: if too few entries resolved, abort before any write
        # (in particular before the grace-period sweep below).
        resolved = sum(1 for e in entries if e.title in qid_by_title)
        if resolved < _MIN_EXPECTED:
            raise ConflictSyncError(
                f"only {resolved} of {len(entries)} page entries resolved to a "
                f"Wikidata QID (floor {_MIN_EXPECTED}); refusing to write"
            )
        result = SyncResult(seen=len(entries))

        # Two titles can redirect to one article (mid-rename, merged
        # entries): dedupe by resolved QID, first entry wins, so the second
        # title doesn't read as a spurious rename of the same row.
        seen_qids: set[str] = set()
        deduped: list[PageEntry] = []
        for entry in entries:
            qid = qid_by_title.get(entry.title)
            if qid is not None and qid in seen_qids:
                continue
            if qid is not None:
                seen_qids.add(qid)
            deduped.append(entry)

        for entry in deduped:
            # Truncate to the column width so an over-long page title can't
            # raise a raw DataError mid-commit.
            title = entry.title[:_NAME_MAX_LENGTH]
            qid = qid_by_title.get(entry.title)
            if qid is None:
                result.skipped.append(f"{title}: no Wikidata item")
                continue
            row = db.query(Conflict).filter(Conflict.wikidata_id == qid).first()
            if row is None:
                by_name = db.query(Conflict).filter(Conflict.name == title).first()
                if by_name is not None and by_name.wikidata_id is None:
                    # Same name, no QID yet: an operator/seed row for the
                    # same conflict. Adopt it instead of forking a duplicate.
                    by_name.wikidata_id = qid
                    row = by_name
                    result.adopted += 1
                elif by_name is not None:
                    result.skipped.append(
                        f"{title}: name held by {by_name.wikidata_id}, page maps it to {qid}"
                    )
                    continue
                else:
                    row = Conflict(name=title, wikidata_id=qid, ongoing=True, source="sync")
                    db.add(row)
                    result.created += 1
            elif row.name != title:
                collision = (
                    db.query(Conflict).filter(Conflict.name == title, Conflict.id != row.id).first()
                )
                if collision is not None:
                    result.skipped.append(
                        f"{qid}: rename {row.name!r} -> {title!r} collides with an existing row"
                    )
                else:
                    row.name = title
                    result.renamed += 1
            # First sighting of a seed row is an activation, not a
            # reactivation: only count rows the sync had seen before.
            if not row.ongoing and row.last_seen_at is not None:
                result.reactivated += 1
            row.ongoing = True
            row.last_seen_at = now
            # Tier follows the page (rows move buckets as death tolls shift).
            row.tier = entry.tier
            # Start year only fills a gap: Wikidata seed years are more
            # precise than the page's, so never clobber an existing one.
            if row.start_year is None:
                row.start_year = entry.start_year

        # Grace-period deactivation: only rows the sync has seen before
        # (``last_seen_at`` set) can expire; manual/unseen rows are immune.
        cutoff = now - timedelta(days=GRACE_PERIOD_DAYS)
        expired = (
            db.query(Conflict)
            .filter(
                Conflict.ongoing.is_(True),
                Conflict.last_seen_at.isnot(None),
                Conflict.last_seen_at < cutoff,
            )
            .all()
        )
        for row in expired:
            row.ongoing = False
            result.deactivated += 1

        db.commit()
        for reason in result.skipped:
            logger.warning("conflict sync skipped: %s", reason)
        return result

    if client is None:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S, headers={"User-Agent": _USER_AGENT}) as own:
            return run(own)
    return run(client)
