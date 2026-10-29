"""Full-text search: one ranked list of events, sites, collections, analysts and organizations,
or the top of that list for each type.

Postgres FTS: ``websearch_to_tsquery`` parses user input (quoted phrases, ``OR``
and ``-word``, never a syntax error), and ``ts_headline`` returns fragments with
sentinel delimiters the frontend renders as ``<mark>`` (no HTML across the wire,
so XSS-safe). Soft-deleted rows are filtered at query time.

Each type contributes one candidate select of ``(type, id, rank, created_at)``
(:func:`_candidates`); their union is ordered and paged once (:func:`search`), or cut per
type (:func:`search_sections`), and only the served rows are read in full (:func:`_hydrate`). Events compose with the standard
event filters (``services/event_filters``). An event's document is its title and its
sources' titles together, so ``-word`` excludes an event whichever of them holds the
word. A site's document is its name and its live sources' titles and notes, the same way
(:func:`_site_document`). The collections, users and organizations TSVECTOR expressions
must stay expression-tree-equal to their GIN indexes (config name as a SQL literal, never
a bound parameter) or Postgres falls back to a sequential scan: ``_collection_tsvector``
and the ``_USER_TSVECTOR`` and ``_ORGANIZATION_TSVECTOR`` constants.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, get_args

from sqlalchemy import (
    ColumnElement,
    Select,
    String,
    Text,
    and_,
    bindparam,
    case,
    cast,
    false,
    func,
    literal_column,
    or_,
    select,
    text,
    tuple_,
    union_all,
)
from sqlalchemy.dialects.postgresql import DOUBLE_PRECISION, TSQUERY
from sqlalchemy.engine import Row
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql.elements import ColumnClause
from sqlalchemy.sql.selectable import Subquery

from app.models.collection import Collection
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.organization import Organization
from app.models.site import Site
from app.models.source import Source, SourceLink
from app.models.user import User
from app.schemas.search import SearchType
from app.services import organizations
from app.services.collections import (
    build_collection_reads,
    has_showable_item,
    visible_collections,
)
from app.services.event_filters import (
    EventFilters,
    collectable_events,
    credited_to,
    date_histogram,
    owner_username_matches,
    taxonomy_predicates,
    visible_events,
)
from app.services.geolocator_credit import CREDIT_LOAD, live_geolocators
from app.services.pagination import encode_ranked_cursor
from app.services.sites import last_sources, live_sources, site_images, visible_sites
from app.services.thumbnails import pick_thumbnail, thumbnail_loads

# ``ts_headline`` sentinels: STX / ETX, not an ASCII marker like ``[[HL]]``,
# which a user could type into a bio to corrupt highlights. Planted STX / ETX
# are stripped first (see ``_headline``).
HIGHLIGHT_START = "\x02"
HIGHLIGHT_STOP = "\x03"

# ``HighlightAll=TRUE`` skips fragment selection on short titles (splitting
# would truncate); fragment mode is for the prose bios.
_HEADLINE_OPTS_FULL = f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, HighlightAll=TRUE"
_HEADLINE_OPTS_FRAGMENT = (
    f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, MaxFragments=2, MaxWords=20, MinWords=5"
)


# ``simple`` with accents folded (migration ``a8d4f2c6e1b3``): ``cafe`` finds ``café``.
# The config name stays a SQL literal, never a bound parameter: a
# ``$1::regconfig`` would not match the index expression tree. The events and
# collections vectors use ORM ``func`` calls to compose with the shared
# filters; the users and organizations ones are raw SQL (no event filters).
_TS_CONFIG_NAME = "'simple_unaccent'"
_TS_CONFIG: ColumnClause[str] = literal_column(_TS_CONFIG_NAME)
_USER_TSVECTOR = (
    f"to_tsvector({_TS_CONFIG_NAME}, coalesce(username, '') || ' ' || coalesce(bio, ''))"
)
_ORGANIZATION_TSVECTOR = (
    f"to_tsvector({_TS_CONFIG_NAME}, "
    "coalesce(name, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(bio, ''))"
)

# A shorter last word would match most of the catalogue as a prefix.
_PREFIX_MIN = 3


@dataclass(frozen=True)
class _Query:
    """A query parsed by ``websearch_to_tsquery``: ``exact`` matches whole words, ``typed`` also
    reads the last word as a prefix, the word a reader is still typing."""

    exact: str
    typed: str


def _typed(query: str, exact: str) -> str:
    """``exact`` with its last word matched as a prefix, when ``query`` ends on a plain word of
    at least ``_PREFIX_MIN`` letters or digits: not excluded, not ``OR``, not in quotes."""
    words = query.split()
    if not words or not exact.endswith("'") or query.count('"') % 2 or query.endswith('"'):
        return exact
    last = words[-1]
    if last.startswith("-") or last.lower() == "or" or sum(c.isalnum() for c in last) < _PREFIX_MIN:
        return exact
    return f"{exact}:*"


def _parse(db: Session, *queries: str) -> list[_Query]:
    """Each of ``queries`` parsed, in one round trip. An input without a word parses to the
    empty query, which matches nothing."""
    row = db.execute(
        select(*(cast(func.websearch_to_tsquery(_TS_CONFIG, q), Text) for q in queries))
    ).one()
    return [_Query(exact, _typed(q, exact)) for q, exact in zip(queries, row, strict=True)]


def _tsquery(parsed: str) -> ColumnElement:
    """A :class:`_Query` text back as a ``tsquery`` value."""
    return cast(bindparam(None, parsed, type_=Text), TSQUERY)


def _rank(tsvector, query: _Query) -> ColumnElement[float]:
    """``ts_rank`` on the typed query, plus the exact one, so a whole word ranks above a word it
    only begins."""
    return func.ts_rank(tsvector, _tsquery(query.typed)) + func.ts_rank(
        tsvector, _tsquery(query.exact)
    )


def _geo_tsvector():
    """The event title's ``tsvector``, which the rank and the highlight read."""
    return func.to_tsvector(_TS_CONFIG, func.coalesce(Event.title, literal_column("''")))


