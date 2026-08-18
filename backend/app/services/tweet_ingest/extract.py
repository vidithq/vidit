"""Pure text core: coordinates, retweet rule, title, proof body. No I/O.

One vocabulary for every entry (the bot, the pasted-tweet import, the archive
backfill), so the recovery rate is identical regardless of where the text came
from.

Coordinate parsing
------------------

Four extractors run over the full text, de-duped:

1. Decimal pairs (``48.012345, 37.802411``; degree-marked ``48.6° 38.0°`` too)
2. Decimal degrees plus hemisphere (``33.1°N 35.5°E``, ``50.4501N, 30.5234E``,
   ``N48.0123 E37.8024``, with ``°`` optional and the letter on either side)
3. DMS (``48°00'45"N 37°48'08"E``)
4. Google Maps ``@lat,lng,zoom`` links

Every coordinate found makes a detection; the 6-decimal dedup is the only guard.
The decimal-pair extractor requires 3 or more decimal places to avoid matching
dates / version strings (`1.2.3`, `2025-11-12`); the hemisphere and DMS forms
use the directional letters as the discriminator (one fractional digit
suffices); Maps URLs are unambiguous.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Coordinate extractors ─────────────────────────────────────────────────


@dataclass(frozen=True)
class ParsedCoord:
    lat: float
    lng: float


# Horizontal whitespace only: a coordinate pair lives on one line. A separator
# spanning a newline would pair a latitude on one line with a longitude on the
# next. Every extractor below uses it.
_HWS = r"[^\S\r\n]"

# Decimal pairs, optionally degree-marked (``48.621451° 38.041689°``). The
# `.\d{3,}` floor on both sides keeps us off dates (`2025-11-12`), version
# strings (`1.2.3`), and reply counts: none carry 3+ decimals on both numbers
# at once. The trailing guard rejects only a *longer dotted number* (``…411.5``),
# not a sentence-ending period (``…802411.``); the old ``(?![\d.])`` swallowed
# that period and silently dropped real coords.
_DECIMAL_PAIR_RE = re.compile(
    r"(?<![\d.])"
    r"([-+]?\d{1,3}\.\d{3,})°?"
    rf"(?:{_HWS}|,)+"
    r"([-+]?\d{1,3}\.\d{3,})°?"
    r"(?!\d)(?!\.\d)"
)

# Decimal degrees plus hemisphere letter. The letter (not a decimal floor) is
# the discriminator, so one fractional digit is enough; ``°`` is optional.
# Latitude (N/S) first in both orderings, matching how OSINT posts write them.
# Two variants: letter-suffix (``33.1°N 35.5°E``, ``50.4501N, 30.5234E``) and
# letter-prefix (``N48.0123 E37.8024``). Lat-first only: lng-first input
# (``35.5E 33.1N``) is intentionally not matched. The inter-half separator is a
# comma / slash / horizontal whitespace (no newline, via ``_HWS``); requiring it
# is also what rejects prose-embedded letters like ``N12.5 area E34.6``.
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

# DMS: degrees, minutes, seconds plus hemisphere letter. Minutes / seconds
# accept both ASCII quotes (``'`` ``"``) and the typographic prime / double
# prime (``′`` U+2032, ``″`` U+2033) that Google Earth and similar tools emit, a
# real recall gap real archives surface. The inter-half separator is
# newline-safe (``_HWS``), like the other extractors.
_DMS_RE = re.compile(
    r"(\d{1,3})°\s*(\d{1,2})['’′]\s*(\d{1,2}(?:\.\d+)?)?[\"”″]?\s*([NS])"
    rf"(?:{_HWS}|,)*"
    r"(\d{1,3})°\s*(\d{1,2})['’′]\s*(\d{1,2}(?:\.\d+)?)?[\"”″]?\s*([EW])",
    re.IGNORECASE,
)

# Google Maps `@lat,lng,zoom` segment. Tolerant: zoom is optional.
_GMAPS_RE = re.compile(
    r"(?:google\.[^/\s]+/maps[^\s]*?)@(-?\d+\.\d+),(-?\d+\.\d+)(?:,\d+(?:\.\d+)?z?)?",
    re.IGNORECASE,
)

# Every coordinate form, for asking what a line carries besides its coordinates
# (the title rule).
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

    ``coords`` are the usable pairs. ``out_of_bounds`` says a coordinate-shaped
    string was read and dropped because its latitude or longitude sits outside
    the world, which is the one refusal a caller can name apart from "no
    coordinate at all".
    """

    coords: list[ParsedCoord] = field(default_factory=list)
    out_of_bounds: bool = False


