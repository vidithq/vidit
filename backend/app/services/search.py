"""Full-text search across geolocations, bounties, and users.

Slice 1 of the search feature — see ``docs/next.md`` → *Search*.

Postgres FTS is the engine: ``plainto_tsquery`` parses user input
(forgiving of spaces / punctuation, no operator surface to escape),
the GIN indexes from migration ``o1j3k5l7m9n1`` back the lookups, and
``ts_headline`` returns the matching fragment with sentinel delimiters
that the frontend renders as ``<mark>`` (rather than passing HTML
across the wire — XSS-safe by construction). Soft-deleted rows are
filtered at query time.

The TSVECTOR expressions here must match the migration's
``CREATE INDEX`` expressions byte-for-byte or Postgres will fall back
to a sequential scan. Both live as module constants so the runtime
query and the migration can't drift.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, text
from sqlalchemy.orm import Session, joinedload

from app.models.bounty import Bounty, BountyClaim
from app.models.geolocation import Geolocation
from app.models.user import User

# Sentinel bytes that ``ts_headline`` wraps around matched fragments.
# STX / ETX (U+0002 / U+0003) instead of an ASCII string like
# ``[[HL]]``: an ASCII marker is forgeable — a user could type
# ``"watch [[/HL]] this"`` into their bio and corrupt the highlight
# parity for anyone searching their content. STX / ETX never appear
# in legitimate text (no keyboard binding, no useful escape sequence
# in JSON / HTML / Markdown forms), and on the off chance a hostile
# client plants them via a raw-bytes PATCH, the SQL strips them from
# the document before ``ts_headline`` runs — see ``_strip_sentinels``.
HIGHLIGHT_START = "\x02"
HIGHLIGHT_STOP = "\x03"

# ``ts_headline`` options strings, sent as bound parameters so the
# pattern stays injection-proof if a future contributor makes them
# dynamic. ``HighlightAll=TRUE`` skips fragment selection on short
# titles (fragment splitting would just truncate); the fragment-mode
# options apply to ``users.bio`` where the document is prose.
_HEADLINE_OPTS_FULL = f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, HighlightAll=TRUE"
_HEADLINE_OPTS_FRAGMENT = (
    f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_STOP}, MaxFragments=2, MaxWords=20, MinWords=5"
)


def _strip_sentinels(col: str) -> str:
    """SQL fragment: strip STX/ETX bytes from ``col`` before ts_headline.

    Belt to the ``HIGHLIGHT_START`` / ``HIGHLIGHT_STOP`` choice's
    suspenders: even if a hostile client plants the sentinel bytes via
    a raw-bytes write to ``users.bio`` / a title field, the document
    passed to ``ts_headline`` has them stripped, so the response's
    highlight markup stays well-formed (well-balanced even/odd parity)
    regardless of what's on disk. ``translate(col, chr(2)||chr(3), '')``
    is the cheapest tool — removes both bytes in a single function call
    with no regex engine cost.
    """
    return f"translate({col}, chr(2) || chr(3), '')"


# TSVECTOR expressions — must match the migration index expressions.
# Kept as raw SQL so the exact byte sequence Postgres planner sees on
# write is the exact byte sequence we ask for on read.
#
# ``source_url`` is intentionally excluded — see the migration's
# docstring for why URL substring matches don't survive the simple
# parser's tokenization.
_GEO_TSVECTOR = "to_tsvector('simple', coalesce(title, ''))"
_BOUNTY_TSVECTOR = _GEO_TSVECTOR  # same expression on a different table
_USER_TSVECTOR = "to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(bio, ''))"


def search_geolocations(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N geolocations matching ``query`` + the pre-LIMIT total.

    Returns ``(hits, total)``: ``hits`` is a list of dicts ready to be
    wrapped by the Pydantic schema in the router; ``total`` is the
    matching-row count *before* ``LIMIT``, computed via a
    ``COUNT(*) OVER ()`` window function on the same WHERE'd row set —
    the UI uses this to render "3 of 142", not "3 of 3". Soft-deleted
    rows are excluded; ranking is ``ts_rank`` descending then
    ``created_at`` descending as a stable tie-breaker.
    """
    sql = text(
        f"""
        SELECT id,
               ts_rank({_GEO_TSVECTOR}, plainto_tsquery('simple', :q)) AS rank,
               ts_headline(
                   'simple', {_strip_sentinels("title")},
                   plainto_tsquery('simple', :q),
                   :opts
               ) AS title_highlight,
               COUNT(*) OVER () AS total_count
        FROM geolocations
        WHERE deleted_at IS NULL
          AND {_GEO_TSVECTOR} @@ plainto_tsquery('simple', :q)
        ORDER BY rank DESC, created_at DESC
        LIMIT :lim
        """
    )
    rows = db.execute(
        sql,
        {"q": query, "lim": limit, "opts": _HEADLINE_OPTS_FULL},
    ).all()
    if not rows:
        return [], 0

    total = int(rows[0].total_count)
    ids = [r.id for r in rows]
    highlight_by_id: dict[uuid.UUID, str] = {r.id: r.title_highlight for r in rows}

    # Fetch the full geo objects + relationships in one round-trip,
    # keyed off the FTS-ranked id list. We have to re-sort in Python
    # because ``IN (...)`` doesn't preserve order — that's the cost of
    # the two-step "rank then hydrate" pattern this file uses
    # consistently with ``GET /geolocations``.
    geos = (
        db.query(
            Geolocation,
            func.ST_Y(Geolocation.location).label("lat"),
            func.ST_X(Geolocation.location).label("lng"),
        )
        .options(
            joinedload(Geolocation.author),
            joinedload(Geolocation.tags),
        )
        .filter(Geolocation.id.in_(ids))
        .all()
    )
    geo_by_id = {g.Geolocation.id: g for g in geos}

    out: list[dict] = []
    for hit_id in ids:
        row = geo_by_id.get(hit_id)
        if row is None:  # soft-deleted between SELECTs — drop silently
            continue
        geo = row.Geolocation
        out.append(
            {
                "id": geo.id,
                "title": geo.title,
                "title_highlight": highlight_by_id[hit_id],
                "lat": row.lat,
                "lng": row.lng,
                "event_date": geo.event_date,
                "is_demo": geo.is_demo,
                "author": geo.author,
                "tags": geo.tags,
            }
        )
    return out, total