def _event_document():
    """The event title and its sources' titles as one ``tsvector``. Concatenation offsets the
    positions, so a phrase never spans the title and a source."""
    source_titles = (
        select(func.string_agg(Source.title, literal_column("' '")))
        .where(Source.event_id == Event.id)
        .scalar_subquery()
    )
    return _geo_tsvector().op("||")(
        func.to_tsvector(_TS_CONFIG, func.coalesce(source_titles, literal_column("''")))
    )


# A shorter needle is a fragment of nearly every URL (``a``, ``the``, ``_``).
_URL_NEEDLE_MIN = 4


def _url_needle(q: str) -> str | None:
    """``q`` when it may be part of a source URL: one word of at least ``_URL_NEEDLE_MIN``
    characters, neither quoted nor excluded. A pasted link always is."""
    if len(q) < _URL_NEEDLE_MIN or any(c.isspace() for c in q) or '"' in q or q.startswith("-"):
        return None
    return q


def _event_match(q: str, parsed: str) -> ColumnElement[bool]:
    """An event matches when its document (:func:`_event_document`) matches ``parsed``, the
    parse of ``q``, or when a source URL contains ``q`` (case-insensitive,
    :func:`_url_needle`), so a pasted link finds the events that cite it."""
    match = _event_document().op("@@")(_tsquery(parsed))
    needle = _url_needle(q)
    if needle is None:
        return match
    return or_(
        match,
        Event.sources.any(Source.links.any(SourceLink.url.icontains(needle, autoescape=True))),
    )


def _handle_candidates(query: str) -> list[str]:
    """The lowercased spellings of ``query`` (already stripped) that could be an analyst's handle:
    each word and the whole query (a handle may hold a space), without a leading ``@``."""
    words = query.split()
    candidates = [w.lstrip("@").lower() for w in words]
    if len(words) > 1:
        candidates.append(" ".join(words).lstrip("@").lower())
    return [c for c in dict.fromkeys(candidates) if c]


@dataclass(frozen=True)
class _Handle:
    """A word of the query naming a live analyst: the lowercased handle, its exact parse (a
    handle is typed whole), the id."""

    handle: str
    parsed: str
    user_id: uuid.UUID


@dataclass(frozen=True)
class _EventTerms:
    """A query split for the event groups: ``handles`` holds each word naming a live analyst,
    ``text`` the other words. ``parsed`` is the parse of ``text``, ``query_parsed`` the parse of
    the whole query, which the highlight reads."""

    text: str
    parsed: _Query = _Query("", "")
    query_parsed: _Query = _Query("", "")
    handles: tuple[_Handle, ...] = ()


