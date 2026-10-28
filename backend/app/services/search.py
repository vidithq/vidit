"""Full-text search across events (located + requested), collections, users and organizations.

Postgres FTS: ``websearch_to_tsquery`` parses user input (quoted phrases, ``OR``
and ``-word``, never a syntax error), and ``ts_headline`` returns fragments with
sentinel delimiters the frontend renders as ``<mark>`` (no HTML across the wire,
so XSS-safe). Soft-deleted rows are filtered at query time.

One FTS path serves both event views (:func:`_search_events`), composed with
the standard event filters (``services/event_filters``). An event's document is
its title and its sources' titles together, so ``-word`` excludes an event
whichever of them holds the word. The collections, users and organizations
TSVECTOR expressions must stay expression-tree-equal to their GIN indexes
(config name as a SQL literal, never a bound parameter) or Postgres falls back to
a sequential scan: ``_collection_tsvector`` and the ``_USER_TSVECTOR`` and
``_ORGANIZATION_TSVECTOR`` constants.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ColumnElement,
    String,
    Text,
    bindparam,
    cast,
    false,
    func,
    literal_column,
    or_,
    select,
    text,
    tuple_,
)
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION, TSQUERY
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql.elements import ColumnClause

from app.models.collection import Collection
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.organization import Organization
from app.models.source import Source, SourceLink
from app.models.user import User
from app.schemas.collection import CollectionRead
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
    owner_username_matches,
    taxonomy_predicates,
    visible_events,
)
from app.services.geolocator_credit import CREDIT_LOAD, live_geolocators
from app.services.pagination import encode_ranked_cursor
from app.services.thumbnails import pick_thumbnail, thumbnail_loads

# ``ts_headline`` sentinels: STX / ETX, not an ASCII marker like ``[[HL]]``,
# which a user could type into a bio to corrupt highlights. Planted STX / ETX
# are stripped first (see ``_strip_sentinels``).
HIGHLIGHT_START = "\x02"
HIGHLIGHT_STOP = "\x03"

# ``HighlightAll=TRUE`` skips fragment selection on short titles (splitting
# would truncate); fragment mode is for the prose bios.
_HEADLINE_OPTS_FULL = f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, HighlightAll=TRUE"
_HEADLINE_OPTS_FRAGMENT = (
    f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, MaxFragments=2, MaxWords=20, MinWords=5"
)


def _strip_sentinels(col: str) -> str:
    """SQL fragment stripping STX/ETX from ``col`` so planted sentinels can't unbalance the markup."""
    return f"translate({col}, chr(2) || chr(3), '')"


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
    stmt: SAQuery, *criteria, terms: _EventTerms, view: str, filters: EventFilters
) -> SAQuery:
    """Narrow ``stmt`` to the events an event group matches: ``filters`` on ``view``, the group's
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
    """What the Geolocations group adds to the ``located`` view: a live ``geolocated`` or
    ``detected`` row with a subject coordinate. A ``requested`` row may carry an approximate
    guess yet belongs to the requested view; closed rows stay out."""
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


# What both event groups' hits read: the owner, the card thumbnail and the tags. Hydration runs
# on an id list without ``LIMIT``, so ``joinedload`` on the tags cannot truncate it.
_HIT_LOADS = (joinedload(Event.owner), *thumbnail_loads(), joinedload(Event.tags))


def _search_events(
    db: Session,
    *extra_criteria,
    query: str,
    limit: int,
    view: str,
    filters: EventFilters,
    after: tuple[float, datetime, uuid.UUID] | None = None,
) -> tuple[list[uuid.UUID], dict[uuid.UUID, str], int, str | None]:
    """Run the FTS over ``events`` and return ``(ids, highlights, total, next_cursor)``.

    The query matches an event's title, its sources' titles and its source URLs
    (:func:`_event_match`). ``ids`` are ranked by ``ts_rank`` of the title desc,
    then ``created_at`` desc and ``id`` desc, a total order. ``highlights`` maps
    id to its ``ts_headline`` title. ``total`` is the whole match count
    (``COUNT(*) OVER ()``), whatever ``after`` skips. Soft-deleted rows are
    excluded in ``filters.apply``.

    With active filters and an empty ``query`` the FTS predicate drops: browse
    mode, newest first, plain title as the "highlight", rank 0 for every row.
    The profile's "Show more" lands here.

    ``after`` resumes the walk past a :func:`encode_ranked_cursor` position.
    ``next_cursor`` names the page's last row when a further row exists, else
    ``None``. The count runs in the inner query, before the cursor predicate, so
    every page reports the same total.

    ``extra_criteria`` narrow the view further (closed rows stay out of search).
    """
    q = query.strip()
    terms = _event_terms(db, q)
    # Sentinel-stripped in browse mode too: planted STX/ETX must not render fake <mark>s.
    title = func.translate(Event.title, literal_column("chr(2) || chr(3)"), literal_column("''"))
    rank: ColumnElement[float] = literal_column("0", DOUBLE_PRECISION)
    if q:
        title = func.ts_headline(
            _TS_CONFIG, title, _tsquery(terms.query_parsed.typed), _HEADLINE_OPTS_FULL
        )
        # Ranked on the words that are not a handle, which a credited event's title need not hold.
        # ``real`` widened to ``double precision``: a ``real`` reaches Python as its
        # shortest float4 text, a different double than the one Postgres compares
        # against the cursor, so the walk would skip the cursor row's rank ties.
        rank = cast(
            _rank(_geo_tsvector(), terms.parsed if terms.text else terms.query_parsed),
            DOUBLE_PRECISION,
        )
    stmt = db.query(
        Event.id,
        Event.created_at,
        title.label("title_highlight"),
        rank.label("rank"),
        func.count().over().label("total_count"),
    )
    ranked = _matching(stmt, *extra_criteria, terms=terms, view=view, filters=filters).subquery()

    page = db.query(ranked)
    if after is not None:
        page = page.filter(tuple_(ranked.c.rank, ranked.c.created_at, ranked.c.id) < after)
    rows = (
        page.order_by(ranked.c.rank.desc(), ranked.c.created_at.desc(), ranked.c.id.desc())
        .limit(limit + 1)
        .all()
    )
    if not rows:
        return [], {}, 0, None
    served = rows[:limit]
    last = served[-1]
    next_cursor = (
        encode_ranked_cursor(last.rank, last.created_at, last.id) if len(rows) > limit else None
    )
    highlight_by_id: dict[uuid.UUID, str] = {r.id: r.title_highlight for r in served}
    return [r.id for r in served], highlight_by_id, int(rows[0].total_count), next_cursor


def search_geolocations(
    db: Session,
    *,
    query: str,
    limit: int,
    filters: EventFilters | None = None,
    after: tuple[float, datetime, uuid.UUID] | None = None,
) -> tuple[list[dict], int, str | None]:
    """One page of located events matching ``query``, the whole match count, and the
    next page's cursor (``None`` on the last page). ``after`` is the decoded cursor.

    The rows :func:`_located_hits` names. ``hits`` are dicts for the router's
    Pydantic schema.
    """
    ids, highlight_by_id, total, next_cursor = _search_events(
        db,
        *_located_hits(),
        query=query,
        limit=limit,
        view="located",
        filters=filters or EventFilters(),
        after=after,
    )
    if not ids:
        return [], 0, None

    # Hydrate in one round-trip; re-sort in Python because ``IN (...)`` loses rank order.
    geos = (
        db.query(
            Event,
            func.ST_Y(Event.coords).label("lat"),
            func.ST_X(Event.coords).label("lng"),
        )
        .options(*_HIT_LOADS, CREDIT_LOAD)
        .filter(Event.id.in_(ids))
        .all()
    )
    geo_by_id = {g.Event.id: g for g in geos}

    out: list[dict] = []
    for hit_id in ids:
        row = geo_by_id.get(hit_id)
        if row is None:  # soft-deleted between SELECTs
            continue
        geo = row.Event
        thumb = pick_thumbnail(geo)
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "lat": row.lat,
                "lng": row.lng,
                "occurred_date": geo.occurred_date,
                "is_graphic": geo.is_graphic,
                "status": geo.status,
                "owner": geo.owner,
                "geolocators": live_geolocators(geo),
                "media": [thumb] if thumb is not None else [],
                "tags": geo.tags,
            }
        )
    return out, total, next_cursor


def collectable_matches(
    db: Session, *columns: Any, query: str, filters: EventFilters, user: User
) -> SAQuery:
    """``columns`` (``Event.id`` when none) of each of ``user``'s events the Geolocations group
    lists for ``query`` and ``filters`` that a collection can hold. Unordered and unlimited, so
    the set does not depend on how many hits a page has loaded; the count, the paged read and
    the bulk add of ``services/collections_bulk`` all read it.

    The group's own matching (:func:`_matching` on :func:`_located_hits`), narrowed to the
    events credited to ``user`` (``services/event_filters.credited_to``) and to
    ``services/event_filters.collectable_events``. An empty ``query`` with no active filter
    matches nothing, as in :func:`search_all`.
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


