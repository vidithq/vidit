"""The card-thumbnail pick, in one home.

Every card and preview surface (events list, profile events, timeline,
search hits, map pin hover, detections queue) shows one thumbnail per
event. The order: the first ``source`` media, else the first ``proof``
IMAGE. Many real events carry only a proof image (archive-imported
detections, bot-created drafts), and without the fallback those cards
render the "no media" box despite holding a perfectly showable image.
Proof images already render publicly on the event detail page, so the
fallback is presentation only. A proof VIDEO is never picked: the proof
document embeds images only, and the type check here keeps a stray video
row out regardless.

Both halves of the rule live here so a surface cannot load one set of
rows and pick from another: :func:`thumbnail_media_criteria` is the
eager-load predicate, :func:`pick_thumbnail` the pick over the loaded
rows. The frontend never re-picks; it renders what the payload carries.
"""

from collections.abc import Iterable

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.media import Media


def thumbnail_media_criteria() -> ColumnElement[bool]:
    """Load predicate matching every row :func:`pick_thumbnail` may pick.

    Used inside ``selectinload / joinedload(Event.media.and_(...))`` on the
    card surfaces, so a list payload never hydrates proof rows it will not
    show (a proof video, in particular, stays unloaded).
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
