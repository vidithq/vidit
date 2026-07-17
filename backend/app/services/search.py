"""Full-text search across events (located + requested) and users.

Postgres FTS: ``plainto_tsquery`` parses user input (forgiving of spaces /
punctuation, no operator surface to escape), the GIN indexes from migration
``o1j3k5l7m9n1`` back the lookups, and ``ts_headline`` returns the matching
fragment with sentinel delimiters the frontend renders as ``<mark>`` —
XSS-safe by construction, no HTML across the wire. Soft-deleted rows are
filtered at query time.

Since the request + geolocation merge there is a single FTS query path over the
one ``events`` table (:func:`_search_events`); the located and requested
views differ only by a status/coords filter and the fields each surfaces, and
both compose with the standard event filter set (``services/event_filters``),
the same predicates `/events` and `/events/points` take. The TSVECTOR
expressions must stay expression-tree-equal to the migration's
``CREATE INDEX`` expressions (config name as a SQL literal, never a bound
parameter) or Postgres falls back to a sequential scan; the event one is the
``_geo_tsvector`` builder, the user one a module constant, so the queries and
the migration can't drift.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, literal_column, text
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql.elements import ColumnClause

from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventInvestigator,
)
from app.models.media import Media
from app.models.user import User
from app.services.event_filters import EventFilters

# Sentinel bytes ``ts_headline`` wraps around matched fragments. STX / ETX
# (U+0002 / U+0003) not an ASCII string like ``[[HL]]``: an ASCII marker is
# forgeable — a user typing ``"watch [[/HL]] this"`` into their bio would
# corrupt highlight parity for searchers. STX / ETX never appear in
# legitimate text, and a hostile client planting them via a raw-bytes PATCH
# is stripped before ``ts_headline`` runs — see ``_strip_sentinels``.
HIGHLIGHT_START = "\x02"
HIGHLIGHT_STOP = "\x03"

# ``ts_headline`` options strings, sent as bound parameters so they stay
# injection-proof if made dynamic later. ``HighlightAll=TRUE`` skips
# fragment selection on short titles (splitting would truncate);
# fragment-mode applies to the prose ``users.bio``.
_HEADLINE_OPTS_FULL = f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, HighlightAll=TRUE"
_HEADLINE_OPTS_FRAGMENT = (
    f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, MaxFragments=2, MaxWords=20, MinWords=5"
)


def _strip_sentinels(col: str) -> str:
    """SQL fragment: strip STX/ETX bytes from ``col`` before ts_headline.

    Belt to the sentinel-choice suspenders: even if a hostile client plants
    the sentinel bytes via a raw-bytes write, the document passed to
    ``ts_headline`` has them stripped, so the response markup stays
    well-balanced regardless of what's on disk. ``translate`` removes both
    in one call with no regex cost.
    """
    return f"translate({col}, chr(2) || chr(3), '')"


# TSVECTOR expressions. The events one is built from ORM ``func`` calls so it
# composes with the shared filter predicates; the config name stays a SQL
# literal (``literal_column``), never a bound parameter, because a
# ``$1::regconfig`` expression would not match the migration's index
# expression tree and the planner would fall back to a sequential scan. The
# users one stays raw SQL (its query takes no event filters).
#
# ``source_url`` is excluded — see the migration docstring for why URL
# substring matches don't survive the simple parser's tokenization.
_TS_CONFIG: ColumnClause[str] = literal_column("'simple'")
_USER_TSVECTOR = "to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(bio, ''))"


def _geo_tsvector():
    """``to_tsvector('simple', coalesce(title, ''))`` — must stay
    expression-tree-equal to the migration's GIN index expression."""
    return func.to_tsvector(_TS_CONFIG, func.coalesce(Event.title, literal_column("''")))


