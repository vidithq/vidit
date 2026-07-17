"""Full-text search across events (located + requested) and users.

Postgres FTS: ``plainto_tsquery`` parses user input (forgiving of spaces /
punctuation, no operator surface to escape), the GIN indexes from migration
``o1j3k5l7m9n1`` back the lookups, and ``ts_headline`` returns the matching
fragment with sentinel delimiters the frontend renders as ``<mark>`` —
XSS-safe by construction, no HTML across the wire. Soft-deleted rows are
filtered at query time.

Since the request + geolocation merge there is a single FTS query path over the
one ``events`` table (:func:`_search_events`); the located and requested
views differ only by a status/coords filter and the fields each surfaces. The
TSVECTOR expressions here must match the migration's ``CREATE INDEX`` expressions
byte-for-byte or Postgres falls back to a sequential scan; both live as module
constants so the query and the migration can't drift.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, text
from sqlalchemy.orm import Session, joinedload

from app.models.event import STATUS_REQUESTED, Event, EventInvestigator
from app.models.media import Media
from app.models.user import User

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


# TSVECTOR expressions — must match the migration index expressions. Raw
# SQL so the byte sequence the planner sees on write equals what we ask for
# on read.
#
# ``source_url`` is excluded — see the migration docstring for why URL
# substring matches don't survive the simple parser's tokenization.
_GEO_TSVECTOR = "to_tsvector('simple', coalesce(title, ''))"
_USER_TSVECTOR = "to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(bio, ''))"


def _search_events(
    db: Session, *, query: str, limit: int, extra_where: str, author: str | None = None
) -> tuple[list[uuid.UUID], dict[uuid.UUID, str], int]:
    """Run the FTS over ``events`` and return ``(ids, highlights, total)``.

    The single FTS query path for both event views: the located view and the
    requested view pass different ``extra_where`` fragments (a located
    status + coords predicate vs ``status = 'requested'``) into the same
    ``title`` TSVECTOR + ts_headline query. ``ids`` are ranked (``ts_rank``
    desc, ``created_at`` desc tie-break), ``highlights`` maps each id to its
    ``ts_headline`` title, and ``total`` is the pre-``LIMIT`` match count via
    ``COUNT(*) OVER ()`` so the UI renders "3 of 142", not "3 of 3".
    Soft-deleted rows are excluded. The caller hydrates the rows it needs off
    the ranked id list.

    ``author`` narrows to events owned by that username (bound parameter,
    exact match). With an ``author`` and an **empty** ``query`` the FTS
    predicate drops entirely: browse mode, the author's whole view newest
    first with the plain title as its own "highlight" (nothing to mark). The
    profile's "Show more" lands here, then typing narrows within it.
    """
    author_join = "JOIN users owner_u ON owner_u.id = events.owner_id" if author else ""
    author_where = "AND owner_u.username = :author" if author else ""
    params: dict[str, object] = {"lim": limit}
    if author:
        params["author"] = author

    if query.strip():
        sql = text(
            f"""
            SELECT events.id,
                   ts_rank({_GEO_TSVECTOR}, plainto_tsquery('simple', :q)) AS rank,
                   ts_headline(
                       'simple', {_strip_sentinels("title")},
                       plainto_tsquery('simple', :q),
                       :opts
                   ) AS title_highlight,
                   COUNT(*) OVER () AS total_count
            FROM events {author_join}
            WHERE events.deleted_at IS NULL
              AND {extra_where}
              {author_where}
              AND {_GEO_TSVECTOR} @@ plainto_tsquery('simple', :q)
            ORDER BY rank DESC, events.created_at DESC
            LIMIT :lim
            """
        )
        params |= {"q": query, "opts": _HEADLINE_OPTS_FULL}
    else:
        sql = text(
            f"""
            SELECT events.id,
                   title AS title_highlight,
                   COUNT(*) OVER () AS total_count
            FROM events {author_join}
            WHERE events.deleted_at IS NULL
              AND {extra_where}
              {author_where}
            ORDER BY events.created_at DESC
            LIMIT :lim
            """
        )
    rows = db.execute(sql, params).all()
    if not rows:
        return [], {}, 0
    total = int(rows[0].total_count)
    ids = [r.id for r in rows]
    highlight_by_id: dict[uuid.UUID, str] = {r.id: r.title_highlight for r in rows}
    return ids, highlight_by_id, total


def search_geolocations(
    db: Session, *, query: str, limit: int, author: str | None = None
) -> tuple[list[dict], int]:
    """Top-N located events matching ``query`` + the pre-LIMIT total.

    The located view: live ``geolocated`` / ``detected`` rows with a subject
    coordinate. A status predicate (not bare ``event_coords IS NOT NULL``)
    because a ``requested`` row may now carry an approximate guess yet belongs
    to the requested view; closed rows stay out of search. Returns
    ``(hits, total)``: ``hits`` are dicts ready for the router's Pydantic
    schema; ``total`` is the pre-``LIMIT`` match count.
    """
    ids, highlight_by_id, total = _search_events(
        db,
        query=query,
        limit=limit,
        # Literal status values from ``EventStatus``, never user input.
        extra_where="status IN ('geolocated', 'detected') AND event_coords IS NOT NULL",
        author=author,
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
    db: Session, *, query: str, limit: int, author: str | None = None
) -> tuple[list[dict], int]:
    """Top-N requested events (requests) matching ``query`` + the pre-LIMIT total.

    The requested view: ``status = 'requested'``. Same FTS path as the located
    view via :func:`_search_events`; carries ``claimer_count`` (investigator
    count, reader vocabulary) so the result card renders the same "N working"
    badge as the index.
    """
    # ``extra_where`` is interpolated raw into the query (see ``_search_events``);
    # ``STATUS_REQUESTED`` is a module Literal constant, never user input, so this
    # fragment is safe. Never thread caller input through ``extra_where``.
    ids, highlight_by_id, total = _search_events(
        db, query=query, limit=limit, extra_where=f"status = '{STATUS_REQUESTED}'", author=author
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
    author: str | None = None,
) -> dict[str, dict]:
    """Run grouped FTS across the requested entity types.

    ``types`` is a subset of ``{"geolocation", "request", "user"}`` (the
    router expands ``type=all`` before calling). An empty / whitespace-only
    query short-circuits to empty, keeping index cost off "typed but didn't
    submit" hits — unless ``author`` is set, which flips the event groups
    into browse mode (the author's whole view, newest first).

    ``author`` scopes the two event groups to that owner's events and empties
    the users group (searching analysts within one analyst's work is
    meaningless), so the response shape stays stable while the frontend's
    author chip is active.

    Returns ``{group: {"hits": [...], "total": int}}`` for every group:
    ``hits`` capped at ``limit``, ``total`` the pre-LIMIT match count for
    "3 of 142". Unrequested groups get empty hits / total=0 so the JSON
    shape stays stable for the frontend.
    """
    result: dict[str, dict] = {
        "geolocations": {"hits": [], "total": 0},
        "requests": {"hits": [], "total": 0},
        "users": {"hits": [], "total": 0},
    }
    if not query.strip() and author is None:
        return result

    if "geolocation" in types:
        hits, total = search_geolocations(db, query=query, limit=limit, author=author)
        result["geolocations"] = {"hits": hits, "total": total}
    if "request" in types:
        hits, total = search_requests(db, query=query, limit=limit, author=author)
        result["requests"] = {"hits": hits, "total": total}
    if "user" in types and author is None:
        hits, total = search_users(db, query=query, limit=limit)
        result["users"] = {"hits": hits, "total": total}
    return result


# Allowed ``type`` parameter values. Re-exported by the router for the 422
# message so the spec stays in one place.
ALLOWED_TYPES = {"all", "geolocation", "request", "user"}


def types_from_param(param: str) -> set[str]:
    """Translate the ``type`` query parameter into the internal set.

    ``"all"`` expands to the union; anything else is a singleton. The router
    validates ``param in ALLOWED_TYPES`` first, so this trusts its input.
    """
    if param == "all":
        return {"geolocation", "request", "user"}
    return {param}
