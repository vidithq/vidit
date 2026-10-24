"""The card-thumbnail pick, in one home.

Each event card shows the file of its first source that has one (in source order), else the
first proof image (archive-imported and bot-created detections often carry only a proof
image).

Both halves live here so a surface cannot load one set of rows and pick from another:
:func:`thumbnail_loads` is the eager-load option set, :func:`pick_thumbnail` the pick. The
frontend never re-picks.
"""

from sqlalchemy import or_
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.strategy_options import _AbstractLoad
from sqlalchemy.sql.elements import ColumnElement

from app.models.event import Event
from app.models.media import Media
from app.models.source import Source


def thumbnail_loads() -> tuple[_AbstractLoad, ...]:
    """Load options matching every row :func:`pick_thumbnail` may pick, so list payloads never
    hydrate proof rows they will not show. ``selectinload``, never ``subqueryload``: with
    ``.and_()`` criteria subqueryload loses the outer correlation on a compiled-cache hit."""
    return (
        selectinload(Event.sources).selectinload(Source.media),
        selectinload(Event.media.and_(Media.kind == "image")),
    )


def has_thumbnail() -> ColumnElement[bool]:
    """Correlated EXISTS: the event carries a file a card may show."""
    return or_(
        Event.sources.any(Source.media.has()),
        Event.media.any(Media.kind == "image"),
    )


def thumbnail_candidates(geo: Event) -> list[Media]:
    """The files a card may show, best first: sources' files in source order, then proof
    images."""
    files = [source.media for source in geo.sources if source.media is not None]
    return files + [m for m in geo.media if m.kind == "image"]


def pick_thumbnail(geo: Event) -> Media | None:
    """First source file, else first proof image, else None."""
    candidates = thumbnail_candidates(geo)
    return candidates[0] if candidates else None