def _event_terms(db: Session, query: str) -> _EventTerms:
    """Split ``query`` (already stripped) into the words that are a live analyst's exact handle
    (case-insensitive, optional ``@``) and the rest. A handle holding a space names the analyst
    only as the whole query."""
    if not query:
        return _EventTerms(text="")
    candidates = _handle_candidates(query)
    ids = dict(
        db.query(func.lower(User.username), User.id)
        .filter(User.deleted_at.is_(None), func.lower(User.username).in_(candidates))
        .all()
    )
    whole = " ".join(query.split()).lstrip("@").lower()
    if " " in whole and whole in ids:
        named = [(whole, ids[whole])]
        text_words: list[str] = []
    else:
        named = []
        text_words = []
        for word in query.split():
            handle = word.lstrip("@").lower()
            if handle in ids:
                named.append((handle, ids[handle]))
            else:
                text_words.append(word)
    text = " ".join(text_words)
    query_parsed, parsed, *handles_parsed = _parse(
        db, query, text, *(handle for handle, _ in named)
    )
    return _EventTerms(
        text=text,
        parsed=parsed,
        query_parsed=query_parsed,
        handles=tuple(
            _Handle(handle, handle_parsed.exact, user_id)
            for (handle, user_id), handle_parsed in zip(named, handles_parsed, strict=True)
        ),
    )


def _matching(
    stmt: SAQuery, *criteria, terms: _EventTerms, view: str | None, filters: EventFilters
) -> SAQuery:
    """Narrow ``stmt`` to the events search matches: ``filters`` on ``view``, the caller's
    ``criteria``, and :func:`_event_match` on the words of ``terms``. A word naming an analyst
    also matches the events credited to them (``services/event_filters.credited_to``)."""
    stmt = filters.apply(stmt, view=view).filter(*criteria)
    if terms.text:
        stmt = stmt.filter(_event_match(terms.text, terms.parsed.typed))
    for named in terms.handles:
        stmt = stmt.filter(
            or_(credited_to([named.user_id]), _event_match(named.handle, named.parsed))
        )
    return stmt


def _located_hits() -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """The located events search lists: a live ``geolocated`` or ``detected`` row with a
    subject coordinate. Closed rows stay out."""
    return Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)), Event.coords.isnot(None)


def _collection_tsvector():
    """The ``tsvector`` of ``coalesce(title, '') || ' ' || coalesce(description_text, '')``.

    Uses the plain-text projection, not the HTML, which would index
    tag names. Expression-tree-equal to ``ix_collections_search_fts`` in
    migration ``a8d4f2c6e1b3`` (the parenthesising is the parsing).
    """
    document = (
        func.coalesce(Collection.title, literal_column("''"))
        .op("||")(literal_column("' '"))
        .op("||")(func.coalesce(Collection.description_text, literal_column("''")))
    )
    return func.to_tsvector(_TS_CONFIG, document)


# What an event hit reads: the owner, the credited geolocators, the thumbnail and the tags.
# Hydration runs on an id list without ``LIMIT``, so ``joinedload`` on the tags cannot truncate it.
_HIT_LOADS = (joinedload(Event.owner), *thumbnail_loads(), joinedload(Event.tags), CREDIT_LOAD)

# The hit types, in the vocabulary of ``GET /search?type=`` and in the order of the sections.
SEARCH_TYPES: tuple[str, ...] = get_args(SearchType)

# The filters each type other than ``event`` answers. ``status`` narrows events alone and never
# drops another type; any other active filter drops a type that does not answer it. Mirrored by
# ``frontend/src/components/filters/model.ts::KIND_DIMENSIONS``; change both.
_TYPE_FILTERS: dict[str, tuple[str, ...]] = {
    "site": ("status", "author"),
    "collection": ("status", "author", "tag"),
    "user": ("status",),
    "organization": ("status",),
}

# Added to the rank of an analyst a word of the query names exactly, so that analyst leads the
# list: ``ts_rank`` of a short document stays far below it.
_NAMED_RANK = 10.0

_NO_RANK = cast(literal_column("0"), DOUBLE_PRECISION)


def _searchable_events() -> ColumnElement[bool]:
    """The events search lists: the located ones (:func:`_located_hits`) and the open requests.
    A request may carry an approximate guess, yet it is no located row."""
    return or_(
        and_(*_located_hits()),
        Event.status == STATUS_REQUESTED,
    )


