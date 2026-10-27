import uuid

from sqlalchemy import Subquery, func, select, union_all
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.source import Source, source_tags
from app.models.tag import Tag, event_tags
from app.services.event_filters import visible_events
from app.services.pagination import REFERENTIAL_MAX_ROWS

SUGGESTED_TAGS_LIMIT = 16


def _live_uses() -> Subquery:
    """One row per use of a tag on a live event or on a source of one, with the event's owner."""
    on_event = (
        select(event_tags.c.tag_id, Event.owner_id)
        .join(Event, Event.id == event_tags.c.event_id)
        .where(*visible_events())
    )
    on_source = (
        select(source_tags.c.tag_id, Event.owner_id)
        .join(Source, Source.id == source_tags.c.source_id)
        .join(Event, Event.id == Source.event_id)
        .where(*visible_events())
    )
    return union_all(on_event, on_source).subquery()


def live_tags(db: Session) -> list[Tag]:
    """The tags on at least one live event or one of its sources, by name, up to
    ``REFERENTIAL_MAX_ROWS``."""
    uses = _live_uses()
    return (
        db.query(Tag)
        .filter(Tag.id.in_(select(uses.c.tag_id)))
        .order_by(Tag.name)
        .limit(REFERENTIAL_MAX_ROWS)
        .all()
    )


def _most_used(db: Session, uses: Subquery, limit: int, owner_id: uuid.UUID | None) -> list[Tag]:
    query = db.query(Tag).join(uses, uses.c.tag_id == Tag.id)
    if owner_id is not None:
        query = query.filter(uses.c.owner_id == owner_id)
    return query.group_by(Tag.id).order_by(func.count().desc(), Tag.name).limit(limit).all()


def suggested_tags(db: Session, user_id: uuid.UUID) -> list[Tag]:
    """The tags to offer in one click: the user's most used, then the platform's.

    A use is a live event the user owns, or a source of one, that carries the tag. The
    platform's most used live tags fill the list up to :data:`SUGGESTED_TAGS_LIMIT`, so a
    newcomer still sees the vocabulary. Every suggestion is a live tag (``GET /tags``).
    """
    uses = _live_uses()
    own = _most_used(db, uses, SUGGESTED_TAGS_LIMIT, user_id)
    taken = {tag.id for tag in own}
    platform = _most_used(db, uses, SUGGESTED_TAGS_LIMIT + len(own), None)
    fill = [tag for tag in platform if tag.id not in taken]
    return own + fill[: SUGGESTED_TAGS_LIMIT - len(own)]
