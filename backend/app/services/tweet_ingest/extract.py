"""Pure text core — coordinates, title, proof body. No I/O.

Reused by every path: ``parse`` (human pre-fill from a pasted tweet),
``detect`` (machine geolocation), and the ``archive`` backfill all run the
same extractors over the same text, so the recovery rate is identical
regardless of where the text came from.

Coordinate parsing
------------------

Four extractors run over the full text, de-duped:

1. Decimal pairs (``48.012345, 37.802411``; degree-marked ``48.6° 38.0°`` too)
2. Decimal degrees + hemisphere (``33.1°N 35.5°E``, ``50.4501N, 30.5234E``,
   ``N48.0123 E37.8024`` — ``°`` optional, letter on either side)
3. DMS (``48°00'45"N 37°48'08"E``)
4. Google Maps ``@lat,lng,zoom`` links

The first lands in the form by default; extras become "other candidates"
chips. The decimal-pair extractor requires ≥3 decimal places to avoid
matching dates / version strings (`1.2.3`, `2025-11-12`); the hemisphere and
DMS forms use the directional letters as the discriminator (one fractional
digit suffices); Maps URLs are unambiguous.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ── Coordinate extractors ─────────────────────────────────────────────────


@dataclass(frozen=True)
class ParsedCoord:
    lat: float
    lng: float


# Horizontal whitespace only — a coordinate pair lives on one line. A separator
# that spanned a newline would pair a latitude on one line with a longitude on
# the next, and the per-line proof / title strippers (run over ``splitlines()``)
# wouldn't remove what ``extract_coords`` lifted. Every extractor below uses it.
_HWS = r"[^\S\r\n]"

# Decimal pairs, optionally degree-marked (``48.621451° 38.041689°``). The
# `.\d{3,}` floor on both sides keeps us off dates (`2025-11-12`), version
# strings (`1.2.3`), and reply counts — none carry 3+ decimals on both numbers
# at once. The trailing guard rejects only a *longer dotted number* (``…411.5``),
# not a sentence-ending period (``…802411.``) — the old ``(?![\d.])`` swallowed
# that period and silently dropped real coords.
_DECIMAL_PAIR_RE = re.compile(
    r"(?<![\d.])"
    r"([-+]?\d{1,3}\.\d{3,})°?"
    rf"(?:{_HWS}|,)+"
    r"([-+]?\d{1,3}\.\d{3,})°?"
    r"(?!\d)(?!\.\d)"
)

# Decimal degrees + hemisphere letter. The letter (not a decimal floor) is the
# discriminator — it disambiguates from dates / versions — so one fractional
# digit is enough; ``°`` is optional. Latitude (N/S) first in both orderings,
# matching how OSINT posts write them. Two variants: letter-suffix
# (``33.1°N 35.5°E``, ``50.4501N, 30.5234E``) and letter-prefix
# (``N48.0123 E37.8024``). Lat-first only — lng-first input (``35.5E 33.1N``)
# is intentionally not matched. The inter-half separator is a comma / slash /
# horizontal whitespace (no newline, via ``_HWS``); requiring it is also what
# rejects prose-embedded letters like ``N12.5 area E34.6``.
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

# DMS — degrees, minutes, seconds + hemisphere letter. Minutes / seconds accept
# both ASCII quotes (``'`` ``"``) and the typographic prime / double-prime
# (``′`` U+2032, ``″`` U+2033) that Google Earth and similar tools emit — a real
# recall gap real archives surface. The inter-half separator is newline-safe
# (``_HWS``), like the other extractors, so a lat/lng split across lines doesn't
# pair.
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


_MAX_CANDIDATES = 3


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
    """Signed decimal degree from a bare number + hemisphere letter."""
    decimal = float(value)
    if hemi.upper() in ("S", "W"):
        decimal = -decimal
    return decimal


def extract_coords(text: str) -> list[ParsedCoord]:
    """Run all extractors over ``text`` and return a de-duped candidate list.

    Order: decimal pairs (most common in OSINT posts), decimal degrees +
    hemisphere, DMS (older intel), then Google Maps URLs. Capped at
    ``_MAX_CANDIDATES`` so a flood of coordinate-shaped strings can't blow up
    the payload.

    Dedup by rounded-to-6-decimals key — finer gives float-equality
    artefacts, coarser conflates candidates the analyst wants distinct.
    """
    candidates: list[ParsedCoord] = []
    seen: set[tuple[float, float]] = set()

    def _push(lat: float, lng: float) -> None:
        if not _coord_in_bounds(lat, lng):
            return
        key = (round(lat, 6), round(lng, 6))
        if key in seen:
            return
        seen.add(key)
        candidates.append(ParsedCoord(lat=lat, lng=lng))

    for m in _DECIMAL_PAIR_RE.finditer(text):
        try:
            lat, lng = float(m.group(1)), float(m.group(2))
        except ValueError:
            continue
        _push(lat, lng)
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _DECIMAL_HEMI_SUFFIX_RE.finditer(text):
        _push(_hemi_decimal(m.group(1), m.group(2)), _hemi_decimal(m.group(3), m.group(4)))
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _DECIMAL_HEMI_PREFIX_RE.finditer(text):
        _push(_hemi_decimal(m.group(2), m.group(1)), _hemi_decimal(m.group(4), m.group(3)))
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _DMS_RE.finditer(text):
        try:
            lat = _dms_to_decimal(m.group(1), m.group(2), m.group(3), m.group(4))
            lng = _dms_to_decimal(m.group(5), m.group(6), m.group(7), m.group(8))
        except ValueError:
            continue
        _push(lat, lng)
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _GMAPS_RE.finditer(text):
        try:
            lat, lng = float(m.group(1)), float(m.group(2))
        except ValueError:
            continue
        _push(lat, lng)
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    return candidates


# Every coordinate form, for stripping coordinates out of prose (title +
# proof body). The structured ``coordinate`` field is the home for the value;
# leaving it in the text duplicates it and reads as noise.
_COORD_RES = (
    _DECIMAL_PAIR_RE,
    _DECIMAL_HEMI_SUFFIX_RE,
    _DECIMAL_HEMI_PREFIX_RE,
    _DMS_RE,
    _GMAPS_RE,
)


def _strip_coords(text: str) -> str:
    for rx in _COORD_RES:
        text = rx.sub(" ", text)
    return text


# ── Structured mention markers ────────────────────────────────────────────


# A marker line of the bot's strict mention format: ``T:`` (title), ``C:``
# (decimal coordinates), or ``S:`` (source link) at the start of a line,
# case-insensitive. Only the bot's mention path consumes these; the free-text
# extractors above stay the archive / paste vocabulary.
_MARKER_LINE_RE = re.compile(r"^\s*([TCS]):\s*(.*)$", re.IGNORECASE)


@dataclass(frozen=True)
class MarkerFields:
    """The strict-format split of one tweet's text.

    Each marker value is the first matching line's payload, stripped;
    ``None`` when the line is absent or empty. ``proof_text`` is every
    non-marker line, order kept, raw (the caller cleans it).
    """

    title: str | None
    coords: str | None
    source: str | None
    proof_text: str


def split_marker_lines(text: str) -> MarkerFields:
    """Split ``text`` into its ``T:`` / ``C:`` / ``S:`` marker values and the
    remaining proof lines.

    Every marker line is removed from the proof, including repeats; a repeated
    marker keeps its first value. Validation (bounds, source vocabulary) is the
    caller's job: this is the pure line split.
    """
    values: dict[str, str] = {}
    proof_lines: list[str] = []
    for line in text.splitlines():
        match = _MARKER_LINE_RE.match(line)
        if match is None:
            proof_lines.append(line)
            continue
        key = match.group(1).upper()
        if key not in values:
            values[key] = match.group(2).strip()
    return MarkerFields(
        title=values.get("T") or None,
        coords=values.get("C") or None,
        source=values.get("S") or None,
        proof_text="\n".join(proof_lines),
    )


# ── Title heuristic ───────────────────────────────────────────────────────


_HASHTAG_RE = re.compile(r"#\w+")
_URL_RE = re.compile(r"https?://\S+")
_WHITESPACE_RE = re.compile(r"\s+")
# A leading list marker: bullet glyphs or an ordinal (``1.`` / ``1)``) at the
# start of a line. Anchored + single-shot so it only peels the marker, not
# digits mid-prose.
_LEADING_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*•·‣–—]|\d{1,3}[.)])\s+")
# A bracket pair emptied by coordinate removal — ``(48.0, 37.8)`` becomes
# ``( )`` after the strip; drop the husk rather than leave it in the title. Only
# matches pairs with no word char inside, so ``(note)`` is left intact.
_EMPTY_BRACKETS_RE = re.compile(r"[(\[{][^\w)\]}]*[)\]}]")
# Edge punctuation left dangling once coords / brackets are gone (a trailing
# ``:`` from ``Coordinates: <coord>``, a stray separator). Stripped from the
# ends only — internal punctuation is untouched.
_TITLE_EDGE_CHARS = " \t:;,.|/-–—()[]{}°"
_HAS_WORD_RE = re.compile(r"\w")
_TITLE_MAX_LEN = 120


def derive_title(text: str) -> str:
    """Best-effort title from the tweet body.

    First usable line — hashtags, URLs, a leading list marker, bare
    coordinates, and the bracket / punctuation husks they leave behind are
    stripped; whitespace is collapsed and the result truncated to
    ``_TITLE_MAX_LEN`` on a word boundary. A line that holds no real word once
    cleaned (coordinates / links / hashtags / punctuation only) is skipped — the
    title is never a bare coordinate. If no line is usable, return ``""`` so the
    analyst types one — a wrong title in the field is worse than none.

    Truncation: prefer the last space inside the limit; with none (one long
    token, e.g. a no-space cyrillic address) hard-cut so the title never
    exceeds the form's column.
    """
    for raw_line in text.splitlines():
        line = _HASHTAG_RE.sub("", raw_line)
        line = _URL_RE.sub("", line)
        line = _LEADING_LIST_MARKER_RE.sub("", line)
        line = _strip_coords(line)
        line = _EMPTY_BRACKETS_RE.sub(" ", line)
        line = _WHITESPACE_RE.sub(" ", line).strip().strip(_TITLE_EDGE_CHARS)
        # Nothing but punctuation / emoji left once the noise is gone — skip it.
        if not line or not _HAS_WORD_RE.search(line):
            continue
        if len(line) <= _TITLE_MAX_LEN:
            return line
        # Last space within the truncation window — slice first then look
        # back (``rsplit`` would find the last space in the whole string).
        clipped = line[:_TITLE_MAX_LEN]
        cut_at = clipped.rfind(" ")
        if cut_at >= 40:  # don't cut so aggressively the title becomes a stub
            return clipped[:cut_at].rstrip()
        return clipped.rstrip()
    return ""


# ── Proof text cleanup ────────────────────────────────────────────────────


# ``t.co`` shortlinks as they appear inline in raw tweet text — X wraps every
# link this way. Only t.co is stripped (not arbitrary URLs): a real source link
# in the body is provenance worth keeping, and the structured source lives
# elsewhere (``source_url`` / ``detected_from_url``).
_T_CO_URL_RE = re.compile(r"https?://t\.co/\S+", re.IGNORECASE)


def clean_proof_text(text: str) -> str:
    """Strip from assembled proof text the artefacts that don't belong in a
    proof body: bare coordinates (the value is a structured field), ``t.co``
    shortlinks (provenance lives in ``source_url`` / ``detected_from_url``),
    and per-line leading list markers. Lines emptied by the removals are
    dropped; internal whitespace is collapsed; lines join with single
    newlines.

    Used by the assemble step when it turns a tweet / thread into a
    detection's proof document — source-agnostic (archive or syndication).
    """
    out_lines: list[str] = []
    for raw_line in text.splitlines():
        line = _strip_coords(raw_line)
        line = _T_CO_URL_RE.sub("", line)
        line = _LEADING_LIST_MARKER_RE.sub("", line)
        line = _WHITESPACE_RE.sub(" ", line).strip()
        if line:
            out_lines.append(line)
    return "\n".join(out_lines)