def _candidate(type_: str, id_col: Any, rank: ColumnElement[Any], created_at: Any) -> list[Any]:
    """The four columns every type's candidate select carries, in the union's order."""
    return [
        literal_column(f"'{type_}'", String).label("type"),
        id_col.label("id"),
        cast(rank, DOUBLE_PRECISION).label("rank"),
        created_at.label("created_at"),
    ]


def _event_candidates(db: Session, terms: _EventTerms, filters: EventFilters) -> Select[Any]:
    """The events :func:`_searchable_events` names that ``filters`` and the words of ``terms``
    match (:func:`_matching`), ranked on the title by the words that are not a handle."""
    rank: ColumnElement[Any] = _NO_RANK
    if terms.text or terms.handles:
        rank = _rank(_geo_tsvector(), terms.parsed if terms.text else terms.query_parsed)
    stmt = db.query(*_candidate("event", Event.id, rank, Event.created_at))
    matched = _matching(stmt, _searchable_events(), terms=terms, view=None, filters=filters)
    return select(matched.subquery())


def search_dates(
    db: Session, *, query: str, types: frozenset[str], filters: EventFilters
) -> dict[str, Any]:
    """The events :func:`search` lists for ``query`` and ``filters`` (:func:`_event_candidates`),
    counted per day by ``services/event_filters.date_histogram``. Unlike :func:`search`, an empty
    ``query`` with no active filter counts every searchable event; ``types`` without ``event``
    counts nothing."""
    if "event" not in types:
        return {"occurred_date": [], "submitted": [], "total": 0}
    terms = _event_terms(db, query.strip())
    return date_histogram(
        lambda window: _matching(
            db.query(Event.id), _searchable_events(), terms=terms, view=None, filters=window
        ),
        filters,
    )


def _site_name_tsvector():
    """The site name's ``tsvector``, which the rank and the highlight read."""
    return func.to_tsvector(_TS_CONFIG, func.coalesce(Site.name, literal_column("''")))


def _site_document():
    """The site name and its live sources' titles and notes as one ``tsvector``, like
    :func:`_event_document`."""
    source_text = (
        select(
            func.string_agg(
                func.concat_ws(literal_column("' '"), Source.title, Source.note),
                literal_column("' '"),
            )
        )
        .where(Source.site_id == Site.id, *live_sources())
        .scalar_subquery()
    )
    return _site_name_tsvector().op("||")(
        func.to_tsvector(_TS_CONFIG, func.coalesce(source_text, literal_column("''")))
    )


def _site_candidates(parsed: _Query | None, filters: EventFilters) -> Select[Any]:
    """Visible sites (``services/sites.visible_sites``, the rule of ``GET /sites``), owned by
    ``filters.author`` when set."""
    criteria: list[ColumnElement[bool]] = [*visible_sites()]
    if filters.author:
        criteria.append(Site.owner.has(owner_username_matches(filters.author)))
    rank: ColumnElement[Any] = _NO_RANK
    if parsed is not None:
        criteria.append(_site_document().op("@@")(_tsquery(parsed.typed)))
        rank = _rank(_site_name_tsvector(), parsed)
    return select(*_candidate("site", Site.id, rank, Site.created_at)).where(*criteria)


def _collection_candidates(parsed: _Query | None, filters: EventFilters) -> Select[Any]:
    """Readable collections holding a showable event (``services/collections``), so a hit never
    opens on an empty shelf. ``author`` keeps one owner's; ``tag`` keeps those holding a showable
    event tagged with one of the values, on the event or a source: the tags the collection
    prints (``services/collections.tags_for``)."""
    criteria: list[ColumnElement[bool]] = [*visible_collections(), has_showable_item()]
    if filters.tag:
        criteria.append(has_showable_item(*taxonomy_predicates(tag=filters.tag)))
    if filters.author:
        criteria.append(Collection.owner.has(owner_username_matches(filters.author)))
    rank: ColumnElement[Any] = _NO_RANK
    if parsed is not None:
        criteria.append(_collection_tsvector().op("@@")(_tsquery(parsed.typed)))
        rank = _rank(_collection_tsvector(), parsed)
    return select(*_candidate("collection", Collection.id, rank, Collection.created_at)).where(
        *criteria
    )


