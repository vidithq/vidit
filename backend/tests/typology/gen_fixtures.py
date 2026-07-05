"""Generate the committed golden fixtures from the gitignored corpus.

Picks a few real tweets per typology, runs each through the sanitizer (synthetic
coordinate, redacted handles/links, prose collapsed to ``text``), verifies it
still classifies the same and round-trips through the parser, then writes
``fixtures.json``. Deterministic (stable seed) so a re-run doesn't churn the
committed file. Writes no real tweet content.

Usage (from ``backend/``):
    uv run python -m tests.typology.gen_fixtures
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from app.services.tweet_ingest.extract import extract_coords

from .sanitizer import sanitize
from .taxonomy import classify

_HERE = Path(__file__).resolve().parent
_FIXTURES_PATH = _HERE / "fixtures.json"
_SAMPLE = _HERE.parents[1] / "datasets" / "corpus" / "sample_tweets.jsonl"

# Small committed set: the golden fixtures are the regression net, not the
# corpus; a couple per typology keeps CI fast and the file reviewable.
_PER_TYPOLOGY = 2


def _stable_seed(typology: str, index: int) -> int:
    digest = hashlib.sha256(f"{typology}:{index}".encode()).hexdigest()
    return int(digest[:8], 16)


def _joined(op_text: str, quoted_text: str) -> str:
    return op_text + ("\n" + quoted_text if quoted_text else "")


def generate() -> list[dict]:
    by_typology: dict[str, list[tuple[str, str, bool]]] = {}
    with _SAMPLE.open(encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            if row.get("status") != "ok":
                continue
            op = row.get("op_text") or ""
            quoted = row.get("quoted_text") or ""
            has_quote = bool(row.get("has_quote"))
            key = classify(op, quoted, has_quote).key()
            by_typology.setdefault(key, []).append((op, quoted, has_quote))

    fixtures: list[dict] = []
    for typology in sorted(by_typology):
        picked = 0
        for index, (op, quoted, has_quote) in enumerate(by_typology[typology]):
            if picked >= _PER_TYPOLOGY:
                break
            fixture = sanitize(op, quoted, has_quote, seed=_stable_seed(typology, index))
            # The sanitized fixture must still classify the same and round-trip
            # through the parser — otherwise sanitisation changed the shape.
            same_shape = (
                classify(fixture["op_text"], fixture["quoted_text"], fixture["has_quote"]).key()
                == typology
            )
            coords = extract_coords(_joined(fixture["op_text"], fixture["quoted_text"]))
            expected = fixture["expected_coord"]
            round_trips = (expected is None and not coords) or (
                expected is not None and bool(coords)
            )
            if same_shape and round_trips:
                fixtures.append(fixture)
                picked += 1

    _FIXTURES_PATH.write_text(
        json.dumps(fixtures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return fixtures


if __name__ == "__main__":
    generated = generate()
    print(f"wrote {len(generated)} fixtures → {_FIXTURES_PATH.name}")
    for key, count in sorted(Counter(f["typology"] for f in generated).items()):
        print(f"  {key}: {count}")
