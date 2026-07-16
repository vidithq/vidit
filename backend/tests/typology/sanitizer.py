"""Real tweet → safe, committable structural fixture.

The rule is absolute: **never commit real tweet content**. A committed fixture
keeps only the *structure* a coordinate lives in, never the analyst's words,
handle, links, or real coordinate:

* the coordinate keeps its exact real form (separators, ``°``, typographic
  primes, letter placement, the quirks that break parsers) but every digit is
  swapped for a synthetic in-bounds value;
* free prose words collapse to ``text``;
* ``@handles`` → ``@user`` and links → ``https://example.invalid/x``;
* line structure and the coordinate's position are preserved.

So the fixture proves the parser handles a real-world *shape* without
republishing anything identifiable. ``expected_coord`` is read back through the
real ``extract_coords`` at build time, so the committed value is exactly what
the parser must keep returning.
"""

from __future__ import annotations

import random
import re

from app.services.tweet_ingest.extract import (
    _DECIMAL_HEMI_PREFIX_RE,
    _DECIMAL_HEMI_SUFFIX_RE,
    _DECIMAL_PAIR_RE,
    _DMS_RE,
    _GMAPS_RE,
    extract_coords,
)

from .taxonomy import classify, recovered_coords

# Coordinate patterns in extractor-priority order (highest first), so an overlap
# between two families resolves to the one the parser would land.
_COORD_RES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("decimal", _DECIMAL_PAIR_RE),
    ("hemisphere", _DECIMAL_HEMI_SUFFIX_RE),
    ("hemisphere", _DECIMAL_HEMI_PREFIX_RE),
    ("dms", _DMS_RE),
    ("gmaps", _GMAPS_RE),
)

_HANDLE_RE = re.compile(r"@\w{1,15}")
_URL_RE = re.compile(r"https?://\S+")
_DIGIT_RUN_RE = re.compile(r"\d+")
# Latin + Cyrillic word runs: the analyst's prose, replaced wholesale.
_WORD_RE = re.compile(r"[A-Za-zЀ-ӿ]+")

_URL_TOKEN = "https://example.invalid/x"
_HANDLE_TOKEN = "@user"
_WORD_TOKEN = "text"


def _digit_swapped(span: str, rng: random.Random) -> str | None:
    """Swap every digit in a coordinate substring, preserving all decoration and
    digit-run lengths, until the result still parses to an in-bounds coordinate.

    Same-length runs keep decimal precision and the format's shape; the retry
    loop rejects a draw that pushes latitude past 90 / longitude past 180.
    Returns ``None`` if no in-bounds draw is found (caller uses a canonical
    fallback), never returns the real digits.
    """
    for _ in range(40):
        cand = _DIGIT_RUN_RE.sub(
            lambda m: "".join(rng.choice("0123456789") for _ in range(len(m.group()))), span
        )
        if cand != span and extract_coords(cand):
            return cand
    return None


def _canonical(fmt: str, rng: random.Random) -> str:
    """A clean synthetic coordinate of ``fmt``: the fallback when digit-swapping
    a pathological span can't land in bounds."""
    lat = round(rng.uniform(35.0, 60.0), 5)
    lng = round(rng.uniform(-10.0, 60.0), 5)
    if fmt == "hemisphere":
        return f"{lat:.4f}°N {lng:.4f}°E"
    if fmt == "dms":
        return f"{_to_dms(lat, 'N', 'S')} {_to_dms(lng, 'E', 'W')}"
    if fmt == "gmaps":
        return f"https://www.google.com/maps/@{lat:.6f},{lng:.6f},15z"
    return f"{lat:.5f}, {lng:.5f}"


def _to_dms(value: float, pos: str, neg: str, minute: str = "'", second: str = '"') -> str:
    hemi = pos if value >= 0 else neg
    value = abs(value)
    deg = int(value)
    minutes_float = (value - deg) * 60
    minutes = int(minutes_float)
    seconds = int((minutes_float - minutes) * 60)
    return f"{deg}°{minutes:02d}{minute}{seconds:02d}{second}{hemi}"