def search_bounties(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N bounties matching ``query`` + the pre-LIMIT total.

    Same two-step rank-then-hydrate as geolocations; same soft-delete
    filter; same ``COUNT(*) OVER ()`` window for the true total. Carries
    ``claimer_count`` so the search-result card can render the same
    "N working" badge as the index.
    """
    sql = text(
        f"""
        SELECT id,
               ts_rank({_BOUNTY_TSVECTOR}, plainto_tsquery('simple', :q)) AS rank,
               ts_headline(
                   'simple', {_strip_sentinels("title")},
                   plainto_tsquery('simple', :q),
                   :opts
               ) AS title_highlight,
               COUNT(*) OVER () AS total_count
        FROM bounties
        WHERE deleted_at IS NULL
          AND {_BOUNTY_TSVECTOR} @@ plainto_tsquery('simple', :q)
        ORDER BY rank DESC, created_at DESC
        LIMIT :lim
        """
    )
    rows = db.execute(
        sql,
        {"q": query, "lim": limit, "opts": _HEADLINE_OPTS_FULL},
    ).all()
    if not rows:
        return [], 0

    total = int(rows[0].total_count)
    ids = [r.id for r in rows]
    highlight_by_id: dict[uuid.UUID, str] = {r.id: r.title_highlight for r in rows}

    bounties = (
        db.query(Bounty)
        .options(
            joinedload(Bounty.author),
            joinedload(Bounty.media),
            joinedload(Bounty.tags),
        )
        .filter(Bounty.id.in_(ids))
        .all()
    )
    bounty_by_id = {b.id: b for b in bounties}

    # One grouped count for the result set — same shape as the
    # ``BountyList`` aggregate so the card renders the same badge.
    counts: dict[uuid.UUID, int] = {
        bid: int(c)
        for bid, c in db.query(BountyClaim.bounty_id, func.count("*"))
        .filter(BountyClaim.bounty_id.in_(ids))
        .group_by(BountyClaim.bounty_id)
        .all()
    }

    out: list[dict] = []
    for hit_id in ids:
        b = bounty_by_id.get(hit_id)
        if b is None:
            continue
        out.append(
            {
                "id": b.id,
                "title": b.title,
                "title_highlight": highlight_by_id[hit_id],
                "source_url": b.source_url,
                "status": b.status,
                "created_at": b.created_at,
                "is_demo": b.is_demo,
                "author": b.author,
                "media": b.media,
                "tags": b.tags,
                "claimer_count": counts.get(b.id, 0),
            }
        )
    return out, total


def search_users(db: Session, *, query: str, limit: int) -> tuple[list[dict], int]:
    """Top-N analyst handles matching ``query`` + the pre-LIMIT total.

    ``username_highlight`` always present (the username is always in
    the index); ``bio_highlight`` only when the bio field carries text
    AND contributed to the match — keeps the snippet block off the UI
    when there's nothing meaningful to surface. Two separate ``:opts_*``
    bound parameters because the username field gets the full-highlight
    options (it's short) while bio gets fragment-mode (it's prose).
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
        # Only surface ``bio_highlight`` when the bio field actually
        # contains a match marker — ts_headline returns the original
        # text untouched on a no-match field, which would clutter the
        # card with a snippet that isn't really highlighting anything.
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
) -> dict[str, dict]:
    """Run grouped FTS across the requested entity types.

    ``types`` is a set drawn from ``{"geolocation", "bounty", "user"}``;
    the router maps the public ``type=all`` shorthand to all three
    before calling. An empty / whitespace-only query short-circuits to
    an empty result — keeps the index visit cost off "type but didn't
    submit" hits.

    Returns ``{group: {"hits": [...], "total": int}}`` for every group —
    ``hits`` is capped at ``limit``, ``total`` is the pre-LIMIT count
    of matches so the UI can show "3 of 142". Unrequested groups get
    empty hits and total=0; the JSON shape stays stable so the
    frontend doesn't need conditional access.
    """
    result: dict[str, dict] = {
        "geolocations": {"hits": [], "total": 0},
        "bounties": {"hits": [], "total": 0},
        "users": {"hits": [], "total": 0},
    }
    if not query.strip():
        return result

    if "geolocation" in types:
        hits, total = search_geolocations(db, query=query, limit=limit)
        result["geolocations"] = {"hits": hits, "total": total}
    if "bounty" in types:
        hits, total = search_bounties(db, query=query, limit=limit)
        result["bounties"] = {"hits": hits, "total": total}
    if "user" in types:
        hits, total = search_users(db, query=query, limit=limit)
        result["users"] = {"hits": hits, "total": total}
    return result


# Public set of allowed type parameter values. Re-exported by the
# router for the 422 validation message — keeps the spec in one place.
ALLOWED_TYPES = {"all", "geolocation", "bounty", "user"}


def types_from_param(param: str) -> set[str]:
    """Translate the ``type`` query parameter into the internal set.

    ``"all"`` expands to the union; anything else is the singleton set
    with that one value. The router validates ``param in ALLOWED_TYPES``
    before calling here so this function trusts its input.
    """
    if param == "all":
        return {"geolocation", "bounty", "user"}
    return {param}