def _user_candidates(parsed: _Query, query: str) -> Select[Any]:
    """Live analysts matching on their username and bio, or whose username a word of the query
    names exactly (:func:`_handle_candidates`), which ranks first."""
    tsvector: ColumnClause[Any] = literal_column(_USER_TSVECTOR)
    named = func.lower(User.username).in_(_handle_candidates(query))
    rank = _rank(tsvector, parsed) + case((named, _NAMED_RANK), else_=0.0)
    return select(*_candidate("user", User.id, rank, User.created_at)).where(
        User.deleted_at.is_(None), or_(tsvector.op("@@")(_tsquery(parsed.typed)), named)
    )


def _organization_candidates(parsed: _Query) -> Select[Any]:
    """Organizations matching on their name, slug and bio."""
    tsvector: ColumnClause[Any] = literal_column(_ORGANIZATION_TSVECTOR)
    return select(
        *_candidate(
            "organization", Organization.id, _rank(tsvector, parsed), Organization.created_at
        )
    ).where(tsvector.op("@@")(_tsquery(parsed.typed)))


def _candidates(
    db: Session, *, query: str, types: frozenset[str], filters: EventFilters
) -> list[Select[Any]]:
    """One select per type that may match: events when ``query`` or a filter is set, a type
    other than ``event`` when it answers every active filter (:data:`_TYPE_FILTERS`) and
    ``query`` or one of its own filters is set."""
    terms = _event_terms(db, query)
    parsed = terms.query_parsed if query else None
    selects: list[Select[Any]] = []
    if "event" in types and (query or filters.active):
        selects.append(_event_candidates(db, terms, filters))

    def offered(type_: str) -> bool:
        kept = _TYPE_FILTERS[type_]
        own = any(filters.is_set(name) for name in kept if name != "status")
        return type_ in types and not filters.active_beyond(*kept) and (bool(query) or own)

    if offered("site"):
        selects.append(_site_candidates(parsed, filters))
    if offered("collection"):
        selects.append(_collection_candidates(parsed, filters))
    if parsed is not None and offered("user"):
        selects.append(_user_candidates(parsed, query))
    if parsed is not None and offered("organization"):
        selects.append(_organization_candidates(parsed))
    return selects


def _union(
    db: Session, *, query: str, types: frozenset[str], filters: EventFilters
) -> Subquery | None:
    """Every candidate of ``types`` as one ``(type, id, rank, created_at)`` relation, or ``None``
    when nothing can match: an empty ``query`` with no active filter matches nothing."""
    if not query and not filters.active:
        return None
    selects = _candidates(db, query=query, types=types, filters=filters)
    if not selects:
        return None
    return union_all(*selects).subquery("candidates")


def _ranking(candidates: Any) -> tuple[ColumnElement[Any], ...]:
    """``rank``, then ``created_at``, then ``id``, all descending: a total order, so a walk by
    cursor never repeats or skips a hit."""
    return candidates.rank.desc(), candidates.created_at.desc(), candidates.id.desc()


def _next_cursor(rows: Sequence[Row[Any]], limit: int) -> str | None:
    """The cursor after the first ``limit`` of ``rows``, read one past the cut, or ``None`` when
    no row lies past it."""
    if len(rows) <= limit:
        return None
    last = rows[limit - 1]
    return encode_ranked_cursor(last.rank, last.created_at, last.id)


@dataclass(frozen=True)
class SearchPage:
    """One page of hits in rank order, the whole match count, and the next page's cursor
    (``None`` on the last page)."""

    hits: list[dict]
    total: int
    cursor: str | None


def search(
    db: Session,
    *,
    query: str,
    types: frozenset[str],
    limit: int,
    filters: EventFilters | None = None,
    after: tuple[float, datetime, uuid.UUID] | None = None,
) -> SearchPage:
    """One ranked list across ``types`` (a subset of :data:`SEARCH_TYPES`).

    Each type ranks on its own text with the same ``ts_rank``: an event on its title, a site on
    its name, a collection on its title and description, an analyst on their username and bio,
    an organization on its name, slug and bio, in the order of :func:`_ranking`. ``total`` is the
    whole match count, whatever ``after`` skips.

    With an empty ``query`` and an active filter the list browses: every hit ranks 0, so the
    order is newest first. An empty ``query`` with no active filter matches nothing.
    """
    filters = filters or EventFilters()
    q = query.strip()
    union = _union(db, query=q, types=types, filters=filters)
    if union is None:
        return SearchPage([], 0, None)
    counted = select(union, func.count().over().label("total_count")).subquery("counted")
    page = select(counted)
    if after is not None:
        page = page.where(tuple_(counted.c.rank, counted.c.created_at, counted.c.id) < after)
    rows = db.execute(page.order_by(*_ranking(counted.c)).limit(limit + 1)).all()
    if not rows:
        return SearchPage([], 0, None)
    hits = _hydrate(db, [(row.type, row.id) for row in rows[:limit]], query=q)
    return SearchPage(hits, int(rows[0].total_count), _next_cursor(rows, limit))


