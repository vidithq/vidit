"""Per-typology weighting + recall stats over the gitignored corpus.

``regenerate()`` classifies every hydrated tweet in
``backend/datasets/corpus/sample_tweets.jsonl``, scores it against each row's
verified coordinate, and writes the committed ``weights.json`` (aggregate
numbers only, no tweet content, safe to commit). The harness reads it back as
the recall baseline.

Three rates per bucket:

* ``coverage``: fraction whose text carries a parseable coordinate.
* ``match_of_recovered``: of those, fraction matching the verified point (the
  false-positive guard: a date parsed as a coordinate lands far away and
  fails this).
* ``recall``: ``coverage × match`` = fraction recovered *and* correct.
"""

from __future__ import annotations

import json
from pathlib import Path

from .taxonomy import classify, matches_verified, recovered_coords

_HERE = Path(__file__).resolve().parent
WEIGHTS_PATH = _HERE / "weights.json"
# _HERE == backend/tests/typology ; parents[1] == backend.
_SAMPLE = _HERE.parents[1] / "datasets" / "corpus" / "sample_tweets.jsonl"


def sample_available() -> bool:
    return _SAMPLE.exists()


def _iter_ok() -> list[dict]:
    rows: list[dict] = []
    with _SAMPLE.open(encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            if row.get("status") == "ok":
                rows.append(row)
    return rows


def _blank() -> dict[str, int]:
    return {"n": 0, "recovered": 0, "matched": 0}


def _rates(bucket: dict[str, int]) -> dict[str, float | int]:
    n = bucket["n"] or 1
    recovered = bucket["recovered"] or 1
    return {
        **bucket,
        "coverage": round(bucket["recovered"] / n, 4),
        "match_of_recovered": round(bucket["matched"] / recovered, 4),
        "recall": round(bucket["matched"] / n, 4),
    }


def compute() -> dict:
    by_format: dict[str, dict[str, int]] = {}
    by_location: dict[str, dict[str, int]] = {}
    by_typology: dict[str, dict[str, int]] = {}
    totals = _blank()
    for row in _iter_ok():
        op = row.get("op_text") or ""
        quoted = row.get("quoted_text") or ""
        has_quote = bool(row.get("has_quote"))
        typ = classify(op, quoted, has_quote)
        coords = recovered_coords(op, quoted)
        recovered = 1 if coords else 0
        matched = 1 if coords and matches_verified(coords, row["lat"], row["lng"]) else 0
        for table, key in (
            (by_format, typ.coord_format),
            (by_location, typ.coord_location),
            (by_typology, typ.key()),
        ):
            bucket = table.setdefault(key, _blank())
            bucket["n"] += 1
            bucket["recovered"] += recovered
            bucket["matched"] += matched
        totals["n"] += 1
        totals["recovered"] += recovered
        totals["matched"] += matched
    return {
        "corpus": "ukraine-sample",
        "sample_size": totals["n"],
        "totals": _rates(totals),
        "by_format": {k: _rates(v) for k, v in sorted(by_format.items())},
        "by_location": {k: _rates(v) for k, v in sorted(by_location.items())},
        "by_typology": {
            k: _rates(v) for k, v in sorted(by_typology.items(), key=lambda kv: -kv[1]["n"])
        },
    }


def regenerate() -> dict:
    stats = compute()
    WEIGHTS_PATH.write_text(
        json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    _print_report(stats)
    return stats


def load() -> dict:
    return json.loads(WEIGHTS_PATH.read_text(encoding="utf-8"))


def _print_report(stats: dict) -> None:
    total = stats["totals"]
    print(f"\ncorpus={stats['corpus']}  sample={stats['sample_size']}")
    print(
        f"overall: coverage={total['coverage']:.1%}  recall={total['recall']:.1%}  "
        f"(match-of-recovered={total['match_of_recovered']:.1%})\n"
    )
    print("by coordinate format:")
    for key, val in stats["by_format"].items():
        print(
            f"  {key:11s} n={val['n']:4d}  coverage={val['coverage']:.0%}  recall={val['recall']:.0%}"
        )
    print("\nby coordinate location:")
    n = max(stats["sample_size"], 1)
    for key, val in stats["by_location"].items():
        print(f"  {key:11s} n={val['n']:4d}  ({val['n'] / n:.0%} of sample)")


if __name__ == "__main__":  # `make typology-weights` entry
    regenerate()
