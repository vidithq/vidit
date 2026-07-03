"""Filter primitives shared by the two read views over the one ``Event`` table.

The located view (``routers/events``) and the requested view (``routers/bounties``)
both accept ``?author=`` and match it the same way. Single-sourcing the
anti-injection pattern and the author-filter leg here keeps the two views from
drifting on that security boundary. View-specific legs (the located view's
multi-tag / date / bbox filters, the requested view's single-tag / status
scoping) stay in their own routers: they are genuinely different, not duplicated.
"""

from sqlalchemy.orm import Query as SAQuery

from app.models.event import Event
from app.models.user import User

# Reject LIKE-injection at the input boundary: the value flows into
# ``User.username.ilike(f"%{author}%")`` below. Restricting to the characters a
# real username carries kills ``%`` / ``\`` vectors before the SQL builder. Used
# as a ``Query(pattern=...)`` guard at every list endpoint that accepts ``?author=``.
AUTHOR_FILTER_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"


def apply_author_filter(query: SAQuery, author: str) -> SAQuery:
    """Join the author and case-insensitively match a username substring.

    Callers gate ``author`` through :data:`AUTHOR_FILTER_PATTERN` (a
    ``Query(pattern=...)``), so the ``ilike`` argument is already injection-safe
    by the time it reaches here.
    """
    return query.join(Event.author).filter(User.username.ilike(f"%{author}%"))