@dataclass(frozen=True)
class SearchSection:
    """The first page of one type's list: what :func:`search` returns for that type alone."""

    type: str
    hits: list[dict]
    total: int
    cursor: str | None


def search_sections(
    db: Session,
    *,
    query: str,
    types: frozenset[str],
    limit: int,
    filters: EventFilters | None = None,
) -> list[SearchSection]:
    """The top ``limit`` hits of each type of ``types`` that has one, in :data:`SEARCH_TYPES`
    order, read in one query. Each section's ``cursor`` continues that type's list in
    :func:`search`."""
    filters = filters or EventFilters()
    q = query.strip()
    union = _union(db, query=q, types=types, filters=filters)
    if union is None:
        return []
    ranked = select(
        union,
        func.row_number()
        .over(partition_by=union.c.type, order_by=_ranking(union.c))
        .label("position"),
        func.count().over(partition_by=union.c.type).label("total_count"),
    ).subquery("ranked")
    rows = db.execute(
        select(ranked)
        .where(ranked.c.position <= limit + 1)
        .order_by(ranked.c.type, ranked.c.position)
    ).all()
    by_type: dict[str, list[Row[Any]]] = {}
    for row in rows:
        by_type.setdefault(row.type, []).append(row)
    present = [type_ for type_ in SEARCH_TYPES if type_ in by_type]
    served = [(row.type, row.id) for type_ in present for row in by_type[type_][:limit]]
    hits = _hydrate(db, served, query=q)
    sections = [
        SearchSection(
            type=type_,
            hits=[hit for hit in hits if hit["type"] == type_],
            total=int(by_type[type_][0].total_count),
            cursor=_next_cursor(by_type[type_], limit),
        )
        for type_ in present
    ]
    return [section for section in sections if section.hits]


def _headline(column: Any, parsed: _Query | None, opts: str = _HEADLINE_OPTS_FULL) -> Any:
    """``column`` with its planted sentinels stripped, the matches marked when ``parsed`` is set."""
    stripped = func.translate(column, literal_column("chr(2) || chr(3)"), literal_column("''"))
    if parsed is None:
        return stripped
    return func.ts_headline(_TS_CONFIG, stripped, _tsquery(parsed.typed), opts)


def _bio_highlight(raw: str | None) -> str | None:
    """A bio headline only when the bio contributed a match; ``ts_headline`` returns the text
    unmarked otherwise."""
    return raw if raw is not None and HIGHLIGHT_START in raw else None


def _hydrate(db: Session, page: list[tuple[str, uuid.UUID]], *, query: str) -> list[dict]:
    """The hits of ``page``, in its order. A row deleted between the two reads drops out."""
    parsed = _parse(db, query)[0] if query else None
    ids: dict[str, list[uuid.UUID]] = {}
    for type_, id_ in page:
        ids.setdefault(type_, []).append(id_)
    found: dict[tuple[str, uuid.UUID], dict] = {}
    readers = {
        "event": _event_hits,
        "site": _site_hits,
        "collection": _collection_hits,
        "user": _user_hits,
        "organization": _organization_hits,
    }
    for type_, type_ids in ids.items():
        for hit in readers[type_](db, type_ids, parsed):
            found[(type_, hit["id"])] = hit
    return [found[key] for key in page if key in found]


def _event_hits(db: Session, ids: list[uuid.UUID], parsed: _Query | None) -> list[dict]:
    located = Event.status != STATUS_REQUESTED
    rows = (
        db.query(
            Event,
            _headline(Event.title, parsed).label("title_highlight"),
            case((located, func.ST_Y(Event.coords))).label("lat"),
            case((located, func.ST_X(Event.coords))).label("lng"),
        )
        .options(*_HIT_LOADS)
        .filter(Event.id.in_(ids))
        .all()
    )
    hits: list[dict] = []
    for event, title_highlight, lat, lng in rows:
        thumb = pick_thumbnail(event)
        hits.append(
            {
                "type": "event",
                "id": event.id,
                "title": event.title,
                "title_highlight": title_highlight,
                "status": event.status,
                "occurred_date": event.occurred_date,
                "created_at": event.created_at,
                "lat": lat,
                "lng": lng,
                "is_graphic": event.is_graphic,
                "owner": event.owner,
                "geolocators": live_geolocators(event),
                "media": [thumb] if thumb is not None else [],
                "tags": event.tags,
            }
        )
    return hits


