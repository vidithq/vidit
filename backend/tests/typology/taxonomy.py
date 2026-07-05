"""Typology taxonomy — classify a geolocation tweet by its structural shape.

Three axes, each a stable string so weights + fixtures can bucket on them:

* ``coord_format``   — which extractor family recovers the coordinate:
                       ``decimal`` / ``hemisphere`` / ``dms`` / ``gmaps`` /
                       ``none`` (no parseable coordinate in the text).
* ``coord_location`` — where the coordinate lives: ``op`` (the tweet body),
                       ``quoted`` (only in the quoted tweet), or ``image_only``
                       (nowhere in text — the ~14% a vision pass would need).
* ``structure``      — ``single`` or ``quote`` (a quoted tweet is attached).

Classification *reuses the real parser* (``extract.extract_coords`` and its
module-level regexes) rather than re-deriving coordinate rules — the harness
tests those exact patterns, so importing them is deliberate: a rename upstream
breaks the harness loudly instead of letting it drift.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.tweet_ingest.extract import (
    _DECIMAL_HEMI_PREFIX_RE,
    _DECIMAL_HEMI_SUFFIX_RE,
    _DECIMAL_PAIR_RE,
    _DMS_RE,
    _GMAPS_RE,
    ParsedCoord,
    extract_coords,
)

COORD_FORMATS = ("decimal", "hemisphere", "dms", "gmaps", "none")
COORD_LOCATIONS = ("op", "quoted", "image_only")
STRUCTURES = ("single", "quote")

# Probe order: gmaps first (a Google-Maps link embeds a decimal pair, so the
# more specific label wins), then extractor-priority decimal / hemisphere / dms.
# Approximation: labels by the first pattern that matches the text; a rare miss
# needs a coordinate-shaped substring of one family masking another's real hit.
_FORMAT_PROBES: tuple[tuple[str, tuple], ...] = (
    ("gmaps", (_GMAPS_RE,)),
    ("decimal", (_DECIMAL_PAIR_RE,)),
    ("hemisphere", (_DECIMAL_HEMI_SUFFIX_RE, _DECIMAL_HEMI_PREFIX_RE)),
    ("dms", (_DMS_RE,)),
)


@dataclass(frozen=True)
class Typology:
    coord_format: str
    coord_location: str
    structure: str

    def key(self) -> str:
        return f"{self.coord_format}|{self.coord_location}|{self.structure}"


def _joined(op_text: str, quoted_text: str) -> str:
    # ``detect`` concatenates every tweet's text before extraction; mirror that
    # so a coordinate split across OP + quoted tweet is seen the same way.
    return op_text + ("\n" + quoted_text if quoted_text else "")


def primary_format(text: str) -> str:
    """The format of the coordinate the parser would recover from ``text``."""
    if not extract_coords(text):
        return "none"
    for name, regexes in _FORMAT_PROBES:
        if any(rx.search(text) for rx in regexes):
            return name
    return "none"


def coord_location(op_text: str, quoted_text: str) -> str:
    if extract_coords(op_text):
        return "op"
    if quoted_text and extract_coords(quoted_text):
        return "quoted"
    return "image_only"


def classify(op_text: str, quoted_text: str = "", has_quote: bool = False) -> Typology:
    return Typology(
        coord_format=primary_format(_joined(op_text, quoted_text)),
        coord_location=coord_location(op_text, quoted_text),
        structure="quote" if has_quote else "single",
    )


def recovered_coords(op_text: str, quoted_text: str = "") -> list[ParsedCoord]:
    """The coordinates the parser recovers from a tweet's full text."""
    return extract_coords(_joined(op_text, quoted_text))


def matches_verified(
    coords: list[ParsedCoord], lat: float, lng: float, tol_deg: float = 0.1
) -> bool:
    """Whether any recovered coordinate sits within ``tol_deg`` of the
    corpus-verified point. A loose box (~11 km) separates a real recovery
    from a false positive (a date / version string parsed as a coordinate lands
    a continent away) without penalising a camera-vs-subject offset.
    """
    return any(abs(c.lat - lat) <= tol_deg and abs(c.lng - lng) <= tol_deg for c in coords)