def search_requests(
    db: Session, *, query: str, limit: int, filters: EventFilters | None = None
) -> tuple[list[dict], int]:
    """Top-N requested events matching ``query`` + the pre-LIMIT total.

    ``status = 'requested'`` only (withdrawn requests stay out of search).
    """
    ids, highlight_by_id, total, _ = _search_events(
        db,
        Event.status == STATUS_REQUESTED,
        query=query,
        limit=limit,
        view="requested",
        filters=filters or EventFilters(),
    )
    if not ids:
        return [], 0

    geos = (
        db.query(Event)
        .options(*_HIT_LOADS, selectinload(Event.sources).selectinload(Source.links))
        .filter(Event.id.in_(ids))
        .all()
    )
    geo_by_id = {g.id: g for g in geos}

    out: list[dict] = []
    for hit_id in ids:
        geo = geo_by_id.get(hit_id)
        if geo is None:
            continue
        thumb = pick_thumbnail(geo)
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "source_urls": [link.url for source in geo.sources for link in source.links],
                "status": geo.status,
                "created_at": geo.created_at,
                "is_graphic": geo.is_graphic,
                "owner": geo.owner,
                "media": [thumb] if thumb is not None else [],
                "tags": geo.tags,
            }
        )
    return out, total


def search_collections(
    db: Session,
    *,
    query: str,
    limit: int,
    author: str | None = None,
    tags: list[str] | None = None,
) -> tuple[list[CollectionRead], int]:
    """Top-N collections matching ``query`` + the pre-LIMIT total.

    FTS over :func:`_collection_tsvector`, ranked by ``ts_rank`` then
    ``created_at`` desc.

    Only readable, non-empty collections match
    (``services/collections.visible_collections`` and ``has_showable_item``),
    so a hit never opens on an empty shelf.

    ``author`` scopes to one owner, with the same exact case-insensitive match
    as the event groups. ``tags`` keeps the collections holding a showable
    event tagged with any of them, on the event or a source: the tags the card
    prints (``services/collections.tags_for``). No highlights: the card prints
    the collection's own text.

    With an empty ``query`` and an ``author`` or ``tags`` the FTS predicate
    drops (browse mode, newest first; the profile's Collections "Show more"
    lands here). An empty query with neither returns nothing: that is a
    listing, not a search.

    One statement selects the collection with its owner, already in rank
    order: there are no per-hit highlights to key back onto, so no id re-fetch.
    """
    q = query.strip()
    if not q and not author and not tags:
        return [], 0
    stmt = (
        db.query(Collection, func.count().over().label("total_count"))
        .options(joinedload(Collection.owner))
        .filter(*visible_collections(), has_showable_item())
    )
    if tags:
        stmt = stmt.filter(has_showable_item(*taxonomy_predicates(tag=tags)))
    if author:
        stmt = stmt.filter(Collection.owner.has(owner_username_matches(author)))
    if q:
        parsed = _parse(db, q)[0]
        stmt = stmt.filter(_collection_tsvector().op("@@")(_tsquery(parsed.typed))).order_by(
            _rank(_collection_tsvector(), parsed).desc(),
            Collection.created_at.desc(),
        )
    else:
        stmt = stmt.order_by(Collection.created_at.desc())
    rows = stmt.limit(limit).all()
    if not rows:
        return [], 0
    return build_collection_reads(db, [row[0] for row in rows]), int(rows[0].total_count)


