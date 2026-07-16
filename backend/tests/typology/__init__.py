"""Typology QA harness: the objective net under the coordinate parser.

A taxonomy of geolocation-tweet shapes + a real-tweet sanitizer + a corpus
recall harness. The committed artifacts (``fixtures.json``, ``weights.json``)
run in CI; the raw corpus they were distilled from lives gitignored under
``backend/datasets/`` and is rebuilt by the local tooling in
``backend/datasets/tools/``.

Never commit real tweet content: only sanitized fixtures (synthetic coords,
redacted handles/links) and aggregate counts.
"""
