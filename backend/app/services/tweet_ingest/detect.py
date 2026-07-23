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

from .acquire import quoted_from_syndication, record_from_syndication
from .errors import TweetImportError
from .extract import (
    MarkerFields,
    ParsedCoord,
    clean_proof_text,
    has_marker_lines,
    split_marker_lines,
)
from .records import SourceLink, TelegramFootage, TweetRecord
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


# The ``C:`` value, whole line: one decimal pair and nothing else. Deliberate
# leniency inside the pair (analyst-friendly): optional sign, optional degree
# sign per half, comma or whitespace separators. The marker is the
# discriminator, so no decimal floor is needed (unlike the free-text
# ``_DECIMAL_PAIR_RE``); trailing prose fails the match, which is the
# strictness the format promises. Docs mirror this grammar
# (docs/ingestion.md#bot-format).
_STRUCTURED_COORD_RE = re.compile(r"^([-+]?\d{1,3}(?:\.\d+)?)°?[\s,]+([-+]?\d{1,3}(?:\.\d+)?)°?$")

# An http(s) URL token on the ``S:`` line. In raw tweet text every link is a
# ``t.co`` wrapper; the token binds to its expanded entity via
# ``SourceLink.shortlink`` (see :func:`_designated_source`).
_S_VALUE_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)

# A line that is nothing but one URL token: the bare format's source line
# (the unprefixed ``S:``). Whole-line, like ``_STRUCTURED_COORD_RE``: a link
# inside prose is a proof reference, never a designation.
_URL_ONLY_LINE_RE = re.compile(r"^\s*(https?://\S+)\s*$", re.IGNORECASE)

# Sentence punctuation an analyst may glue after the URL token; stripped
# before binding the token to its entity.
_TOKEN_TRAILING_PUNCT = ".,;:!?)\"'"

# Failure-reason codes ``detect_structured_diagnosed`` surfaces so the bot's
# failure reply can open with what actually went wrong. Plain strings, one
# home; the reply copy lives in ``bot._FAILURE_HINTS``.
MARKERS_INCOMPLETE = "markers_incomplete"
COORDS_MISSING = "coords_missing"
COORDS_AMBIGUOUS = "coords_ambiguous"
COORDS_INVALID = "coords_invalid"
SOURCE_MISSING = "source_missing"
SOURCE_AMBIGUOUS = "source_ambiguous"
SOURCE_UNBOUND = "source_unbound"
SOURCE_OWN = "source_own"
TITLE_MISSING = "title_missing"


def _designated_source(
    record: TweetRecord, s_value: str
) -> tuple[TweetRecord | None, str | None]:
    """Prune ``record`` to the source its ``S:`` line designates, or
    ``(None, reason)`` when the line designates nothing valid (a format
    failure, the reason naming which rule broke).

    Exactly one URL token may sit on the line (two or more is a failure). The
    token must bind to one of the record's link entities, by its ``t.co``
    shortlink or its expanded URL. Any bound link is a valid designation,
    whatever its host: the chase vocabulary (X status / Telegram / YouTube)
    decides what gets fetched, never what gets stored. The one exception is a
    link back to the author's own status (a cross-reference, not a source).
    Links elsewhere in the tweet neither help nor hurt: the pruned record
    keeps only the designated entity, and keeps the inline quote only when it
    IS the designated status.

    A line with no URL token designates the inline quote when there is one:
    X converts a pasted status link into the quote card, and some syndication
    payloads then strip the trailing ``t.co`` from the text, so the quote is
    the link that was on ``S:``. With no quote either, nothing is designated.
    """
    tokens = [t.rstrip(_TOKEN_TRAILING_PUNCT) for t in _S_VALUE_URL_RE.findall(s_value)]
    if len(tokens) > 1:
        return None, SOURCE_AMBIGUOUS
    if not tokens:
        if record.quoted is not None:
            return dataclasses.replace(record, external_sources=[]), None
        return None, SOURCE_MISSING
    token = tokens[0]
    link = next(
        (entry for entry in record.external_sources if token in (entry.shortlink, entry.url)),
        None,
    )
    if link is None:
        return None, SOURCE_UNBOUND
    candidates = footage_candidates([(link.url, link.host)], owner_handle=record.handle)
    if link.host == "x" and not candidates:
        # Host ``x`` only classifies status links, so an empty candidate list
        # here means the author's own status: rejected, never a source.
        return None, SOURCE_OWN
    if (
        candidates
        and record.quoted is not None
        and candidates[0].status_id == record.quoted.tweet_id
    ):
        # The designated status is the inline quote: keep it, its media and
        # post date come free, no chase needed.
        return dataclasses.replace(record, external_sources=[link]), None
    # A quote of anything else is not the designated source; drop it so it
    # cannot steal the source slot from the S: link.
    return dataclasses.replace(record, quoted=None, external_sources=[link]), None