def _site_hits(db: Session, ids: list[uuid.UUID], parsed: _Query | None) -> list[dict]:
    rows = (
        db.query(Site, _headline(Site.name, parsed).label("name_highlight"))
        .options(joinedload(Site.owner))
        .filter(Site.id.in_(ids))
        .all()
    )
    last = last_sources(db, ids, None)
    images = site_images(db, ids)
    return [
        {
            "type": "site",
            "id": site.id,
            "name": site.name,
            "name_highlight": name_highlight,
            "kind": site.kind,
            "owner": site.owner,
            "last_source": last.get(site.id),
            "media": [images[site.id]] if site.id in images else [],
        }
        for site, name_highlight in rows
    ]


def _collection_hits(db: Session, ids: list[uuid.UUID], parsed: _Query | None) -> list[dict]:
    collections = (
        db.query(Collection).options(joinedload(Collection.owner)).filter(Collection.id.in_(ids))
    )
    return [
        {"type": "collection", **read.model_dump()}
        for read in build_collection_reads(db, list(collections))
    ]


def _user_hits(db: Session, ids: list[uuid.UUID], parsed: _Query | None) -> list[dict]:
    rows = (
        db.query(
            User,
            _headline(User.username, parsed).label("username_highlight"),
            _headline(User.bio, parsed, _HEADLINE_OPTS_FRAGMENT).label("bio_highlight"),
        )
        .filter(User.id.in_(ids))
        .all()
    )
    return [
        {
            "type": "user",
            "id": user.id,
            "username": user.username,
            "username_highlight": username_highlight,
            "bio": user.bio,
            "bio_highlight": _bio_highlight(bio_highlight),
            "avatar_url": user.avatar_url,
        }
        for user, username_highlight, bio_highlight in rows
    ]


def _organization_hits(db: Session, ids: list[uuid.UUID], parsed: _Query | None) -> list[dict]:
    live = organizations.live_member_counts(db)
    rows = (
        db.query(
            Organization,
            func.coalesce(live.c.members, 0),
            _headline(Organization.name, parsed).label("name_highlight"),
            _headline(Organization.bio, parsed, _HEADLINE_OPTS_FRAGMENT).label("bio_highlight"),
        )
        .outerjoin(live, live.c.org_id == Organization.id)
        .filter(Organization.id.in_(ids))
        .all()
    )
    return [
        {
            "type": "organization",
            "id": org.id,
            "slug": org.slug,
            "name": org.name,
            "name_highlight": name_highlight,
            "bio": org.bio,
            "bio_highlight": _bio_highlight(bio_highlight),
            "avatar_url": org.avatar_url,
            "member_count": members,
        }
        for org, members, name_highlight, bio_highlight in rows
    ]


def collectable_matches(
    db: Session, *columns: Any, query: str, filters: EventFilters, user: User
) -> SAQuery:
    """``columns`` (``Event.id`` when none) of each of ``user``'s located events search lists
    for ``query`` and ``filters`` that a collection can hold. Unordered and unlimited, so
    the set does not depend on how many hits a page has loaded; the count, the paged read and
    the bulk add of ``services/collections_bulk`` all read it.

    Search's own matching (:func:`_matching` on :func:`_located_hits`), narrowed to the
    events credited to ``user`` (``services/event_filters.credited_to``) and to
    ``services/event_filters.collectable_events``. An empty ``query`` with no active filter
    matches nothing, as in :func:`search`.
    """
    q = query.strip()
    stmt = _matching(
        db.query(*(columns or (Event.id,))),
        *_located_hits(),
        credited_to([user.id]),
        collectable_events(),
        terms=_event_terms(db, q),
        view="located",
        filters=filters,
    )
    return stmt if q or filters.active else stmt.filter(false())


