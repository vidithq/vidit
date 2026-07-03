"""Machine detection — a thread becomes 0..N ``DetectedGeoloc`` DTOs.

Sibling of the human ``parse`` path: both run ``extract`` over the same text.
``detect`` emits one DTO per coordinate found across the thread; a thread with
no parseable coordinate yields an empty list (a parseable coord ⇒ a geo tweet,
so ``is_geoloc`` is just whether the list is non-empty, not a separate pass).

The DTO is plain data, never an ORM row — the caller (the assemble step) turns
each one into a ``Event`` row, owns persistence, evidence, and the
``(detected_from_url, coordinate)`` idempotency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from .extract import ParsedCoord, clean_proof_text, derive_title, extract_coords
from .records import TweetRecord
from .syndication import ParsedMedia

# Stand-in for an unparseable head-tweet timestamp on the NOT-NULL
# ``source_posted_at``: a visibly-wrong instant the owner corrects at submit,
# never a silent "now". ``detected_post_at`` (nullable) takes NULL instead, and
# ``event_date`` recovers the date prefix when only the time-of-day is malformed.
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class DetectedGeoloc:
    coordinate: ParsedCoord
    title: str
    # Plain-text proof body (coords / shortlinks / list markers stripped). The
    # caller wraps it into the model's JSONB proof document.
    proof_text: str
    # The post this detection was imported from — the idempotency anchor and
    # the provenance link, distinct from ``source_url`` (the footage origin).
    detected_from_url: str
    # Author handle (normalized), informational — the tweet's own handle. The
    # assemble caller attributes the row to the backfiller it was given, not to
    # this field (they're the same when an owner imports their own archive).
    owner_handle: str
    # Provisional event date = the head tweet's post date; the owner corrects it
    # at submit. NOT NULL on the model, so a detection always carries one: if the
    # timestamp's time-of-day is malformed the date prefix is still recovered,
    # and only a fully unparseable value falls back to the epoch date.
    event_date: date
    # The head tweet's post instant (UTC), mapped to the NOT-NULL
    # ``source_posted_at`` (the tweet is the source on the machine path). The
    # epoch sentinel when the timestamp is unparseable.
    posted_at: datetime
    # The same instant, mapped to the nullable ``detected_post_at`` (when the
    # analyst posted the geolocation, the precedence signal). NULL, not the
    # sentinel, when the timestamp is unparseable: a false 1970 in an immutable
    # field is worse than "unknown".
    detected_post_at: datetime | None
    media: list[ParsedMedia] = field(default_factory=list)


def detect(thread: list[TweetRecord]) -> list[DetectedGeoloc]:
    """Emit one ``DetectedGeoloc`` per coordinate found across ``thread``.

    The thread is taken head-first (``stitch`` already ordered it). Text from
    every tweet is concatenated before extraction so a coordinate in a reply
    pairs with media in the head. Returns ``[]`` when no coordinate parses.
    """
    if not thread:
        return []
    head = thread[0]
    full_text = "\n".join(r.text for r in thread if r.text)
    coords = extract_coords(full_text)
    if not coords:
        return []

    title = derive_title(full_text)
    proof_text = clean_proof_text(full_text)
    media = [m for r in thread for m in r.media]
    posted_at = _posted_at(head.created_at)
    event_date = _event_date(head.created_at, posted_at)

    return [
        DetectedGeoloc(
            coordinate=coord,
            title=title,
            proof_text=proof_text,
            detected_from_url=head.permalink,
            owner_handle=head.handle,
            event_date=event_date,
            posted_at=posted_at or _EPOCH,
            detected_post_at=posted_at,
            media=media,
        )
        for coord in coords
    ]


def _posted_at(created_at: str) -> datetime | None:
    """Aware UTC datetime from the head tweet's ISO 8601 timestamp, or None when
    it doesn't parse.

    Acquire adapters normalize ``created_at`` to ISO 8601. The caller maps None
    onto the ``source_posted_at`` epoch sentinel and a NULL ``detected_post_at``,
    and recovers ``event_date`` from the date prefix.
    """
    try:
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _event_date(created_at: str, posted_at: datetime | None) -> date:
    """The detection's ``event_date``: the post instant's UTC date.

    When the full timestamp parsed, its date. When only the time-of-day is
    malformed but the ``YYYY-MM-DD`` prefix is valid, recover the date so a
    garbled time doesn't discard it too. A fully unparseable value falls back to
    the epoch date, the same visibly-wrong sentinel the owner fixes at submit.
    """
    if posted_at is not None:
        return posted_at.date()
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        return _EPOCH.date()