def _synth_dms(original: str, rng: random.Random) -> str:
    """A synthetic DMS coordinate with valid minutes/seconds (0-59), preserving
    the original's prime glyphs (ASCII ``' "`` vs typographic ``′ ″``) because
    the typographic form is the exact recall gap real archives surface, so a
    fixture must keep it. (Digit-swapping DMS would emit invalid 60+ minutes.)
    """
    minute = "′" if "′" in original else "'"
    second = "″" if "″" in original else '"'
    lat = rng.uniform(35.0, 60.0)
    lng = rng.uniform(-10.0, 60.0)
    return f"{_to_dms(lat, 'N', 'S', minute, second)} {_to_dms(lng, 'E', 'W', minute, second)}"


def _rewrite(text: str, rng: random.Random) -> str:
    """Skeletonise ``text``: synthesize coordinate spans, redact handles/links,
    collapse prose to ``text``. Single pass over non-overlapping spans."""
    # Priority 0 coords, 1 urls, 2 handles: the lower priority wins an overlap,
    # so a gmaps coordinate (which is also a url) survives instead of being
    # redacted away. Resolve strictly by priority, not by which starts first.
    by_priority: dict[int, list[tuple[int, int, str]]] = {0: [], 1: [], 2: []}
    for fmt, rx in _COORD_RES:
        for m in rx.finditer(text):
            start, end = m.start(), m.end()
            if fmt == "gmaps":
                # Absorb any scheme prefix so the whole URL is replaced cleanly
                # rather than leaving a mangled "text://text." husk in the gap.
                pre = re.search(r"(?:https?://)?(?:www\.)?\Z", text[:start])
                start = pre.start() if pre else start
                repl = _canonical("gmaps", rng)
            elif fmt == "dms":
                repl = _synth_dms(m.group(0), rng)
            else:
                repl = _digit_swapped(m.group(0), rng) or _canonical(fmt, rng)
            by_priority[0].append((start, end, repl))
    for m in _URL_RE.finditer(text):
        by_priority[1].append((m.start(), m.end(), _URL_TOKEN))
    for m in _HANDLE_RE.finditer(text):
        by_priority[2].append((m.start(), m.end(), _HANDLE_TOKEN))

    kept: list[tuple[int, int, str]] = []

    def _overlaps(start: int, end: int) -> bool:
        return any(not (end <= ks or start >= ke) for ks, ke, _ in kept)

    for priority in (0, 1, 2):
        for start, end, repl in sorted(by_priority[priority]):
            if not _overlaps(start, end):
                kept.append((start, end, repl))
    kept.sort()

    out: list[str] = []
    idx = 0
    for start, end, repl in kept:
        # Gap text is prose → collapse words; keep punctuation / newlines / digit
        # noise (dates, times) so the parser's false-positive rejection is exercised.
        out.append(_WORD_RE.sub(_WORD_TOKEN, text[idx:start]))
        out.append(repl)
        idx = end
    out.append(_WORD_RE.sub(_WORD_TOKEN, text[idx:]))
    return "".join(out)


def sanitize(
    op_text: str, quoted_text: str = "", has_quote: bool = False, seed: int = 0
) -> dict[str, object]:
    """Turn a real tweet into a committable fixture (see module docstring)."""
    rng = random.Random(seed)
    typ = classify(op_text, quoted_text, has_quote)
    s_op = _rewrite(op_text, rng)
    s_quoted = _rewrite(quoted_text, rng) if quoted_text else ""
    coords = recovered_coords(s_op, s_quoted)
    expected = {"lat": round(coords[0].lat, 6), "lng": round(coords[0].lng, 6)} if coords else None
    return {
        "typology": typ.key(),
        "op_text": s_op,
        "quoted_text": s_quoted,
        "has_quote": has_quote,
        "expected_coord": expected,
    }
