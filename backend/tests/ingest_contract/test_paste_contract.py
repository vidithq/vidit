"""Paste entry contract: every typology through the pasted-tweet import.

``parse_tweet`` is what ``POST /events/import-from-tweet`` returns to the submit
form, and ``preview_detection`` is the machine view of the same paste the route
returns beside it. Both run here against the typology fixtures, offline (a
``MockTransport`` over the typology's bodies) and with no DB.

Each typology's expected value for this entry lives in ``expected.json``: the
shared expectation at the top level, and a ``paths.paste`` block for whatever
the paste answers differently, with a ``diverges`` note naming why.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.services.detection import preview_detection
from app.services.tweet_ingest import parse_tweet

from . import loader

_PATH = "paste"
_COORD_PLACES = 6


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_matches_the_paste_contract(typology: str) -> None:
    block = loader.load_expected(typology).get("paths", {}).get(_PATH, {})
    if "skip" in block:
        pytest.skip(block["skip"])
    expected = loader.expected_for_path(typology, _PATH)
    body = loader.load_body(typology)

    with loader.syndication_client(typology) as client:
        parsed = parse_tweet(loader.owner_url(body), client=client)

    assert [
        [round(c.lat, _COORD_PLACES), round(c.lng, _COORD_PLACES)] for c in parsed.parsed_coords
    ] == [[round(lat, _COORD_PLACES), round(lng, _COORD_PLACES)] for lat, lng in expected["coords"]]
    assert parsed.source_url == expected["source_url"]
    assert parsed.secondary_source_urls == expected["secondary_source_urls"]
    assert parsed.suggested_title == expected["title"]

    if expected["source_posted_at"] is None:
        assert parsed.source_posted_at is None
    else:
        assert parsed.source_posted_at == datetime.fromisoformat(expected["source_posted_at"])

    # The form is offered the same media the resolution split, source slot and
    # annotation together: the split itself is the resolve contract's business.
    assert sorted([m.kind, m.origin] for m in parsed.media) == sorted(
        [list(pair) for pair in [*expected["source_media"], *expected["proof_media"]]]
    )

    # Provenance: the thread head, which is the parent when the pasted post is
    # the analyst's own reply.
    head_id = expected.get("head_tweet_id", body["id_str"])
    assert parsed.original_tweet_url.endswith(f"/status/{head_id}")


@pytest.mark.parametrize("typology", loader.typology_names())
def test_paste_preview_matches_what_the_form_is_offered(typology: str) -> None:
    """The route answers the pre-fill and the machine preview from one paste, so
    the two halves must agree on the coordinates and the source."""
    block = loader.load_expected(typology).get("paths", {}).get(_PATH, {})
    if "skip" in block:
        pytest.skip(block["skip"])
    expected = loader.expected_for_path(typology, _PATH)
    body = loader.load_body(typology)

    with loader.syndication_client(typology) as client:
        detections = preview_detection(loader.owner_url(body), client=client)

    assert len(detections) == len(expected["coords"])
    for detection in detections:
        assert detection.source_url == expected["source_url"]
        assert detection.title == expected["title"]