def _search_events(
    db: Session,
    *extra_criteria,
    query: str,
    limit: int,
    view: str,
    filters: EventFilters,
) -> tuple[list[uuid.UUID], dict[uuid.UUID, str], int]:
    """Run the FTS over ``events`` and return ``(ids, highlights, total)``.

    The single FTS query path for both event views, composed with the shared
    filter predicates (:class:`EventFilters`, the same set `/events` and
    `/events/points` take) so the surfaces can't drift. ``ids`` are ranked
    (``ts_rank`` desc, ``created_at`` desc tie-break), ``highlights`` maps
    each id to its ``ts_headline`` title, and ``total`` is the pre-``LIMIT``
    match count via ``COUNT(*) OVER ()`` so the UI renders "3 of 142", not
    "3 of 3". Soft-deleted rows are excluded (inside ``filters.apply``). The
    caller hydrates the rows it needs off the ranked id list.

    With active filters and an **empty** ``query`` the FTS predicate drops
    entirely: browse mode, the filtered view newest first with the plain
    title as its own "highlight" (nothing to mark). The profile's "Show
    more" lands here, then typing narrows within it.

    ``extra_criteria`` are per-group predicates layered on top of the view
    (search is narrower than the list views: closed rows stay out).
    """
    q = query.strip()
    if q:
        tsquery = func.plainto_tsquery(_TS_CONFIG, q)
        headline = func.ts_headline(
            _TS_CONFIG,
            func.translate(Event.title, literal_column("chr(2) || chr(3)"), literal_column("''")),
            tsquery,
            _HEADLINE_OPTS_FULL,
        ).label("title_highlight")
        stmt = db.query(Event.id, headline, func.count().over().label("total_count"))
        stmt = filters.apply(stmt, view=view).filter(*extra_criteria)
        stmt = stmt.filter(_geo_tsvector().op("@@")(tsquery))
        stmt = stmt.order_by(func.ts_rank(_geo_tsvector(), tsquery).desc(), Event.created_at.desc())
    else:
        stmt = db.query(
            Event.id,
            Event.title.label("title_highlight"),
            func.count().over().label("total_count"),
        )
        stmt = filters.apply(stmt, view=view).filter(*extra_criteria)
        stmt = stmt.order_by(Event.created_at.desc())

    rows = stmt.limit(limit).all()
    if not rows:
        return [], {}, 0
    total = int(rows[0].total_count)
    ids = [r.id for r in rows]
    highlight_by_id: dict[uuid.UUID, str] = {r.id: r.title_highlight for r in rows}
    return ids, highlight_by_id, total


def search_geolocations(
    db: Session, *, query: str, limit: int, filters: EventFilters | None = None
) -> tuple[list[dict], int]:
    """Top-N located events matching ``query`` + the pre-LIMIT total.

    The located view: live ``geolocated`` / ``detected`` rows with a subject
    coordinate. A status predicate (not bare ``event_coords IS NOT NULL``)
    because a ``requested`` row may now carry an approximate guess yet belongs
    to the requested view; closed rows stay out of search (narrower than the
    ``located`` list view, which keeps them as audit trail). Returns
    ``(hits, total)``: ``hits`` are dicts ready for the router's Pydantic
    schema; ``total`` is the pre-``LIMIT`` match count.
    """
    ids, highlight_by_id, total = _search_events(
        db,
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
        Event.event_coords.isnot(None),
        query=query,
        limit=limit,
        view="located",
        filters=filters or EventFilters(),
    )
    if not ids:
        return [], 0

    # Hydrate the full geo objects + relationships in one round-trip, keyed
    # off the ranked id list. Re-sort in Python because ``IN (...)`` doesn't
    # preserve order — the cost of the two-step "rank then hydrate" pattern.
    geos = (
        db.query(
            Event,
            func.ST_Y(Event.event_coords).label("lat"),
            func.ST_X(Event.event_coords).label("lng"),
        )
        .options(
            joinedload(Event.owner),
            joinedload(Event.tags),
        )
        .filter(Event.id.in_(ids))
        .all()
    )
    geo_by_id = {g.Event.id: g for g in geos}

    out: list[dict] = []
    for hit_id in ids:
        row = geo_by_id.get(hit_id)
        if row is None:  # soft-deleted between SELECTs — drop silently
            continue
        geo = row.Event
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "lat": row.lat,
                "lng": row.lng,
                "event_date": geo.event_date,
                "is_demo": geo.is_demo,
                "status": geo.status,
                "owner": geo.owner,
                "tags": geo.tags,
            }
        )
    return out, total


