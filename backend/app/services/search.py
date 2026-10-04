"""Full-text search across events (located + requested), users and collections.

Postgres FTS: ``plainto_tsquery`` parses user input (no operator surface to
escape), the GIN indexes from migration ``o1j3k5l7m9n1`` back the lookups, and
``ts_headline`` returns fragments with sentinel delimiters the frontend renders
as ``<mark>`` (no HTML across the wire, so XSS-safe). Soft-deleted rows are
filtered at query time.

One FTS path serves both event views (:func:`_search_events`), composed with
the standard event filters (``services/event_filters``). The TSVECTOR
expressions must stay expression-tree-equal to the migration's
``CREATE INDEX`` expressions (config name as a SQL literal, never a bound
parameter) or Postgres falls back to a sequential scan: ``_geo_tsvector``,
``_collection_tsvector``, and the ``_USER_TSVECTOR`` constant.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, literal_column, text
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql.elements import ColumnClause

from app.models.collection import Collection
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.user import User
from app.schemas.collection import CollectionRead
from app.services.collections import (
    build_collection_reads,
    has_showable_item,
    visible_collections,
)
from app.services.event_filters import EventFilters, owner_username_matches, visible_events
from app.services.thumbnails import pick_thumbnail, thumbnail_media_criteria

# ``ts_headline`` sentinels: STX / ETX, not an ASCII marker like ``[[HL]]``,
# which a user could type into a bio to corrupt highlights. Planted STX / ETX
# are stripped first (see ``_strip_sentinels``).
HIGHLIGHT_START = "\x02"
HIGHLIGHT_STOP = "\x03"

# ``HighlightAll=TRUE`` skips fragment selection on short titles (splitting
# would truncate); fragment mode is for the prose ``users.bio``.
_HEADLINE_OPTS_FULL = f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, HighlightAll=TRUE"
_HEADLINE_OPTS_FRAGMENT = (
    f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, MaxFragments=2, MaxWords=20, MinWords=5"
)


def _strip_sentinels(col: str) -> str:
    """SQL fragment stripping STX/ETX from ``col`` so planted sentinels can't unbalance the markup."""
    return f"translate({col}, chr(2) || chr(3), '')"


# The config name stays a SQL literal, never a bound parameter: a
# ``$1::regconfig`` would not match the index expression tree. The events and
# collections vectors use ORM ``func`` calls to compose with the shared
# filters; the users one is raw SQL (no event filters).
#
# ``source_url`` is excluded (see the migration docstring).
_TS_CONFIG: ColumnClause[str] = literal_column("'simple'")
_USER_TSVECTOR = "to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(bio, ''))"


def _geo_tsvector():
    """``to_tsvector('simple', coalesce(title, ''))``, equal to the migration's index expression."""
    return func.to_tsvector(_TS_CONFIG, func.coalesce(Event.title, literal_column("''")))


def _collection_tsvector():
    """``to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description_text, ''))``.

    Uses the plain-text projection, not the Tiptap JSONB, which would index
    node names. Expression-tree-equal to ``ix_collections_search_fts`` in
    migration ``s7u9w1y3a5c7`` (the parenthesising is the parsing).
    """
    document = (
        func.coalesce(Collection.title, literal_column("''"))
        .op("||")(literal_column("' '"))
        .op("||")(func.coalesce(Collection.description_text, literal_column("''")))
    )
    return func.to_tsvector(_TS_CONFIG, document)


