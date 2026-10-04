"""The card-thumbnail pick, in one home.

Each event card shows the first ``source`` media, else the first ``proof``
image (archive-imported and bot-created detections often carry only a proof
image). A proof video is never picked.

Both halves live here so a surface cannot load one set of rows and pick from
another: :func:`thumbnail_media_criteria` is the eager-load predicate,
:func:`pick_thumbnail` the pick. The frontend never re-picks.
"""

from collections.abc import Iterable

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.media import Media


def thumbnail_media_criteria() -> ColumnElement[bool]:
    """Load predicate matching every row :func:`pick_thumbnail` may pick.

    For ``selectinload / joinedload(Event.media.and_(...))``, so list payloads
    never hydrate proof rows they will not show.
    """
    return or_(
        Media.role == "source",
        and_(Media.role == "proof", Media.media_type == "image"),
    )


def pick_thumbnail(rows: Iterable[Media]) -> Media | None:
    """First ``source`` row, else first ``proof`` image, else None."""
    proof_image: Media | None = None
    for m in rows:
        if m.role == "source":
            return m
        if proof_image is None and m.role == "proof" and m.media_type == "image":
            proof_image = m
    return proof_image