def _bare_fields(record: TweetRecord, text: str) -> tuple[MarkerFields | None, str | None]:
    """The bare (unprefixed) shape of the strict format, or ``(None, reason)``
    when the text doesn't carry it.

    The analyst-friendly form: same structure as the marker form, the shape
    itself carrying what the prefixes carried. Deterministic, no free-text
    recovery:

    * **Coordinates**: the one line that is nothing but a decimal pair
      (``_STRUCTURED_COORD_RE``, whole line). Zero or several such lines fail.
    * **Source**: the one line that is nothing but a URL token binding to a
      link entity. A whole-line token binding to nothing (the ``t.co`` wrapper
      X appends for attached media) is ignored, not a failure; two bound
      lines fail. With no such line, the inline quote card is the designated
      source; failing that, a post carrying exactly one link entity anywhere
      designates that link. A post with no bound line, no quote, and zero or
      several link entities fails: with several links, the source must sit
      alone on its own line.
    * **Title**: the first remaining non-empty, non-URL-only line.
    * Every other line is the proof note.

    The trade against the marker form: a shape failure still fails loudly
    (nothing lands), but the title is positional, so a post that opens with
    commentary titles the draft with it; the owner's review pass owns that
    correction. The marker form stays the escape hatch that pins every field
    explicitly.
    """
    lines = text.splitlines()
    coord_idx = [i for i, line in enumerate(lines) if _STRUCTURED_COORD_RE.match(line.strip())]
    if not coord_idx:
        return None, COORDS_MISSING
    if len(coord_idx) > 1:
        return None, COORDS_AMBIGUOUS
    url_only: dict[int, str] = {}
    bound: list[int] = []
    for i, line in enumerate(lines):
        match = _URL_ONLY_LINE_RE.match(line)
        if match is None:
            continue
        token = match.group(1).rstrip(_TOKEN_TRAILING_PUNCT)
        url_only[i] = token
        if any(token in (entry.shortlink, entry.url) for entry in record.external_sources):
            bound.append(i)
    if len(bound) > 1:
        return None, SOURCE_AMBIGUOUS
    source_idx: int | None
    if bound:
        source_idx, source_value = bound[0], url_only[bound[0]]
    elif record.quoted is not None:
        # No token: the quote card is the source (``_designated_source``'s
        # empty-value branch), as when X swallows the pasted status URL.
        source_idx, source_value = None, ""
    elif len(record.external_sources) == 1:
        source_idx, source_value = None, record.external_sources[0].url
    elif record.external_sources:
        return None, SOURCE_AMBIGUOUS
    else:
        return None, SOURCE_MISSING
    consumed = {coord_idx[0]}
    if source_idx is not None:
        consumed.add(source_idx)
    title_idx = next(
        (
            i
            for i, line in enumerate(lines)
            if i not in consumed and i not in url_only and line.strip()
        ),
        None,
    )
    if title_idx is None:
        return None, TITLE_MISSING
    consumed.add(title_idx)
    fields = MarkerFields(
        title=lines[title_idx].strip(),
        coords=lines[coord_idx[0]].strip(),
        source=source_value,
        proof_text="\n".join(line for i, line in enumerate(lines) if i not in consumed),
    )
    return fields, None