def _search_profiles(
    db: Session,
    *,
    table: str,
    tsvector: str,
    name_col: str,
    live: str,
    query: str,
    limit: int,
    handle_col: str | None = None,
) -> tuple[list[uuid.UUID], dict[uuid.UUID, tuple[str, str | None]], int]:
    """Rank one profile table (analysts or organizations) for ``query``.

    Returns the ranked ids, each id's ``(name highlight, bio highlight)``, and
    the pre-LIMIT total. The bio highlight is ``None`` unless the bio
    contributed a fragment. A row whose ``handle_col`` a word of ``query`` names
    exactly (:func:`_handle_candidates`) matches whatever the other words are,
    and ranks first. ``table``, ``tsvector``, ``name_col``, ``live`` and
    ``handle_col`` are module constants, never caller input.
    """
    named_or, named_first = "", ""
    if handle_col:
        named = f"lower({handle_col}) = ANY(:handles)"
        named_or, named_first = f"OR {named}", f"{named} DESC,"
    sql = text(
        f"""
        SELECT id,
               ts_rank({tsvector}, CAST(:tsq AS tsquery))
                 + ts_rank({tsvector}, CAST(:tsq_exact AS tsquery)) AS rank,
               ts_headline(
                   {_TS_CONFIG_NAME}, {_strip_sentinels(name_col)},
                   CAST(:tsq AS tsquery),
                   :opts_full
               ) AS name_highlight,
               CASE
                   WHEN bio IS NULL OR length(bio) = 0 THEN NULL
                   ELSE ts_headline(
                       {_TS_CONFIG_NAME}, {_strip_sentinels("bio")},
                       CAST(:tsq AS tsquery),
                       :opts_fragment
                   )
               END AS bio_highlight,
               COUNT(*) OVER () AS total_count
        FROM {table}
        WHERE {live}
          AND ({tsvector} @@ CAST(:tsq AS tsquery) {named_or})
        ORDER BY {named_first} rank DESC, created_at DESC
        LIMIT :lim
        """
    )
    if handle_col:
        sql = sql.bindparams(bindparam("handles", type_=ARRAY(String)))
    parsed = _parse(db, query)[0]
    rows = db.execute(
        sql,
        {
            "tsq": parsed.typed,
            "tsq_exact": parsed.exact,
            "handles": _handle_candidates(query.strip()),
            "lim": limit,
            "opts_full": _HEADLINE_OPTS_FULL,
            "opts_fragment": _HEADLINE_OPTS_FRAGMENT,
        },
    ).all()
    if not rows:
        return [], {}, 0
    # ts_headline returns the original text on a no-match field.
    highlights = {
        r.id: (
            r.name_highlight,
            r.bio_highlight
            if r.bio_highlight is not None and HIGHLIGHT_START in r.bio_highlight
            else None,
        )
        for r in rows
    }
    return [r.id for r in rows], highlights, int(rows[0].total_count)


