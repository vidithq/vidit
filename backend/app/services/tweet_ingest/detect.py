"""Machine detection: a thread becomes 0..N ``DetectedGeoloc`` DTOs.

A thin mapper over the shared ``resolve_thread`` core: it fans one
``ResolvedTweet`` out into one DTO per coordinate. Nothing is derived here; the
same resolution feeds the human ``parse`` path.

The DTO is plain data, never an ORM row; the assemble step turns each into an
``Event`` row and owns persistence, evidence, and the
``(detected_from_url, coordinate)`` idempotency.
"""

from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass, field
from datetime import date, datetime

import httpx

from .extract import ParsedCoord, clean_proof_text, split_marker_lines
from .records import TelegramFootage, TweetRecord
from .resolve import footage_candidates, resolve_thread
from .syndication import ParsedMedia
from .telegram import fetch_telegram_embed


@dataclass(frozen=True)
class DetectedGeoloc:
    coordinate: ParsedCoord
    title: str
    # Plain-text proof body (coords / shortlinks / list markers stripped). The
    # caller wraps it into the model's JSONB proof document.
    proof_text: str
    # The declared footage source (the quoted tweet or an off-platform link),
    # distinct from ``detected_from_url``. None when the geoloc tweet neither
    # quotes nor links footage: a ``detected`` draft may have no source.
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


# The ``C:`` value, whole line: one decimal pair, comma or whitespace
# separated, nothing else. The marker is the discriminator, so no decimal
# floor is needed (unlike the free-text ``_DECIMAL_PAIR_RE``); trailing prose
# fails the match, which is the strictness the format promises.
_STRUCTURED_COORD_RE = re.compile(r"^([-+]?\d{1,3}(?:\.\d+)?)°?[\s,]+([-+]?\d{1,3}(?:\.\d+)?)°?$")

# An http(s) URL token, for requiring one in the ``S:`` value. In raw tweet
# text every link is a ``t.co`` wrapper; the canonical source URL comes from
# the record's expanded ``external_sources`` / quote via ``resolve_thread``.
_S_VALUE_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def _chase_source(record: TweetRecord, *, client: httpx.Client | None) -> TweetRecord:
    """Resolve the ``S:`` link's target onto the record, one fetch at most.

    Mirrors the archive chase (``archive._archive_quoted`` /
    ``_archive_telegram``), through the same shared pieces: when the record
    carries no inline quote and its sole footage candidate
    (:func:`footage_candidates`, the shared ambiguity rule) is an X status,
    chase it via syndication into the ``quoted`` slot (media + post date);
    a sole Telegram post chases its public embed into the ``telegram`` slot
    (post date, media when the embed serves it). Any other case returns the
    record unchanged, so the source degrades to link-only. Fail-soft: a
    failed fetch changes nothing.
    """
    if record.quoted is not None:
        return record
    links = [(link.url, link.host) for link in record.external_sources]
    candidates = footage_candidates(links, owner_handle=record.handle)
    if len(candidates) != 1:
        return record
    candidate = candidates[0]
    if candidate.host == "x" and candidate.status_id is not None:
        from .acquire import quoted_from_syndication

        quoted = quoted_from_syndication(candidate.status_id, client=client)
        if quoted is None or quoted.handle.lower() == record.handle.lower():
            # A link to the author's own status that slipped the URL-level
            # own-handle skip (the ``i/web`` form) is a self-reference, not
            # footage; same re-check as the archive chase.
            return record
        return dataclasses.replace(record, quoted=quoted)
    if candidate.host == "telegram" and record.telegram is None:
        embed = fetch_telegram_embed(candidate.url, client=client)
        if embed is None:
            return record
        return dataclasses.replace(
            record,
            telegram=TelegramFootage(
                url=candidate.url, posted_at=embed.posted_at, media=list(embed.media)
            ),
        )
    return record


def detect_structured(
    record: TweetRecord, *, bot_handle: str, client: httpx.Client | None = None
) -> list[DetectedGeoloc]:
    """The bot's strict single-tweet mapper: one conforming tweet, one DTO.

    The tweet must carry all of ``T:`` (non-empty title), ``C:`` (one decimal
    pair inside bounds), and ``S:`` (a line holding a link that resolves
    through the shared source vocabulary: a quote, or a sole X / Telegram /
    YouTube footage link). Anything short of that returns ``[]``: free-text
    coordinate detection is deliberately not a fallback here, that stays the
    archive path's vocabulary. Title and coordinate come from the markers;
    the non-marker lines, with the bot tag and the markers stripped, become
    the proof; source URL, source post date, and the media split come from
    ``resolve_thread`` over this one record (attached media is the analyst's
    annotation, so it lands as proof; the source media rides the resolved
    quote / chased Telegram embed). ``client`` serves the at-most-one chase
    fetch behind the ``S:`` link.
    """
    text = re.sub(rf"@{re.escape(bot_handle)}\b", "", record.text, flags=re.IGNORECASE)
    fields = split_marker_lines(text)
    if fields.title is None or fields.coords is None or fields.source is None:
        return []
    if _S_VALUE_URL_RE.search(fields.source) is None:
        return []
    match = _STRUCTURED_COORD_RE.match(fields.coords)
    if match is None:
        return []
    coordinate = ParsedCoord(lat=float(match.group(1)), lng=float(match.group(2)))
    # Bounds checking has one home (the same check the human create and
    # geolocate paths run). Imported locally: the rest of ``tweet_ingest``
    # stays importable without the app's service layer.
    from app.services.events import InvalidCoordinatesError, validate_coordinates

    try:
        validate_coordinates(coordinate.lat, coordinate.lng)
    except InvalidCoordinatesError:
        return []
    resolved = resolve_thread([_chase_source(record, client=client)])
    if resolved is None or resolved.source_url is None:
        return []
    from app.models.event import TITLE_MAX_LENGTH

    title = " ".join(fields.title.split())[:TITLE_MAX_LENGTH].strip()
    if not title:
        return []
    return [
        DetectedGeoloc(
            coordinate=coordinate,
            title=title,
            proof_text=clean_proof_text(fields.proof_text),
            source_url=resolved.source_url,
            detected_from_url=resolved.detected_from_url,
            owner_handle=resolved.owner_handle,
            event_date=resolved.event_date,
            source_posted_at=resolved.source_posted_at,
            detected_post_at=resolved.detected_post_at,
            source_media=resolved.source_media,
            proof_media=resolved.proof_media,
        )
    ]
