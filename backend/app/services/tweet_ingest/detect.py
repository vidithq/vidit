"""Machine detection: a thread becomes 0..N ``DetectedGeoloc`` DTOs.

A thin mapper over the shared ``resolve_thread`` core: it fans one
``ResolvedTweet`` out into one DTO per coordinate. Nothing is derived here; the
same resolution feeds the human ``parse`` path.

The DTO is plain data, never an ORM row; the assemble step turns each into an
``Event`` row and owns persistence, evidence, and the
``(detected_from_url, coordinate)`` idempotency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from .extract import ParsedCoord
from .records import TweetRecord
from .resolve import resolve_thread
from .syndication import ParsedMedia


@dataclass(frozen=True)
class DetectedGeoloc:
    coordinate: ParsedCoord
    title: str
    # Plain-text proof body (coords / shortlinks / list markers stripped). The
    # caller wraps it into the model's JSONB proof document.
    proof_text: str
    # The footage source URL, resolved (the quoted tweet, an off-platform link,
    # or the geoloc tweet itself), distinct from ``detected_from_url``.
    source_url: str
    # The post this detection was imported from (the geoloc tweet), the
    # idempotency anchor and the provenance link.
    detected_from_url: str
    # Author handle (normalized). The assemble caller attributes the row to the
    # backfiller it was given, not to this field.
    owner_handle: str
    # Provisional event date = the geoloc tweet's post date; the owner corrects
    # it at submit (the true event usually predates the post).
    event_date: date
    # The resolved source's post instant (UTC) → the NOT-NULL ``source_posted_at``.
    source_posted_at: datetime
    # When the analyst posted THIS geolocation (the geoloc tweet) → the nullable
    # ``detected_post_at``.
    detected_post_at: datetime | None
    # Footage (role=source, capped at one) vs the analyst's annotation (role=proof).
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)


def detect(thread: list[TweetRecord]) -> list[DetectedGeoloc]:
    """One ``DetectedGeoloc`` per coordinate ``resolve_thread`` finds across the
    thread. ``[]`` when the thread is empty or carries no parseable coordinate."""
    resolved = resolve_thread(thread)
    if resolved is None or not resolved.coords:
        return []
    return [
        DetectedGeoloc(
            coordinate=coord,
            title=resolved.title,
            proof_text=resolved.proof_text,
            source_url=resolved.source_url,
            detected_from_url=resolved.detected_from_url,
            owner_handle=resolved.owner_handle,
            event_date=resolved.event_date,
            source_posted_at=resolved.source_posted_at,
            detected_post_at=resolved.detected_post_at,
            source_media=resolved.source_media,
            proof_media=resolved.proof_media,
        )
        for coord in resolved.coords
    ]