def search_users(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N analyst handles matching ``query`` + the pre-LIMIT total."""
    ids, highlights, total = _search_profiles(
        db,
        table="users",
        tsvector=_USER_TSVECTOR,
        name_col="username",
        live="deleted_at IS NULL",
        query=query,
        limit=limit,
        handle_col="username",
    )
    if not ids:
        return [], 0
    user_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(ids))}

    out: list[dict] = []
    for hit_id in ids:
        u = user_by_id.get(hit_id)
        if u is None:
            continue
        username_hl, bio_hl = highlights[hit_id]
        out.append(
            {
                "id": u.id,
                "username": u.username,
                "username_highlight": username_hl,
                "bio": u.bio,
                "bio_highlight": bio_hl,
                "avatar_url": u.avatar_url,
            }
        )
    return out, total


def search_organizations(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N organizations matching ``query`` on name, slug or bio + the pre-LIMIT total."""
    ids, highlights, total = _search_profiles(
        db,
        table="organizations",
        tsvector=_ORGANIZATION_TSVECTOR,
        name_col="name",
        live="TRUE",
        query=query,
        limit=limit,
    )
    if not ids:
        return [], 0
    live = organizations.live_member_counts(db)
    rows = (
        db.query(Organization, func.coalesce(live.c.members, 0))
        .outerjoin(live, live.c.org_id == Organization.id)
        .filter(Organization.id.in_(ids))
        .all()
    )
    org_by_id = {org.id: (org, members) for org, members in rows}

    out: list[dict] = []
    for hit_id in ids:
        if hit_id not in org_by_id:
            continue
        org, members = org_by_id[hit_id]
        name_hl, bio_hl = highlights[hit_id]
        out.append(
            {
                "id": org.id,
                "slug": org.slug,
                "name": org.name,
                "name_highlight": name_hl,
                "bio": org.bio,
                "bio_highlight": bio_hl,
                "avatar_url": org.avatar_url,
                "member_count": members,
            }
        )
    return out, total


def search_all(
    db: Session,
    *,
    query: str,
    types: set[str],
    limit: int,
    filters: EventFilters | None = None,
    after: tuple[float, datetime, uuid.UUID] | None = None,
) -> dict[str, dict]:
    """Run grouped FTS across the requested entity types.

    ``types`` is a subset of ``{"geolocation", "request", "collection",
    "user", "organization"}`` (the router expands ``type=all``). An empty query
    returns empty unless a filter is active, which puts the event groups in
    browse mode.

    ``filters`` scopes the two event groups. While any filter is active the
    users and organizations groups empty, since the filters are event
    predicates. The
    collections group follows the same rule except for ``author`` and ``tag``,
    which narrow it (and enable browse mode); any other filter names an event
    property a collection has no reading of, and empties it
    (``EventFilters.active_beyond``).

    ``after`` pages the geolocations group (``search_geolocations``).

    Returns ``{group: {"hits": [...], "total": int}}`` for every group, with
    empty hits and total 0 for unrequested ones so the shape stays stable. The
    geolocations group also carries ``"cursor"``, its next page's cursor or
    ``None``.
    """
    filters = filters or EventFilters()
    result: dict[str, dict] = {
        "geolocations": {"hits": [], "total": 0, "cursor": None},
        "requests": {"hits": [], "total": 0},
        "collections": {"hits": [], "total": 0},
        "users": {"hits": [], "total": 0},
        "organizations": {"hits": [], "total": 0},
    }
    if not query.strip() and not filters.active:
        return result

    if "geolocation" in types:
        hits, total, cursor = search_geolocations(
            db, query=query, limit=limit, filters=filters, after=after
        )
        result["geolocations"] = {"hits": hits, "total": total, "cursor": cursor}
    if "request" in types:
        hits, total = search_requests(db, query=query, limit=limit, filters=filters)
        result["requests"] = {"hits": hits, "total": total}
    if "collection" in types and not filters.active_beyond("author", "tag"):
        collection_hits, total = search_collections(
            db, query=query, limit=limit, author=filters.author, tags=filters.tag
        )
        result["collections"] = {"hits": collection_hits, "total": total}
    if "user" in types and not filters.active:
        hits, total = search_users(db, query=query, limit=limit)
        result["users"] = {"hits": hits, "total": total}
    if "organization" in types and not filters.active:
        hits, total = search_organizations(db, query=query, limit=limit)
        result["organizations"] = {"hits": hits, "total": total}
    return result


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


# Allowed ``type`` values, re-exported by the router for its 422 message.
# ``event`` is the union of the two event groups (the unified "Events" chip).
ALLOWED_TYPES = {"all", "event", "geolocation", "request", "collection", "user", "organization"}


def types_from_param(param: str) -> set[str]:
    """Expand the ``type`` parameter (already validated by the router) into the group set."""
    if param == "all":
        return {"geolocation", "request", "collection", "user", "organization"}
    if param == "event":
        return {"geolocation", "request"}
    return {param}
