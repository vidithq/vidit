"""Machine detection — a thread becomes 0..N ``DetectedGeoloc`` DTOs.

Sibling of the human ``parse`` path: both run ``extract`` over the same text.
``detect`` emits one DTO per coordinate found across the thread; a thread with
no parseable coordinate yields an empty list (a parseable coord ⇒ a geo tweet,
so ``is_geoloc`` is just whether the list is non-empty, not a separate pass).

The DTO is plain data, never an ORM row — the caller (the assemble step) turns
each one into a ``Geolocation`` row, owns persistence, evidence, and the
``(detected_from_url, coordinate)`` idempotency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from .extract import ParsedCoord, clean_proof_text, derive_title, extract_coords
from .records import TweetRecord
from .syndication import ParsedMedia


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
    # Author handle (normalized) — the detection is owned by this handle's user.
    owner_handle: str
    # Provisional event date = the head tweet's post date; the owner corrects it
    # at validation. ``event_date`` is NOT NULL on the model, so a detection
    # always carries one.
    event_date: date
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
    event_date = _event_date(head.created_at)

    return [
        DetectedGeoloc(
            coordinate=coord,
            title=title,
            proof_text=proof_text,
            detected_from_url=head.permalink,
            owner_handle=head.handle,
            event_date=event_date,
            media=media,
        )
        for coord in coords
    ]


def _event_date(created_at: str) -> date:
    """Date from the head tweet's ISO 8601 timestamp.

    Acquire adapters normalize ``created_at`` to ISO 8601, which always carries
    a leading ``YYYY-MM-DD``; the slice keeps this robust against a trailing
    ``Z`` that older Python rejects. A malformed value falls back to the epoch
    date — a visibly-wrong sentinel the owner fixes at validation, never a
    silent "today".
    """
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(created_at.replace("Z", "+00:00")).date()
        except ValueError:
            return date(1970, 1, 1)
