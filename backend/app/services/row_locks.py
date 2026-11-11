from sqlalchemy import ColumnElement
from sqlalchemy.orm import Query, Session


def lock_row[T](db: Session, model: type[T], *criteria: ColumnElement[bool]) -> Query[T]:
    """``model``'s row matching ``criteria``, re-read under ``SELECT ... FOR UPDATE``; end it with
    ``.one()`` or ``.first()``.

    ``populate_existing()`` is load-bearing: without it the locked SELECT returns the stale
    identity-mapped object when the caller already loaded the row.
    """
    return db.query(model).filter(*criteria).populate_existing().with_for_update()