def _expand_shortlinks(text: str, links: list[SourceLink]) -> str:
    """Replace each entity's opaque ``t.co`` token in ``text`` with its
    expanded URL, so an analyst's reference link survives readable in the
    stored proof. Tokens with no entity (the wrapper X appends for attached
    media) stay for ``clean_proof_text`` to strip."""
    for link in links:
        if link.shortlink:
            text = text.replace(link.shortlink, link.url)
    return text


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
    """:func:`detect_structured_diagnosed` without the failure reason; the
    mapper most callers want."""
    detections, _ = detect_structured_diagnosed(record, bot_handle=bot_handle, client=client)
    return detections


def detect_structured_diagnosed(
    record: TweetRecord, *, bot_handle: str, client: httpx.Client | None = None
) -> tuple[list[DetectedGeoloc], str | None]:
    """The bot's strict single-tweet mapper: one conforming tweet, one DTO,
    plus a failure-reason code (the module-level ``*_MISSING`` / ``*_AMBIGUOUS``
    constants) when nothing conforms, so the failure reply can name what
    broke instead of reciting the whole lesson.

    Two spellings of one structure, both all-or-nothing:

    * **Marker form**: ``T:`` (non-empty title), ``C:`` (one decimal pair
      inside bounds), ``S:`` (a line designating the source: one URL token
      bound to a link entity, or the inline quote when X swallowed the token
      into the quote card, see :func:`_designated_source`). Any marker LINE
      present, even one with an empty payload, pins this form
      (:func:`has_marker_lines`): an incomplete or empty marker set fails
      rather than falling back to the bare shape, where the literal marker
      line would leak into the title (a half-marked post is a mistake to
      teach, not a guess to absorb).
    * **Bare form**: no marker lines at all; the shape carries the fields
      (:func:`_bare_fields`): the whole-line decimal pair, the whole-line
      source link (or the quote card / the post's only link), the first
      remaining line as title.

    Anything short of either returns ``[]``: free-text coordinate detection
    is deliberately not a fallback here, that stays the archive path's
    vocabulary. The remaining lines, with the bot tag stripped and ``t.co``
    reference tokens expanded, become the proof; source URL, source post
    date, and the media split come from ``resolve_thread`` over the pruned
    record (attached media is the analyst's annotation, so it lands as
    proof; the source media rides the designated quote / chased status /
    chased Telegram embed). ``client`` serves the at-most-one chase fetch
    behind the designated link.
    """
    text = re.sub(rf"@{re.escape(bot_handle)}\b", "", record.text, flags=re.IGNORECASE)
    if has_marker_lines(text):
        fields = split_marker_lines(text)
        if fields.title is None or fields.coords is None or fields.source is None:
            return [], MARKERS_INCOMPLETE
    else:
        bare, reason = _bare_fields(record, text)
        if bare is None:
            return [], reason
        fields = bare
    match = _STRUCTURED_COORD_RE.match(fields.coords)
    if match is None:
        return [], COORDS_INVALID
    coordinate = ParsedCoord(lat=float(match.group(1)), lng=float(match.group(2)))
    # Bounds checking has one home (the same check the human create and
    # geolocate paths run). Imported locally: the rest of ``tweet_ingest``
    # stays importable without the app's service layer.
    from app.services.events import InvalidCoordinatesError, validate_coordinates

    try:
        validate_coordinates(coordinate.lat, coordinate.lng)
    except InvalidCoordinatesError:
        return [], COORDS_INVALID
    designated, source_reason = _designated_source(record, fields.source)
    if designated is None:
        return [], source_reason
    resolved = resolve_thread([_chase_source(designated, client=client)])
    if resolved is None:
        return [], None
    source_url = resolved.source_url
    if source_url is None:
        # The shared resolution only surfaces chase-vocabulary hosts; a
        # designated off-vocabulary link (host ``other``) is stored link-only.
        source_url = designated.external_sources[0].url if designated.external_sources else None
    if source_url is None:
        return [], SOURCE_MISSING
    from app.models.event import TITLE_MAX_LENGTH

    # Non-empty by the split contract (a marker only records a non-empty
    # payload); collapse whitespace and truncate on a word boundary, same
    # policy as ``derive_title``, so a column-cap cut never splits a word.
    title = " ".join(fields.title.split())
    if len(title) > TITLE_MAX_LENGTH:
        clipped = title[:TITLE_MAX_LENGTH]
        cut_at = clipped.rfind(" ")
        title = clipped[:cut_at].rstrip() if cut_at >= 40 else clipped.rstrip()
    detections = [
        DetectedGeoloc(
            coordinate=coordinate,
            title=title,
            proof_text=clean_proof_text(
                _expand_shortlinks(fields.proof_text, record.external_sources)
            ),
            source_url=source_url,
            detected_from_url=resolved.detected_from_url,
            owner_handle=resolved.owner_handle,
            event_date=resolved.event_date,
            source_posted_at=resolved.source_posted_at,
            detected_post_at=resolved.detected_post_at,
            source_media=resolved.source_media,
            proof_media=resolved.proof_media,
        )
    ]
    return detections, None


