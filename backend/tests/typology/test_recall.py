"""The recall harness: the objective net under the coordinate parser.

Two tiers:

* **Golden fixtures** (always, CI-safe): every committed sanitized fixture must
  still parse to its ``expected_coord`` (or, for an image-only fixture, still
  parse to *nothing*). This is the regression net that runs with no dataset.
* **Corpus recall** (local only, skipped when ``backend/datasets/`` is absent):
  recompute recall over the gitignored sample and fail if it drops below the
  committed ``weights.json`` baseline. Re-run after any parser change →
  a number, not a feeling.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.tweet_ingest.extract import extract_coords

from . import weights
from .taxonomy import matches_verified

_HERE = Path(__file__).resolve().parent
_FIXTURES_PATH = _HERE / "fixtures.json"

# recall wobbles a little sample-to-sample; fail only on a real regression.
_RECALL_REGRESSION_TOL = 0.03


def _load_fixtures() -> list[dict]:
    if not _FIXTURES_PATH.exists():
        return []
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def _joined(fixture: dict) -> str:
    op = fixture.get("op_text", "")
    quoted = fixture.get("quoted_text", "")
    return op + ("\n" + quoted if quoted else "")


def test_golden_fixtures_present() -> None:
    assert _load_fixtures(), (
        "no golden fixtures committed: run the corpus tooling, then gen_fixtures"
    )


@pytest.mark.parametrize("fixture", _load_fixtures(), ids=lambda f: f.get("typology", "?"))
def test_golden_fixture_still_parses(fixture: dict) -> None:
    coords = extract_coords(_joined(fixture))
    expected = fixture.get("expected_coord")
    if expected is None:
        # image-only / coordinate-free fixture: the false-positive guard.
        assert coords == [], f"expected no coordinate, parser invented {coords}"
    else:
        assert coords, "expected a coordinate, parser found none"
        assert matches_verified(coords, expected["lat"], expected["lng"], tol_deg=1e-4), (
            f"parsed {coords[0]} != expected {expected}"
        )


@pytest.mark.skipif(
    not (weights.sample_available() and weights.WEIGHTS_PATH.exists()),
    reason="gitignored corpus / baseline absent (CI or pre-build)",
)
def test_corpus_recall_no_regression() -> None:
    baseline = weights.load()["totals"]["recall"]
    current = weights.compute()["totals"]["recall"]
    assert current >= baseline - _RECALL_REGRESSION_TOL, (
        f"corpus recall regressed to {current:.3f}, baseline {baseline:.3f}"
    )
