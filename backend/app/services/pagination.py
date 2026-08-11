"""Shared pagination vocabulary for the list endpoints.

One row cap, one cursor format, one ``Link: rel="next"`` builder, so a list
endpoint cannot invent a second pagination dialect. Routers own the query,
this module owns how a page is bounded and how the caller reaches the next
one.

Two rules hold across every list endpoint:

* **The cap is the server's.** A caller asking for more than
  :data:`MAX_PAGE_SIZE` rows gets :data:`MAX_PAGE_SIZE`, never an error:
  over-asking is not malformed, it just doesn't buy anything.
* **Malformed is a 422.** A page size below 1, a page below 1, a cursor that
  is not one this server minted: all rejected before they reach the query,
  where a negative ``OFFSET`` or a non-positive ``LIMIT`` would be a 500 from
  Postgres.

The cursor is keyset, not offset: ``(created_at, id)`` under
``ORDER BY created_at DESC, id DESC``. ``id`` is the tiebreaker that makes the
ordering total, so rows inserted while a caller walks pages can neither
duplicate a row onto the next page nor skip one, the way an ``OFFSET`` walk
does. It is opaque on purpose (base64 of a compact JSON pair): its shape is
this module's business, not a contract callers build values for.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime
from typing import Any

import orjson
from fastapi import HTTPException, Request
from sqlalchemy import tuple_
from sqlalchemy.orm import InstrumentedAttribute

# The hard ceiling on rows in one list response, whatever the caller asks for.
# Reading the catalog past it costs a cursor walk (one round-trip per 100 rows)
# instead of one wide GET.
MAX_PAGE_SIZE = 100

# The ceiling for the two referential lists (`GET /tags`, `GET /conflicts`).
# They are server-managed vocabularies their pickers hydrate whole (the
# conflicts referential alone is ~800 rows), so the row cap that fits a
# catalog list would cut the picker's options instead of bounding a scrape.
# Set above the referentials' own growth so the response stays bounded without
# the product noticing.
REFERENTIAL_MAX_ROWS = 2000


def page_size(requested: int) -> int:
    """Clamp a caller-supplied page size to :data:`MAX_PAGE_SIZE`.

    The lower bound is the endpoint's ``Query(..., ge=1)``, so anything
    reaching here is already a positive integer.
    """
    return min(requested, MAX_PAGE_SIZE)


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    """Opaque cursor naming the last row of the page just served."""
    raw = orjson.dumps([created_at.isoformat(), str(row_id)])
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Parse a cursor back into its ``(created_at, id)`` pair.

    Anything this server did not mint is a 422: the alternative is feeding a
    half-parsed value into the keyset predicate and answering 500.
    """
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        decoded = orjson.loads(base64.urlsafe_b64decode(padded))
        created_raw, id_raw = decoded
        return datetime.fromisoformat(created_raw), uuid.UUID(id_raw)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="cursor is malformed") from exc


def keyset_before(
    created_at_col: InstrumentedAttribute[datetime],
    id_col: InstrumentedAttribute[uuid.UUID],
    cursor: tuple[datetime, uuid.UUID],
) -> Any:
    """Predicate for the rows after ``cursor`` under ``created_at DESC, id DESC``.

    A row comparison, not ``created_at < :ts OR (created_at = :ts AND id < :id)``:
    Postgres evaluates ``(a, b) < (:x, :y)`` against a composite index directly.
    """
    return tuple_(created_at_col, id_col) < cursor


def take_page[T](rows: list[T], size: int) -> tuple[list[T], bool]:
    """Split an over-fetched ``size + 1`` window into ``(page, has_next)``.

    Fetching one row past the page is how the ``Link`` header stays honest:
    the next page is known to hold at least one row, so a caller following the
    cursor never lands on an empty page.
    """
    return rows[:size], len(rows) > size


def next_link(request: Request, created_at: datetime, row_id: uuid.UUID) -> str:
    """``Link`` header value pointing at the next page of this exact query.

    Carries every filter the caller sent, with ``cursor`` replaced and the
    offset ``page`` dropped: the two ways of walking a list must not travel
    together in one URL.
    """
    url = request.url.remove_query_params("page").include_query_params(
        cursor=encode_cursor(created_at, row_id)
    )
    return f'<{url}>; rel="next"'
