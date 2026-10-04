"""Shared pagination vocabulary for the list endpoints.

One row cap, one cursor format, one ``Link: rel="next"`` builder. Routers own
the query; this module bounds a page and links to the next one.

* **The cap is the server's.** Asking for more than :data:`MAX_PAGE_SIZE`
  rows gets :data:`MAX_PAGE_SIZE`, never an error.
* **Malformed is a 422.** A page size or page below 1, or an undecodable
  cursor, is rejected before the query (a negative ``OFFSET`` would be a 500
  from Postgres). A cursor that decodes cleanly is honoured whether or not
  this server minted it; see :func:`decode_cursor`.

The cursor is keyset, not offset, so rows inserted mid-walk neither duplicate
nor skip. Most lists page on ``(created_at, id)`` under
``ORDER BY created_at DESC, id DESC`` (``id`` makes the order total). A list
with a unique ordinal pages on that (:func:`encode_ordinal_cursor`, a version
history on ``version_no``). A collection's items page on
``event_date, event_time, created_at, id`` ascending
(:func:`encode_chronological_cursor`). Cursors are opaque (base64 of compact
JSON); callers do not build them.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from collections.abc import Sequence
from datetime import date, datetime, time
from typing import Any

import orjson
from fastapi import HTTPException, Request
from sqlalchemy import tuple_
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

# Hard ceiling on rows in one list response.
MAX_PAGE_SIZE = 100

# Ceiling for the referential lists (`GET /tags`, `GET /conflicts`): pickers
# hydrate them whole (conflicts alone is ~800 rows), so MAX_PAGE_SIZE would
# cut their options.
REFERENTIAL_MAX_ROWS = 2000


def page_size(requested: int) -> int:
    """Clamp a page size to :data:`MAX_PAGE_SIZE` (the endpoint's ``ge=1`` is the lower bound)."""
    return min(requested, MAX_PAGE_SIZE)


def _encode(payload: Any) -> str:
    """Base64 of the compact JSON payload, unpadded: the cursor wire form."""
    return base64.urlsafe_b64encode(orjson.dumps(payload)).decode("ascii").rstrip("=")


def _decode(cursor: str) -> Any:
    """Undo :func:`_encode`. Raises on anything that is not a cursor."""
    padded = cursor + "=" * (-len(cursor) % 4)
    return orjson.loads(base64.urlsafe_b64decode(padded))


def _malformed_cursor() -> HTTPException:
    """The one 422 for any unreadable cursor (the fix is always to restart the list)."""
    return HTTPException(status_code=422, detail="cursor is malformed")


def _decode_parts(cursor: str, count: int) -> list[str]:
    """Decode a cursor into exactly ``count`` strings, or raise the 422.

    The shape is checked before callers convert a part, so
    ``["2026-01-01T00:00:00", 5]`` is rejected here rather than raising out of
    ``uuid.UUID``.
    """
    try:
        decoded = _decode(cursor)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise _malformed_cursor() from exc
    if not (
        isinstance(decoded, list)
        and len(decoded) == count
        and all(isinstance(part, str) for part in decoded)
    ):
        raise _malformed_cursor()
    return decoded


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    """Opaque cursor naming the last row of the page just served."""
    return _encode([created_at.isoformat(), str(row_id)])


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Parse a cursor back into its ``(created_at, id)`` pair, 422 if malformed.

    Well-formed is the whole test: a hand-built pair gets the same rows a
    minted cursor at that position would. The encoding carries no
    authorisation and every filter still applies.
    """
    created_raw, id_raw = _decode_parts(cursor, 2)
    try:
        return datetime.fromisoformat(created_raw), uuid.UUID(id_raw)
    except ValueError as exc:
        raise _malformed_cursor() from exc


def encode_ordinal_cursor(value: int) -> str:
    """Opaque cursor for a list ordered on a unique integer.

    ``version_no`` is unique per event and taken under the event's row lock,
    so it orders the history without ``created_at`` (an app-set clock that
    skews between instances).
    """
    return _encode(value)


def decode_ordinal_cursor(cursor: str) -> int:
    """Parse an ordinal cursor back into its integer, 422 on anything else.

    Booleans are rejected: ``True`` is an ``int`` and would page from 1.
    """
    try:
        decoded = _decode(cursor)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise _malformed_cursor() from exc
    if isinstance(decoded, bool) or not isinstance(decoded, int):
        raise _malformed_cursor()
    return decoded


def encode_chronological_cursor(
    event_date: date, event_time: time, created_at: datetime, row_id: uuid.UUID
) -> str:
    """Opaque cursor for a list ordered by ``event_date, event_time, created_at, id``.

    The caller passes the exact sort values, stand-ins for a missing date or
    hour included (``services/collections.chronological_key``), so the next
    page's predicate compares the values that cut this one.
    """
    return _encode(
        [event_date.isoformat(), event_time.isoformat(), created_at.isoformat(), str(row_id)]
    )


def decode_chronological_cursor(cursor: str) -> tuple[date, time, datetime, uuid.UUID]:
    """Parse a chronological cursor into its four sort values, 422 on anything else."""
    date_raw, time_raw, created_raw, id_raw = _decode_parts(cursor, 4)
    try:
        return (
            date.fromisoformat(date_raw),
            time.fromisoformat(time_raw),
            datetime.fromisoformat(created_raw),
            uuid.UUID(id_raw),
        )
    except ValueError as exc:
        raise _malformed_cursor() from exc


def keyset_after(
    columns: Sequence[ColumnElement[Any]], cursor: tuple[Any, ...]
) -> ColumnElement[bool]:
    """Predicate for the rows after ``cursor`` under an ascending ORDER BY.

    The ascending twin of :func:`keyset_before`. Pass the very expressions the
    query orders by. Every column must be non-NULL (a row comparison against
    NULL is unknown), so a nullable sort column arrives wrapped in its
    stand-in (``services/collections.chronological_key``).
    """
    return tuple_(*columns) > cursor


def keyset_before(
    created_at_col: InstrumentedAttribute[datetime],
    id_col: InstrumentedAttribute[uuid.UUID],
    cursor: tuple[datetime, uuid.UUID],
) -> ColumnElement[bool]:
    """Predicate for the rows after ``cursor`` under ``created_at DESC, id DESC``.

    A row comparison lets Postgres use a composite index on the pair
    (``events`` has ``ix_events_created_at_id``; ``invite_codes`` has none and
    sorts the whole table, fine for an admin-only list).
    """
    return tuple_(created_at_col, id_col) < cursor


def take_page[T](rows: list[T], size: int) -> tuple[list[T], bool]:
    """Split an over-fetched ``size + 1`` window into ``(page, has_next)``.

    The extra row guarantees the next page is never empty.
    """
    return rows[:size], len(rows) > size


def next_link(request: Request, cursor: str) -> str:
    """``Link`` header value for the next page of this exact query.

    Keeps every caller filter, replaces ``cursor``, and drops offset ``page``
    (the two walks must not share a URL). Mirrored by ``lib/pagination.ts``.
    """
    url = request.url.remove_query_params("page").include_query_params(cursor=cursor)
    return f'<{url}>; rel="next"'