def fetch_relay_parent(
    record: TweetRecord, *, client: httpx.Client | None = None
) -> TweetRecord | None:
    """The parent behind a relay-form mention: the tweet ``record`` replies to,
    when it is the same author's post. ``None`` otherwise.

    One hop, one syndication fetch, and only for a self-reply: the same-author
    guard (checked on the fetched parent's handle, the authoritative value) is
    what stops a stranger from tagging the bot under someone else's post and
    relaying media onto it. Fail-soft: a fetch failure reads as "no parent",
    so the mention degrades to ``no_detection``.
    """
    if record.in_reply_to_status_id is None:
        return None
    try:
        # Lowercased handle: the parent's permalink anchors the shared
        # inline/relay idempotency key, and the inline path lowercases its
        # own URL the same way (``bot._tagged_record``), so a case drift
        # between the mention payload and the syndication screen_name can't
        # split one geolocation across two keys.
        parent = record_from_syndication(
            f"https://x.com/{record.handle.lower()}/status/{record.in_reply_to_status_id}",
            client=client,
        )
    except TweetImportError:
        return None
    if parent.handle.lower() != record.handle.lower():
        return None
    return parent


def detect_relay(
    tagged: TweetRecord,
    parent: TweetRecord,
    *,
    bot_handle: str,
    client: httpx.Client | None = None,
) -> list[DetectedGeoloc]:
    """The bot's relay mapper: the strict format lives on the parent (the
    analyst's geoloc tweet), the tagged reply relays the footage.

    The relay form exists for sources outside the chase vocabulary (TikTok, an
    Instagram post, a news article): the ``S:`` link cannot yield the footage,
    so the analyst re-uploads it in a direct reply to their own geoloc tweet
    and tags the bot there. That second tweet is the explicit signal
    ``split_media`` otherwise requires before promoting an analyst's own
    attachment to source footage.

    The parent runs the same strict mapper as an inline mention (markers,
    bounds, ``S:`` designation, at most one chase), so the two forms cannot
    drift; ``detected_from_url`` is therefore the parent's permalink, and an
    analyst who tags both tweets lands on the same idempotency key. On top of
    that resolution: the reply's attached media, when present, becomes the
    source media (it outranks any chased media, the analyst's explicit
    gesture wins; a chased post date is still kept). The assemble step
    stores one ``role=source`` media, so the reply should carry the footage
    alone; annotations belong on the parent, where they land as proof. The
    reply's non-marker text joins the proof as a caption. A reply with no
    media changes nothing:
    the parent resolves exactly as if it had been tagged inline. Same-author
    is re-checked here so the guard cannot be skipped by a caller.
    """
    if parent.handle.lower() != tagged.handle.lower():
        return []
    detections = detect_structured(parent, bot_handle=bot_handle, client=client)
    if not detections:
        return []
    tag_stripped = re.sub(rf"@{re.escape(bot_handle)}\b", "", tagged.text, flags=re.IGNORECASE)
    caption = clean_proof_text(
        _expand_shortlinks(split_marker_lines(tag_stripped).proof_text, tagged.external_sources)
    )
    return [
        dataclasses.replace(
            detection,
            source_media=list(tagged.media) if tagged.media else detection.source_media,
            proof_text=(
                f"{detection.proof_text}\n{caption}".strip("\n") if caption else detection.proof_text
            ),
        )
        for detection in detections
    ]
