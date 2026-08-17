"""Bot entry contract: every typology through the bot's per-mention detection.

``bot.detect_tagged_post`` is the whole detection half of a mention: the shared
one-hop acquisition, then the strict inline mapper and, failing that, the relay
mapper over the tagged post's same-author parent. It runs here against the same
typology fixtures the resolve contract uses, offline (a ``MockTransport`` over
the typology's bodies) and with no DB, so what this file pins is the grammar,
not the plumbing around it.

Each typology's expected value for this entry lives in ``expected.json``: the
shared expectation at the top level, and a ``paths.bot`` block for whatever the
bot answers differently. Today the bot refuses most typologies the shared
resolution reads, and every such block names why in a ``diverges`` note. The
notes are the record of where the two grammars stand apart, not an endorsement.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services.bot import detect_tagged_post
from app.services.tweet_ingest import DetectedGeoloc

from . import loader

_PATH = "bot"


def _detections(typology: str) -> tuple[list[DetectedGeoloc], str | None]:
    """Run the bot over the typology's post, as if it had been tagged there."""
    body = loader.load_body(typology)
    with loader.syndication_client(typology) as client:
        detections, _record, reason = detect_tagged_post(
            body["id_str"], body["user"]["screen_name"], client=client
        )
    return detections, reason


def _roles(media: list[Any]) -> list[list[str]]:
    return [[m.kind, m.origin] for m in media]


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_matches_the_bot_contract(typology: str) -> None:
    block = loader.load_expected(typology).get("paths", {}).get(_PATH, {})
    if "skip" in block:
        pytest.skip(block["skip"])
    expected = loader.expected_for_path(typology, _PATH)
    # One draft per coordinate is the golden outcome; a typology the bot answers
    # differently states the count it actually reaches.
    count = block.get("detections", len(expected["coords"]))

    detections, reason = _detections(typology)

    assert len(detections) == count, typology
    if "reason" in block:
        assert reason == block["reason"], typology
    for detection in detections:
        assert detection.title == expected["title"], typology
        assert detection.source_url == expected["source_url"], typology
        assert detection.secondary_source_urls == expected["secondary_source_urls"], typology
        assert _roles(detection.source_media) == [
            list(pair) for pair in expected["source_media"]
        ], typology
        assert _roles(detection.proof_media) == [list(pair) for pair in expected["proof_media"]], (
            typology
        )


def test_the_bot_reads_the_same_authors_parent() -> None:
    """The two-post field format: the coordinate on the analyst's post, the
    footage link on their own reply, the bot tagged on the reply. The parent
    comes from the shared acquisition, so provenance anchors on it and the
    coordinate the reply itself does not carry still lands."""
    typology = "self_reply_geo_then_source"
    expected = loader.load_expected(typology)
    detections, reason = _detections(typology)

    assert reason is None
    [detection] = detections
    assert detection.coordinate.lat == pytest.approx(expected["coords"][0][0])
    assert detection.coordinate.lng == pytest.approx(expected["coords"][0][1])
    assert detection.detected_from_url.endswith(f"/status/{expected['head_tweet_id']}")
    assert detection.source_url == expected["source_url"]