def scan_coords(text: str) -> CoordScan:
    """Run all extractors over ``text``, in order: decimal pairs (most common in
    OSINT posts), decimal degrees plus hemisphere, DMS (older intel), then
    Google Maps URLs.

    No cap: every coordinate the analyst wrote makes a detection, and the text
    length of a post already bounds how many that is. Dedup by
    rounded-to-6-decimals key; finer gives float-equality artefacts, coarser
    conflates candidates the analyst wants distinct.
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
    """The usable coordinates in ``text`` (:func:`scan_coords` without the
    out-of-bounds signal)."""
    return scan_coords(text).coords


# ── Retweet rule ──────────────────────────────────────────────────────────


# The retweet discriminator, and the one home for why the text is the only
# reliable signal. An export entry carries no flag worth trusting: there is no
# ``retweeted_status`` object (the exporter drops it) and the ``retweeted``
# boolean is written ``false`` on every entry, retweets included. What survives
# is the text X stores for a retweet, ``RT @<handle>: <original text>``, so the
# prefix is the signal. A handle is 1 to 15 word characters and the colon must
# follow, which keeps a post that merely opens on the letters "RT" out of the
# match. The heuristic's deliberate boundary: X writes the canonical form, so
# variants like a lowercase ``rt`` or a missing colon are out of scope, and a
# post the owner hand-typed with the canonical prefix is dropped along with real
# retweets, its content being someone else's either way.
_RETWEET_PREFIX_RE = re.compile(r"^RT @[A-Za-z0-9_]{1,15}:")


def is_retweet(text: str) -> bool:
    """Whether ``text`` opens on the retweet prefix, so the post carries someone
    else's words.

    Read by the archive reader (which drops the entry before stitching) and by
    the detection engine (which drops the record before resolving), so a
    retweet produces nothing on any entry.
    """
    return _RETWEET_PREFIX_RE.match(text) is not None


# ── Bot tag ───────────────────────────────────────────────────────────────


def strip_bot_tag(text: str, handle: str) -> str:
    """``text`` with the bot's ``@handle`` removed where it opens a line.

    The one thing the proof drops beyond the wrappers of attached media: the tag
    is addressing, not content. A tag written inside a sentence stays, because
    there the analyst is talking about the bot.
    """
    if not handle:
        return text
    return re.sub(
        rf"^[^\S\r\n]*@{re.escape(handle)}\b[^\S\r\n]*",
        "",
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )


# ── Title ─────────────────────────────────────────────────────────────────


_WHITESPACE_RE = re.compile(r"\s+")
# The derived title's readability cap. Well under the ``events.title`` column
# (255): a headline longer than this is a paragraph, and the analyst rewrites it
# at review anyway.
_TITLE_MAX_LEN = 120


# A URL as it appears inline in a line of post text.
_URL_TOKEN_RE = re.compile(r"https?://\S+", re.IGNORECASE)

# The enumeration a line may open on once its coordinates are gone: an OSINT
# thread numbers its posts (``9|``) and a coordinate list numbers its entries
# (``1.``, ``2)``). Bullets and every other separator are punctuation, which
# :data:`_NON_TEXT_RE` removes on its own.
_LIST_MARKER_RE = re.compile(r"^\s*\d+\s*[.)\]|:-]")

# Punctuation, separators and whitespace: what carries no text of its own.
_NON_TEXT_RE = re.compile(r"[\W_]", re.UNICODE)


def _carries_text(line: str) -> bool:
    """Whether ``line`` says anything beyond its coordinates and its links.

    Every coordinate token and every URL token comes out, then the list marker
    the line may open on, then the punctuation around them. What is left is the
    analyst's own words, and a line with none of them is a coordinate dump, a
    link dump, or both at once.
    """
    residue = _URL_TOKEN_RE.sub(" ", line)
    for rx in _COORD_RES:
        residue = rx.sub(" ", residue)
    return bool(_NON_TEXT_RE.sub("", _LIST_MARKER_RE.sub(" ", residue)))


def derive_title(text: str) -> str:
    """The first line of ``text`` carrying text beyond coordinates and links,
    whitespace-collapsed and cut at ``_TITLE_MAX_LEN`` on a word boundary.

    :func:`_carries_text` decides which line that is, so a line pairing a
    coordinate with the maps link it came from is skipped exactly as a bare
    coordinate is. The chosen line is then taken verbatim, coordinates, links,
    hashtags and list marker included: what the analyst wrote is the headline,
    and the review pass is where a bad one gets rewritten. ``""`` when no line
    qualifies, so the analyst types one; a wrong title in the field is worse
    than none.

    Truncation prefers the last space inside the limit; with none (one long
    token, for instance a no-space cyrillic address) it hard-cuts.
    """
    for raw_line in text.splitlines():
        line = _WHITESPACE_RE.sub(" ", raw_line).strip()
        if not _carries_text(line):
            continue
        if len(line) <= _TITLE_MAX_LEN:
            return line
        # Last space within the truncation window: slice first then look back
        # (``rsplit`` would find the last space in the whole string).
        clipped = line[:_TITLE_MAX_LEN]
        cut_at = clipped.rfind(" ")
        if cut_at >= 40:  # don't cut so aggressively the title becomes a stub
            return clipped[:cut_at].rstrip()
        return clipped.rstrip()
    return ""


# ── Proof text ────────────────────────────────────────────────────────────


# ``t.co`` shortlinks as they appear inline in raw tweet text. By the time the
# proof is cleaned, every link the analyst wrote has been expanded back to its
# real URL (``records.expand_shortlinks``), so what is left under this pattern is
# the wrapper X appends for the post's own attached media: a permalink to the
# post itself, not something the analyst typed.
_T_CO_URL_RE = re.compile(r"https?://t\.co/\S+", re.IGNORECASE)


def clean_proof_text(text: str) -> str:
    """The thread's text as the proof stores it: the wrappers of attached media
    dropped, blank lines dropped, internal whitespace collapsed.

    Nothing else is removed. The coordinate line stays, the analyst's reference
    links stay, and the analyst edits the proof at review.
    """
    out_lines: list[str] = []
    for raw_line in text.splitlines():
        line = _T_CO_URL_RE.sub("", raw_line)
        line = _WHITESPACE_RE.sub(" ", line).strip()
        if line:
            out_lines.append(line)
    return "\n".join(out_lines)