def _search_events(
    db: Session,
    *extra_criteria,
    query: str,
    limit: int,
    view: str,
    filters: EventFilters,
) -> tuple[list[uuid.UUID], dict[uuid.UUID, str], int]:
    """Run the FTS over ``events`` and return ``(ids, highlights, total)``.

    ``ids`` are ranked (``ts_rank`` desc, ``created_at`` desc), ``highlights``
    maps id to its ``ts_headline`` title, ``total`` is the pre-``LIMIT`` count
    (``COUNT(*) OVER ()``). Soft-deleted rows are excluded in ``filters.apply``.

    With active filters and an empty ``query`` the FTS predicate drops: browse
    mode, newest first, plain title as the "highlight". The profile's "Show
    more" lands here.

    ``extra_criteria`` narrow the view further (closed rows stay out of search).
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
            # Still sentinel-stripped: planted STX/ETX must not render fake <mark>s.
            func.translate(
                Event.title, literal_column("chr(2) || chr(3)"), literal_column("''")
            ).label("title_highlight"),
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

    Live ``geolocated`` / ``detected`` rows with a subject coordinate. The
    status predicate is needed because a ``requested`` row may carry an
    approximate guess yet belongs to the requested view. Closed rows stay out.
    ``hits`` are dicts for the router's Pydantic schema.
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

    # Hydrate in one round-trip; re-sort in Python because ``IN (...)`` loses rank order.
    geos = (
        db.query(
            Event,
            func.ST_Y(Event.event_coords).label("lat"),
            func.ST_X(Event.event_coords).label("lng"),
        )
        .options(
            joinedload(Event.owner),
            joinedload(Event.media.and_(thumbnail_media_criteria())),
            joinedload(Event.tags),
        )
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
        thumb = pick_thumbnail(geo.media)
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "lat": row.lat,
                "lng": row.lng,
                "event_date": geo.event_date,
                "is_graphic": geo.is_graphic,
                "status": geo.status,
                "owner": geo.owner,
                "media": [thumb] if thumb is not None else [],
                "tags": geo.tags,
            }
        )
    return out, total


def search_requests(
    db: Session, *, query: str, limit: int, filters: EventFilters | None = None
) -> tuple[list[dict], int]:
    """Top-N requested events matching ``query`` + the pre-LIMIT total.

    ``status = 'requested'`` only (withdrawn requests stay out of search).
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
            joinedload(Event.media.and_(thumbnail_media_criteria())),
            joinedload(Event.tags),
        )
        .filter(Event.id.in_(ids))
        .all()
    )
    geo_by_id = {g.id: g for g in geos}

    out: list[dict] = []
    for hit_id in ids:
        geo = geo_by_id.get(hit_id)
        if geo is None:
            continue
        thumb = pick_thumbnail(geo.media)
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "source_url": geo.source_url,
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
    db: Session, *, query: str, limit: int, author: str | None = None
) -> tuple[list[CollectionRead], int]:
    """Top-N collections matching ``query`` + the pre-LIMIT total.

    FTS over :func:`_collection_tsvector`, ranked by ``ts_rank`` then
    ``created_at`` desc.

    Only readable, non-empty collections match
    (``services/collections.visible_collections`` and ``has_showable_item``),
    so a hit never opens on an empty shelf.

    ``author`` scopes to one owner, with the same exact case-insensitive match
    as the event groups. No highlights: the card prints the collection's own
    text.

    With an empty ``query`` and an ``author`` the FTS predicate drops (browse
    mode, newest first; the profile's Collections "Show more" lands here). An
    empty query with no author returns nothing: that is a listing, not a search.

    One statement selects the collection with its owner, already in rank
    order: there are no per-hit highlights to key back onto, so no id re-fetch.
    """
    q = query.strip()
    if not q and not author:
        return [], 0
    stmt = (
        db.query(Collection, func.count().over().label("total_count"))
        .options(joinedload(Collection.owner))
        .filter(*visible_collections(), has_showable_item())
    )
    if author:
        stmt = stmt.filter(Collection.owner.has(owner_username_matches(author)))
    if q:
        tsquery = func.plainto_tsquery(_TS_CONFIG, q)
        stmt = stmt.filter(_collection_tsvector().op("@@")(tsquery)).order_by(
            func.ts_rank(_collection_tsvector(), tsquery).desc(),
            Collection.created_at.desc(),
        )
    else:
        stmt = stmt.order_by(Collection.created_at.desc())
    rows = stmt.limit(limit).all()
    if not rows:
        return [], 0
    return build_collection_reads(db, [row[0] for row in rows]), int(rows[0].total_count)


def search_users(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N analyst handles matching ``query`` + the pre-LIMIT total.

    ``bio_highlight`` is set only when the bio contributed to the match.
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
        # ts_headline returns the original text on a no-match field.
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

    ``types`` is a subset of ``{"geolocation", "request", "collection",
    "user"}`` (the router expands ``type=all``). An empty query returns empty
    unless a filter is active, which puts the event groups in browse mode.

    ``filters`` scopes the two event groups. While any filter is active the
    users group empties, since the filters are event predicates. The
    collections group follows the same rule except for ``author``, which
    narrows it (and enables browse mode); any other filter names an event
    property and empties it (``EventFilters.active_beyond_author``).

    Returns ``{group: {"hits": [...], "total": int}}`` for every group, with
    empty hits and total 0 for unrequested ones so the shape stays stable.
    """
    filters = filters or EventFilters()
    result: dict[str, dict] = {
        "geolocations": {"hits": [], "total": 0},
        "requests": {"hits": [], "total": 0},
        "collections": {"hits": [], "total": 0},
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
    if "collection" in types and not filters.active_beyond_author:
        collection_hits, total = search_collections(
            db, query=query, limit=limit, author=filters.author
        )
        result["collections"] = {"hits": collection_hits, "total": total}
    if "user" in types and not filters.active:
        hits, total = search_users(db, query=query, limit=limit)
        result["users"] = {"hits": hits, "total": total}
    return result


def suggest_authors(db: Session, *, query: str, limit: int = 8) -> list[str]:
    """Usernames matching ``query`` for the author-filter typeahead.

    Case-insensitive substring, prefix matches first then alphabetical. Scoped
    to live users owning at least one live event: all the filter can match,
    and it keeps this anonymous endpoint from enumerating accounts. ``query``
    is gated by ``AUTHOR_FILTER_PATTERN`` at the router; ``_`` is escaped
    because it is allowed there but is a LIKE wildcard.
    """
    q = query.strip()
    if not q:
        return []
    like = q.replace("_", r"\_")
    has_live_event = (
        db.query(Event.id).filter(Event.owner_id == User.id, *visible_events()).exists()
    )
    rows = (
        db.query(User.username)
        .filter(
            User.deleted_at.is_(None),
            User.username.ilike(f"%{like}%", escape="\\"),
            has_live_event,
        )
        .order_by(User.username.ilike(f"{like}%", escape="\\").desc(), User.username)
        .limit(limit)
        .all()
    )
    return [r.username for r in rows]


# Allowed ``type`` values, re-exported by the router for its 422 message.
# ``event`` is the union of the two event groups (the unified "Events" chip).
ALLOWED_TYPES = {"all", "event", "geolocation", "request", "collection", "user"}


def types_from_param(param: str) -> set[str]:
    """Expand the ``type`` parameter (already validated by the router) into the group set."""
    if param == "all":
        return {"geolocation", "request", "collection", "user"}
    if param == "event":
        return {"geolocation", "request"}
    return {param}