# The words a suggestion may offer: the titles of the events a reader can see, and live handles.
_VOCABULARY_SQL = (
    f"SELECT to_tsvector({_TS_CONFIG_NAME}, coalesce(title, '')) FROM events"
    " WHERE deleted_at IS NULL AND hidden_at IS NULL"
    f" AND status IN ('{STATUS_GEOLOCATED}', '{STATUS_DETECTED}', '{STATUS_REQUESTED}')"
    f" UNION ALL SELECT to_tsvector({_TS_CONFIG_NAME}, username) FROM users"
    " WHERE deleted_at IS NULL"
)

# ``pg_trgm`` similarity a replacement must reach: ``younis`` and ``yunis`` score 0.44.
_SIMILARITY_MIN = 0.35

_CLOSEST_WORDS = text(
    """
    WITH vocabulary AS MATERIALIZED (SELECT word, nentry FROM ts_stat(:vocabulary))
    SELECT EXISTS (SELECT 1 FROM vocabulary v WHERE v.word = typed.word) AS known,
           near.word AS closest,
           (SELECT u.username FROM users u
             WHERE u.deleted_at IS NULL AND lower(u.username) = near.word
             LIMIT 1) AS handle
    FROM unnest(CAST(:words AS text[])) WITH ORDINALITY AS input(raw, n)
    CROSS JOIN LATERAL (SELECT unaccent(lower(input.raw)) AS word) AS typed
    LEFT JOIN LATERAL (
        SELECT v.word FROM vocabulary v
        WHERE similarity(v.word, typed.word) >= :similarity
        ORDER BY similarity(v.word, typed.word) DESC, v.nentry DESC, v.word
        LIMIT 1
    ) AS near ON TRUE
    ORDER BY input.n
    """
)


def _respelled(db: Session, query: str) -> str | None:
    """``query`` with each word the catalogue does not hold replaced by its closest word
    (``pg_trgm`` similarity), spelled as the analyst spells it when it is a handle, or ``None``
    when no word changes. ``OR`` and excluded words stay as typed, and so do quotes and
    punctuation around a word."""
    tokens = query.split()
    cores = [token.strip("\"'.,;:!?()[]@") for token in tokens]
    asked = [
        i
        for i, (token, core) in enumerate(zip(tokens, cores, strict=True))
        if core and core.lower() != "or" and not token.startswith("-")
    ]
    if not asked:
        return None
    rows = db.execute(
        _CLOSEST_WORDS,
        {
            "vocabulary": _VOCABULARY_SQL,
            "words": [cores[i] for i in asked],
            "similarity": _SIMILARITY_MIN,
        },
    ).all()
    changed = False
    for i, row in zip(asked, rows, strict=True):
        if row.known or row.closest is None:
            continue
        changed = True
        core = cores[i]
        if row.handle is not None:
            word = row.handle
        elif core[:1].isupper():
            word = row.closest[:1].upper() + row.closest[1:]
        else:
            word = row.closest
        tokens[i] = tokens[i].replace(core, word, 1)
    return " ".join(tokens) if changed else None


def spelling_suggestion(
    db: Session, *, query: str, types: frozenset[str], filters: EventFilters | None = None
) -> str | None:
    """A respelling of ``query`` that finds results in ``types`` and ``filters``, for a search
    that found none: each unknown word becomes the closest word of the catalogue (``Khan Younis``
    to ``Khan Yunis``). ``None`` when a filter other than ``status`` is active, when no word has a
    close match, or when the respelling finds nothing either."""
    if (filters is not None and filters.active_beyond("status")) or not query.strip():
        return None
    candidate = _respelled(db, query.strip())
    if candidate is None:
        return None
    found = search(db, query=candidate, types=types, limit=1, filters=filters)
    return candidate if found.total else None


def suggest_authors(db: Session, *, query: str, limit: int = 8) -> list[str]:
    """Usernames matching ``query`` for the author-filter typeahead.

    Case-insensitive substring, prefix matches first then alphabetical. Scoped
    to live users credited on at least one live event: all the filter can
    match, and it keeps this anonymous endpoint from enumerating accounts. ``query``
    is gated by ``AUTHOR_FILTER_PATTERN`` at the router.
    """
    q = query.strip()
    if not q:
        return []
    has_live_event = db.query(Event.id).filter(credited_to([User.id]), *visible_events()).exists()
    rows = (
        db.query(User.username)
        .filter(
            User.deleted_at.is_(None),
            User.username.icontains(q, autoescape=True),
            has_live_event,
        )
        .order_by(User.username.istartswith(q, autoescape=True).desc(), User.username)
        .limit(limit)
        .all()
    )
    return [r.username for r in rows]
