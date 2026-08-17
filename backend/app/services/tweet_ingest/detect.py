"""Machine detection: a thread becomes 0..N ``DetectedGeoloc`` DTOs.

A thin mapper over the shared ``resolve_thread`` core: it fans one
``ResolvedTweet`` out into one DTO per coordinate, and names what the resolution
could not settle. Nothing is derived here; the same resolution feeds the human
``parse`` path.

The DTO is plain data, never an ORM row; the assemble step turns each into an
``Event`` row and owns persistence, evidence, and the
``(detected_from_url, coordinate)`` idempotency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from .extract import ParsedCoord
from .records import TweetRecord
from .resolve import ResolvedTweet, resolve_thread
from .syndication import ParsedMedia

# ── The engine's vocabulary ───────────────────────────────────────────────

# Why a thread produced nothing. The entry that cares names it back to the
# analyst (the bot's failure reply); the other entries ignore it.
# ``POST_UNREADABLE`` is raised by the acquisition rather than here: X served no
# body at all, so no thread ever reached the engine.
COORDS_MISSING = "coords_missing"
COORDS_INVALID = "coords_invalid"
POST_UNREADABLE = "post_unreadable"

# What a created draft still needs from its owner. Warnings, not refusals: the
# draft lands either way and review is where they are answered.
SOURCE_AMBIGUOUS = "source_ambiguous"  # several candidate links, source left empty
SOURCE_MISSING = "source_missing"  # no candidate link and no quote
SEVERAL_COORDINATES = "several_coordinates"  # one thread, several drafts


@dataclass(frozen=True)
class DetectedGeoloc:
    coordinate: ParsedCoord
    title: str
    # Plain-text proof body (the thread's text, media wrappers dropped). The
    # caller wraps it into the model's JSONB proof document.
    proof_text: str
    # The declared source (the quoted tweet or a linked post), distinct from
    # ``detected_from_url``. None when the thread neither quoted nor carried
    # exactly one candidate link: a ``detected`` draft may have no source.
    source_url: str | None
    # The post this detection was imported from (the geoloc tweet), the
    # idempotency anchor and the provenance link.
    detected_from_url: str
    # Author handle (normalized). The assemble caller attributes the row to the
    # backfiller it was given, not to this field.
    owner_handle: str
    # Provisional event date = the geoloc tweet's post date; the owner corrects
    # it at submit (the true event usually predates the post). None when the
    # tweet's timestamp is unusable.
    event_date: date | None
    # The source's post instant (UTC), only when actually known (a dated quote).
    source_posted_at: datetime | None
    # When the analyst posted THIS geolocation (the geoloc tweet) → the nullable
    # ``detected_post_at``.
    detected_post_at: datetime | None
    # Mirrors of the same media the post also linked, ordered, normalized and
    # capped by the resolution. Prefills the row's secondary source links, which
    # the owner edits at submit; empty when the post linked nothing else.
    secondary_source_urls: list[str] = field(default_factory=list)
    # Footage (role=source, capped at one) vs the analyst's annotation (role=proof).
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)
    # What this draft still needs from its owner (the ``*_MISSING`` /
    # ``*_AMBIGUOUS`` / ``SEVERAL_COORDINATES`` constants above). Every draft of
    # one thread carries the same list; the entry surfaces it its own way (the
    # bot's reply, the archive's outcome email).
    warnings: list[str] = field(default_factory=list)


def warnings_for(resolved: ResolvedTweet) -> list[str]:
    """What the resolution could not settle, in reply order.

    The source is empty in exactly two cases, and the mirrors tell them apart:
    several candidates all landed there (ambiguous), or there was no candidate
    and no quote at all (missing).
    """
    warnings: list[str] = []
    if len(resolved.coords) > 1:
        warnings.append(SEVERAL_COORDINATES)
    if resolved.source_url is None:
        warnings.append(SOURCE_AMBIGUOUS if resolved.secondary_source_urls else SOURCE_MISSING)
    return warnings


def detect(thread: list[TweetRecord]) -> list[DetectedGeoloc]:
    """One ``DetectedGeoloc`` per coordinate ``resolve_thread`` finds across the
    thread. ``[]`` when the thread is empty, holds only retweets, or carries no
    parseable coordinate."""
    detections, _reason = detect_diagnosed(thread)
    return detections


def detect_diagnosed(thread: list[TweetRecord]) -> tuple[list[DetectedGeoloc], str | None]:
    """:func:`detect`, plus the reason nothing landed when nothing did.

    Two reasons, which is all the engine can tell apart: a coordinate-shaped
    string sat outside the world (``COORDS_INVALID``), or the analyst's own text
    carried no coordinate at all (``COORDS_MISSING``). A thread that produced
    drafts carries no reason; what those drafts still need is on their
    ``warnings`` instead.
    """
    resolved = resolve_thread(thread)
    if resolved is None:
        return [], COORDS_MISSING
    if not resolved.coords:
        return [], COORDS_INVALID if resolved.coords_out_of_bounds else COORDS_MISSING
    warnings = warnings_for(resolved)
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
            secondary_source_urls=resolved.secondary_source_urls,
            source_media=resolved.source_media,
            proof_media=resolved.proof_media,
            warnings=warnings,
        )
        for coord in resolved.coords
    ], None