def search_requests(
    db: Session, *, query: str, limit: int, filters: EventFilters | None = None
) -> tuple[list[dict], int]:
    """Top-N requested events (requests) matching ``query`` + the pre-LIMIT total.

    The requested view: ``status = 'requested'`` (withdrawn requests stay out
    of search, unlike the list view's audit trail). Same FTS path as the
    located view via :func:`_search_events`; carries ``claimer_count``
    (investigator count, reader vocabulary) so the result card renders the
    same "N working" badge as the index.
    """
    ids, highlight_by_id, total = _search_events(
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
        .options(
            joinedload(Event.owner),
            joinedload(Event.media.and_(Media.role == "source")),
            joinedload(Event.tags),
        )
        .filter(Event.id.in_(ids))
        .all()
    )
    geo_by_id = {g.id: g for g in geos}

    # One grouped count for the result set, same shape as the requested-view
    # list aggregate so the card renders the same badge.
    counts: dict[uuid.UUID, int] = {
        gid: int(c)
        for gid, c in db.query(EventInvestigator.event_id, func.count("*"))
        .filter(EventInvestigator.event_id.in_(ids))
        .group_by(EventInvestigator.event_id)
        .all()
    }

    out: list[dict] = []
    for hit_id in ids:
        geo = geo_by_id.get(hit_id)
        if geo is None:
            continue
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "source_url": geo.source_url,
                "status": geo.status,
                "created_at": geo.created_at,
                "is_demo": geo.is_demo,
                "owner": geo.owner,
                "media": geo.media,
                "tags": geo.tags,
                "claimer_count": counts.get(geo.id, 0),
            }
        )
    return out, total


