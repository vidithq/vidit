"""The ``?author=`` filter primitive shared by the event list endpoints.

Both read views over the one ``Event`` table accept ``?author=`` (reader
vocabulary; it matches the event's *owner*) the same way. Single-sourcing the
anti-injection pattern and the filter leg here keeps the endpoints from
drifting on that security boundary.
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
    """Join the owner and case-insensitively match a username substring.

    Callers gate ``author`` through :data:`AUTHOR_FILTER_PATTERN` (a
    ``Query(pattern=...)``), so the ``ilike`` argument is already injection-safe
    by the time it reaches here.
    """
    return query.join(Event.owner).filter(User.username.ilike(f"%{author}%"))
