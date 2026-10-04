"""Pure text core: coordinates, retweet rule, title, proof body. No I/O.

One vocabulary for every entry (bot, paste, archive backfill).

Four extractors run over the full text, de-duped:

1. Decimal pairs (``48.012345, 37.802411``; degree-marked too)
2. Decimal degrees plus hemisphere (``33.1°N 35.5°E``, ``N48.0123 E37.8024``)
3. DMS (``48°00'45"N 37°48'08"E``)
4. Google Maps ``@lat,lng,zoom`` links

Every coordinate found makes a detection; the 6-decimal dedup is the only guard.
Decimal pairs need 3+ decimals to skip dates and versions (`1.2.3`,
`2025-11-12`); the hemisphere and DMS forms use the letters as discriminator.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ParsedCoord:
    lat: float
    lng: float


# Horizontal whitespace only, so a pair never spans a newline.
_HWS = r"[^\S\r\n]"

# Decimal pairs, optionally degree-marked. The `.\d{3,}` floor on both sides
# skips dates, versions and reply counts. The trailing guard rejects a longer
# dotted number (``…411.5``) but not a sentence-ending period (``…802411.``).
_DECIMAL_PAIR_RE = re.compile(
    r"(?<![\d.])"
    r"([-+]?\d{1,3}\.\d{3,})°?"
    rf"(?:{_HWS}|,)+"
    r"([-+]?\d{1,3}\.\d{3,})°?"
    r"(?!\d)(?!\.\d)"
)

# Decimal degrees plus hemisphere letter (the discriminator, so one decimal
# suffices; ``°`` optional). Suffix form (``33.1°N 35.5°E``) and prefix form
# (``N48.0123 E37.8024``), lat-first only: lng-first (``35.5E 33.1N``) is
# intentionally not matched. The required separator (comma, slash, horizontal
# whitespace) also rejects prose like ``N12.5 area E34.6``.
_DECIMAL_HEMI_SUFFIX_RE = re.compile(
    r"(?<![\w.])"
    r"(\d{1,3}\.\d+)\s*°?\s*([NS])"
    rf"(?:{_HWS}|[,/])+"
    r"(\d{1,3}\.\d+)\s*°?\s*([EW])"
    r"(?![\w.])",
    re.IGNORECASE,
)
_DECIMAL_HEMI_PREFIX_RE = re.compile(
    r"(?<![\w.])"
    r"([NS])\s*(\d{1,3}\.\d+)\s*°?"
    rf"(?:{_HWS}|[,/])+"
    r"([EW])\s*(\d{1,3}\.\d+)\s*°?"
    r"(?![\w.])",
    re.IGNORECASE,
)

# DMS plus hemisphere letter. Minutes and seconds accept ASCII quotes and the
# typographic primes (``′`` U+2032, ``″`` U+2033) Google Earth emits.
_DMS_RE = re.compile(
    r"(\d{1,3})°\s*(\d{1,2})['’′]\s*(\d{1,2}(?:\.\d+)?)?[\"”″]?\s*([NS])"
    rf"(?:{_HWS}|,)*"
    r"(\d{1,3})°\s*(\d{1,2})['’′]\s*(\d{1,2}(?:\.\d+)?)?[\"”″]?\s*([EW])",
    re.IGNORECASE,
)

# Google Maps `@lat,lng,zoom` segment; zoom is optional.
_GMAPS_RE = re.compile(
    r"(?:google\.[^/\s]+/maps[^\s]*?)@(-?\d+\.\d+),(-?\d+\.\d+)(?:,\d+(?:\.\d+)?z?)?",
    re.IGNORECASE,
)

# Every coordinate form, for the title rule.
_COORD_RES = (
    _DECIMAL_PAIR_RE,
    _DECIMAL_HEMI_SUFFIX_RE,
    _DECIMAL_HEMI_PREFIX_RE,
    _DMS_RE,
    _GMAPS_RE,
)


def _coord_in_bounds(lat: float, lng: float) -> bool:
    return -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0


def _dms_to_decimal(deg: str, mnt: str, sec: str | None, hemi: str) -> float:
    d = int(deg)
    m = int(mnt)
    s = float(sec) if sec else 0.0
    decimal = d + m / 60.0 + s / 3600.0
    if hemi.upper() in ("S", "W"):
        decimal = -decimal
    return decimal


def _hemi_decimal(value: str, hemi: str) -> float:
    """Signed decimal degree from a bare number plus hemisphere letter."""
    decimal = float(value)
    if hemi.upper() in ("S", "W"):
        decimal = -decimal
    return decimal


@dataclass(frozen=True)
class CoordScan:
    """What the extractors saw in one text.

    ``out_of_bounds`` says a coordinate-shaped string was dropped for sitting
    outside the world, a refusal distinct from "no coordinate at all".
    """

    coords: list[ParsedCoord] = field(default_factory=list)
    out_of_bounds: bool = False


def scan_coords(text: str) -> CoordScan:
    """Run all extractors over ``text`` (decimal pairs, hemisphere, DMS, Maps).

    No cap: post length bounds the count. Dedup on a 6-decimal rounded key
    (finer gives float-equality artefacts, coarser conflates distinct candidates).
    """
    coords: list[ParsedCoord] = []
    seen: set[tuple[float, float]] = set()
    out_of_bounds = False

    def _push(lat: float, lng: float) -> None:
        nonlocal out_of_bounds
        if not _coord_in_bounds(lat, lng):
            out_of_bounds = True
            return
        key = (round(lat, 6), round(lng, 6))
        if key in seen:
            return
        seen.add(key)
        coords.append(ParsedCoord(lat=lat, lng=lng))

    for m in _DECIMAL_PAIR_RE.finditer(text):
        try:
            _push(float(m.group(1)), float(m.group(2)))
        except ValueError:
            continue

    for m in _DECIMAL_HEMI_SUFFIX_RE.finditer(text):
        _push(_hemi_decimal(m.group(1), m.group(2)), _hemi_decimal(m.group(3), m.group(4)))

    for m in _DECIMAL_HEMI_PREFIX_RE.finditer(text):
        _push(_hemi_decimal(m.group(2), m.group(1)), _hemi_decimal(m.group(4), m.group(3)))

    for m in _DMS_RE.finditer(text):
        try:
            lat = _dms_to_decimal(m.group(1), m.group(2), m.group(3), m.group(4))
            lng = _dms_to_decimal(m.group(5), m.group(6), m.group(7), m.group(8))
        except ValueError:
            continue
        _push(lat, lng)

    for m in _GMAPS_RE.finditer(text):
        try:
            _push(float(m.group(1)), float(m.group(2)))
        except ValueError:
            continue

    return CoordScan(coords=coords, out_of_bounds=out_of_bounds)


def extract_coords(text: str) -> list[ParsedCoord]:
    """The usable coordinates in ``text`` (:func:`scan_coords` minus the signal)."""
    return scan_coords(text).coords


# The X handle grammar: 1 to 15 word characters.
_HANDLE = r"[A-Za-z0-9_]{1,15}"


# The text is the only reliable retweet signal: an export has no
# ``retweeted_status`` and writes ``retweeted: false`` on every entry. What
# survives is ``RT @<handle>: <original text>``. Deliberate boundary: only the
# canonical form matches (not lowercase ``rt`` or a missing colon), and a
# hand-typed canonical prefix is dropped too.
_RETWEET_PREFIX_RE = re.compile(rf"^RT @{_HANDLE}:")


def is_retweet(text: str) -> bool:
    """Whether ``text`` opens on the retweet prefix (someone else's words).

    The archive reader and the detection engine both drop such a post.
    """
    return _RETWEET_PREFIX_RE.match(text) is not None


_MENTION_RE = re.compile(rf"@({_HANDLE})")


def is_mentions_only(text: str) -> bool:
    """Whether ``text`` is only mentions and whitespace.

    Any other residue answers false, a dot-mention's period (``.@viditbot``)
    included (:func:`acquire._is_bare_tag`).
    """
    return not _MENTION_RE.sub("", text).strip()


def _past_leading_mentions(text: str) -> str:
    """``text`` past the run of mentions X writes at the start of a reply.

    The run ends at the first token that is not a bare mention. A character
    before a mention, or a non-whitespace character right after one, ends it
    early, so ``.@viditbot`` and ``@viditbot, look`` read as typed.
    """
    end = 0
    for match in _MENTION_RE.finditer(text):
        if text[end : match.start()].strip():
            break
        trailing = text[match.end() : match.end() + 1]
        if trailing and not trailing.isspace():
            break
        end = match.end()
    return text[end:]


def tags_bot(text: str, handle: str, *, inherits_prefix: bool) -> bool:
    """Whether ``text`` carries an ``@handle`` tag its author typed.

    Pure, so both deliveries and the parent read share one answer. It reads the
    text, since entities carry no position (the webhook prefers
    ``extended_tweet.full_text``, which keeps a tag past the truncation point).

    ``inherits_prefix``: X may have written a leading run of mentions in a
    reply, so only the region past it counts (:func:`_past_leading_mentions`).
    Pass ``False`` for a non-reply and for "does this text mention the handle
    at all" (the parent post question).
    """
    if not handle:
        return False
    wanted = handle.lower()
    region = _past_leading_mentions(text) if inherits_prefix else text
    return any(match.group(1).lower() == wanted for match in _MENTION_RE.finditer(region))


def strip_bot_tag(text: str, handle: str) -> str:
    """``text`` with the bot's ``@handle`` removed where it opens a line.

    A tag inside a sentence stays (the analyst is talking about the bot).
    """
    if not handle:
        return text
    return re.sub(
        rf"^[^\S\r\n]*@{re.escape(handle)}\b[^\S\r\n]*",
        "",
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )


_WHITESPACE_RE = re.compile(r"\s+")
# Readability cap of the derived title, well under the ``events.title`` column (255).
_TITLE_MAX_LEN = 120


_URL_TOKEN_RE = re.compile(r"https?://\S+", re.IGNORECASE)

# Enumeration a line may open on: thread numbering (``9|``) or list entries
# (``1.``, ``2)``). Other separators are punctuation (:data:`_NON_TEXT_RE`).
_LIST_MARKER_RE = re.compile(r"^\s*\d+\s*[.)\]|:-]")

_NON_TEXT_RE = re.compile(r"[\W_]", re.UNICODE)


def _carries_text(line: str) -> bool:
    """Whether ``line`` has words beyond its coordinates, links, list marker and punctuation."""
    residue = _URL_TOKEN_RE.sub(" ", line)
    for rx in _COORD_RES:
        residue = rx.sub(" ", residue)
    return bool(_NON_TEXT_RE.sub("", _LIST_MARKER_RE.sub(" ", residue)))


def derive_title(text: str) -> str:
    """The first line of ``text`` passing :func:`_carries_text`, whitespace-collapsed
    and cut at ``_TITLE_MAX_LEN``.

    The line is taken verbatim (coordinates, links and hashtags included); the
    analyst rewrites it at review. ``""`` when no line qualifies: a wrong title
    is worse than none.

    Truncation prefers the last space in the limit, else hard-cuts (one long
    token).
    """
    for raw_line in text.splitlines():
        line = _WHITESPACE_RE.sub(" ", raw_line).strip()
        if not _carries_text(line):
            continue
        if len(line) <= _TITLE_MAX_LEN:
            return line
        # Slice first (``rsplit`` would find the last space in the whole string).
        clipped = line[:_TITLE_MAX_LEN]
        cut_at = clipped.rfind(" ")
        if cut_at >= 40:  # avoid a stub title
            return clipped[:cut_at].rstrip()
        return clipped.rstrip()
    return ""


# By the time the proof is cleaned, analyst links are expanded
# (``records.expand_shortlinks``), so a remaining ``t.co`` is the wrapper X
# appends for attached media.
_T_CO_URL_RE = re.compile(r"https?://t\.co/\S+", re.IGNORECASE)


def clean_proof_text(text: str) -> str:
    """The thread's text as the proof stores it: media wrappers and blank lines
    dropped, whitespace collapsed. Coordinates and reference links stay."""
    out_lines: list[str] = []
    for raw_line in text.splitlines():
        line = _T_CO_URL_RE.sub("", raw_line)
        line = _WHITESPACE_RE.sub(" ", line).strip()
        if line:
            out_lines.append(line)
    return "\n".join(out_lines)
