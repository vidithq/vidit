"""The page cap, the cursors and the ``Link: rel="next"`` header of the list endpoints
(``docs/api.md#pagination``).

A keyset list service over-fetches one row past the page size; the router hands the window to
:func:`paged`, which cuts the page and sends the ``Link`` exactly when the extra row exists, so a
next page is never empty.
"""

from __future__ import annotations

import base64
import binascii
import math
import uuid
from collections.abc import Callable, Sequence
from datetime import date, datetime, time
from typing import Any

import orjson
from fastapi import HTTPException, Request, Response
from sqlalchemy import tuple_
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

MAX_PAGE_SIZE = 100

# Ceiling for the referential lists (`GET /tags`, `GET /conflicts`): pickers
# hydrate them whole (conflicts alone is ~800 rows), so MAX_PAGE_SIZE would
# cut their options.
REFERENTIAL_MAX_ROWS = 2000


def page_size(requested: int) -> int:
    return min(requested, MAX_PAGE_SIZE)


def _encode(payload: Any) -> str:
    return base64.urlsafe_b64encode(orjson.dumps(payload)).decode("ascii").rstrip("=")


def _decode(cursor: str) -> Any:
    padded = cursor + "=" * (-len(cursor) % 4)
    return orjson.loads(base64.urlsafe_b64decode(padded))


def _malformed_cursor() -> HTTPException:
    return HTTPException(status_code=422, detail="cursor is malformed")


def _decode_parts(cursor: str | None, parsers: tuple[Callable[[str], Any], ...]) -> Any:
    """``None`` for no cursor, else one value per parser, or the 422. The shape is checked before
    a parser runs, so ``["2026-01-01T00:00:00", 5]`` never raises out of ``uuid.UUID``."""
    if cursor is None:
        return None
    try:
        decoded = _decode(cursor)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise _malformed_cursor() from exc
    if not (
        isinstance(decoded, list)
        and len(decoded) == len(parsers)
        and all(isinstance(part, str) for part in decoded)
    ):
        raise _malformed_cursor()
    try:
        return tuple(parse(part) for parse, part in zip(parsers, decoded, strict=True))
    except ValueError as exc:
        raise _malformed_cursor() from exc


def _finite_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError(raw)
    return value


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    return _encode([created_at.isoformat(), str(row_id)])


def decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    return _decode_parts(cursor, (datetime.fromisoformat, uuid.UUID))


def encode_ordinal_cursor(value: int) -> str:
    """``version_no`` is unique per event and taken under the event's row lock, so it orders the
    history without ``created_at``, an app-set clock that skews between instances."""
    return _encode(value)


def decode_ordinal_cursor(cursor: str | None) -> int | None:
    if cursor is None:
        return None
    try:
        decoded = _decode(cursor)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise _malformed_cursor() from exc
    # ``True`` is an ``int`` and would page from 1.
    if isinstance(decoded, bool) or not isinstance(decoded, int):
        raise _malformed_cursor()
    return decoded


def encode_chronological_cursor(
    occurred_date: date, occurred_time: time, created_at: datetime, row_id: uuid.UUID
) -> str:
    """The caller passes the exact sort values, the stand-ins for a missing date or hour included
    (``services/collections.chronological_key``), so the next page compares the values that cut
    this one."""
    return _encode(
        [occurred_date.isoformat(), occurred_time.isoformat(), created_at.isoformat(), str(row_id)]
    )


def decode_chronological_cursor(
    cursor: str | None,
) -> tuple[date, time, datetime, uuid.UUID] | None:
    return _decode_parts(
        cursor, (date.fromisoformat, time.fromisoformat, datetime.fromisoformat, uuid.UUID)
    )


def encode_ranked_cursor(rank: float, created_at: datetime, row_id: uuid.UUID) -> str:
    """``rank`` travels as the shortest ``repr`` of the double, which parses back to the same
    value, so the next page's row comparison ties on it exactly."""
    return _encode([repr(rank), created_at.isoformat(), str(row_id)])


def decode_ranked_cursor(cursor: str | None) -> tuple[float, datetime, uuid.UUID] | None:
    return _decode_parts(cursor, (_finite_float, datetime.fromisoformat, uuid.UUID))


def keyset_after(
    columns: Sequence[ColumnElement[Any] | InstrumentedAttribute[Any]], cursor: tuple[Any, ...]
) -> ColumnElement[bool]:
    """The rows after ``cursor`` under an ascending ORDER BY on ``columns``.

    Every column must be non-NULL, since a row comparison against NULL is unknown: a nullable
    sort column arrives wrapped in its stand-in (``services/collections.chronological_key``).
    """
    return tuple_(*columns) > cursor


def keyset_before(
    created_at_col: InstrumentedAttribute[datetime] | ColumnElement[datetime],
    id_col: InstrumentedAttribute[uuid.UUID],
    cursor: tuple[datetime, uuid.UUID],
) -> ColumnElement[bool]:
    """The rows after ``cursor`` under ``created_at DESC, id DESC``.

    A row comparison lets Postgres use a composite index on the pair. The feed passes its
    computed timestamp in place of ``created_at``, which must be non-NULL, as in
    :func:`keyset_after`.
    """
    return tuple_(created_at_col, id_col) < cursor


def paged[T](
    request: Request, response: Response, window: list[T], size: int, cursor_of: Callable[[T], str]
) -> list[T]:
    """The page of an over-fetched ``size + 1`` window. When the window holds the extra row,
    ``response`` carries the :func:`next_link` to the cursor of the page's last row."""
    page = window[:size]
    if len(window) > size:
        response.headers["Link"] = next_link(request, cursor_of(page[-1]))
    return page


def next_link(request: Request, cursor: str) -> str:
    """Keeps every caller filter, replaces ``cursor`` and drops the offset ``page``: the two walks
    must not share a URL. Mirrored by ``lib/pagination.ts``."""
    url = request.url.remove_query_params("page").include_query_params(cursor=cursor)
    return f'<{url}>; rel="next"'