def search_users(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N analyst handles matching ``query`` + the pre-LIMIT total.

    ``username_highlight`` always present (username is always indexed);
    ``bio_highlight`` only when bio carries text AND contributed to the
    match, keeping an empty snippet block off the UI. Two ``:opts_*``
    params because username gets full-highlight (it's short) and bio gets
    fragment-mode (it's prose).
    """
    sql = text(
        f"""
        SELECT id,
               ts_rank({_USER_TSVECTOR}, plainto_tsquery('simple', :q)) AS rank,
               ts_headline(
                   'simple', {_strip_sentinels("username")},
                   plainto_tsquery('simple', :q),
                   :opts_full
               ) AS username_highlight,
               CASE
                   WHEN bio IS NULL OR length(bio) = 0 THEN NULL
                   ELSE ts_headline(
                       'simple', {_strip_sentinels("bio")},
                       plainto_tsquery('simple', :q),
                       :opts_fragment
                   )
               END AS bio_highlight,
               COUNT(*) OVER () AS total_count
        FROM users
        WHERE deleted_at IS NULL
          AND {_USER_TSVECTOR} @@ plainto_tsquery('simple', :q)
        ORDER BY rank DESC, created_at DESC
        LIMIT :lim
        """
    )
    rows = db.execute(
        sql,
        {
            "q": query,
            "lim": limit,
            "opts_full": _HEADLINE_OPTS_FULL,
            "opts_fragment": _HEADLINE_OPTS_FRAGMENT,
        },
    ).all()
    if not rows:
        return [], 0

    total = int(rows[0].total_count)
    ids = [r.id for r in rows]
    highlights: dict[uuid.UUID, tuple[str, str | None]] = {
        r.id: (r.username_highlight, r.bio_highlight) for r in rows
    }

    users = db.query(User).filter(User.id.in_(ids)).all()
    user_by_id = {u.id: u for u in users}

    out: list[dict] = []
    for hit_id in ids:
        u = user_by_id.get(hit_id)
        if u is None:
            continue
        username_hl, bio_hl = highlights[hit_id]
        # Surface ``bio_highlight`` only when bio actually contains a match
        # marker — ts_headline returns the original text on a no-match
        # field, which would clutter the card with a non-highlighting snippet.
        bio_highlight: str | None = None
        if bio_hl is not None and HIGHLIGHT_START in bio_hl:
            bio_highlight = bio_hl
        out.append(
            {
                "id": u.id,
                "username": u.username,
                "username_highlight": username_hl,
                "bio": u.bio,
                "bio_highlight": bio_highlight,
                "is_trusted": u.is_trusted,
                "trust_reason": u.trust_reason,
                "avatar_url": u.avatar_url,
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
) -> dict[str, dict]:
    """Run grouped FTS across the requested entity types.

    ``types`` is a subset of ``{"geolocation", "request", "user"}`` (the
    router expands ``type=all`` before calling). An empty / whitespace-only
    query short-circuits to empty, keeping index cost off "typed but didn't
    submit" hits — unless a filter is active, which flips the event groups
    into browse mode (the filtered view, newest first).

    ``filters`` (the standard event filter set) scopes the two event groups;
    while any filter is active the users group empties: the filters are
    event predicates, and an unfiltered analyst list next to a filtered
    event view would read as if the filter applied. The response shape stays
    stable either way.

    Returns ``{group: {"hits": [...], "total": int}}`` for every group:
    ``hits`` capped at ``limit``, ``total`` the pre-LIMIT match count for
    "3 of 142". Unrequested groups get empty hits / total=0 so the JSON
    shape stays stable for the frontend.
    """
    filters = filters or EventFilters()
    result: dict[str, dict] = {
        "geolocations": {"hits": [], "total": 0},
        "requests": {"hits": [], "total": 0},
        "users": {"hits": [], "total": 0},
    }
    if not query.strip() and not filters.active:
        return result

    if "geolocation" in types:
        hits, total = search_geolocations(db, query=query, limit=limit, filters=filters)
        result["geolocations"] = {"hits": hits, "total": total}
    if "request" in types:
        hits, total = search_requests(db, query=query, limit=limit, filters=filters)
        result["requests"] = {"hits": hits, "total": total}
    if "user" in types and not filters.active:
        hits, total = search_users(db, query=query, limit=limit)
        result["users"] = {"hits": hits, "total": total}
    return result


def suggest_authors(db: Session, *, query: str, limit: int = 8) -> list[str]:
    """Usernames matching ``query`` for the author-filter typeahead.

    Case-insensitive substring over live users, prefix matches first then
    alphabetical, so the picker surfaces real handles and the filter itself
    can stay an exact match. ``query`` is gated by ``AUTHOR_FILTER_PATTERN``
    at the router, so it is ilike-safe here.
    """
    q = query.strip()
    if not q:
        return []
    rows = (
        db.query(User.username)
        .filter(User.deleted_at.is_(None), User.username.ilike(f"%{q}%"))
        .order_by(User.username.ilike(f"{q}%").desc(), User.username)
        .limit(limit)
        .all()
    )
    return [r.username for r in rows]


# Allowed ``type`` parameter values. Re-exported by the router for the 422
# message so the spec stays in one place. ``event`` is the reader-facing union
# of the two event groups (the search page's unified "Events" chip: the filter
# set only applies to events, so the picker doesn't force the geolocation vs
# request split); the two singletons stay for callers that want one group.
ALLOWED_TYPES = {"all", "event", "geolocation", "request", "user"}


def types_from_param(param: str) -> set[str]:
    """Translate the ``type`` query parameter into the internal set.

    ``"all"`` expands to the union, ``"event"`` to the two event groups;
    anything else is a singleton. The router validates
    ``param in ALLOWED_TYPES`` first, so this trusts its input.
    """
    if param == "all":
        return {"geolocation", "request", "user"}
    if param == "event":
        return {"geolocation", "request"}
    return {param}
