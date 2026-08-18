"""Bot entry contract: every typology through the bot's per-mention detection.

The bot's detection half is the shared one-hop acquisition
(``bot.acquire_tagged_thread``) followed by the engine (``resolve_threads``),
and nothing else: the bot adds a reply on top, never a grammar. It runs here
against the same typology fixtures the resolve contract uses, offline (a
``MockTransport`` over the typology's bodies) and with no DB, so what this file
pins is that the bot's entry answers what the shared expectation says.

Each typology's expected value is ``expected.json``'s top level. A ``paths.bot``
block holds only the bot's own vocabulary, the failure reason its reply names,
or a ``skip`` for a shape no live post can carry.
"""

from __future__ import annotations

import pytest

from app.services.bot import acquire_tagged_thread
from app.services.tweet_ingest import Resolution, resolve_threads

from . import loader

_PATH = "bot"


def _resolution(typology: str) -> Resolution:
    """Run the bot's detection half over the typology's post, as if tagged there."""
    body = loader.load_body(typology)
    with loader.syndication_client(typology) as client:
        acquired = acquire_tagged_thread(body["id_str"], body["user"]["screen_name"], client=client)
    return resolve_threads([acquired.records])


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_matches_the_bot_contract(typology: str) -> None:
    block = loader.load_expected(typology).get("paths", {}).get(_PATH, {})
    if "skip" in block:
        pytest.skip(block["skip"])
    loader.assert_resolution_matches(typology, _PATH, _resolution(typology))


def test_the_bot_reads_the_same_authors_parent() -> None:
    """The two-post field format: the coordinate on the analyst's post, the
    footage link on their own reply, the bot tagged on the reply. The parent
    comes from the shared acquisition, so provenance anchors on it and the
    coordinate the reply itself does not carry still lands."""
    typology = "self_reply_geo_then_source"
    expected = loader.load_expected(typology)
    resolution = _resolution(typology)

    assert resolution.reason is None
    [detection] = resolution.detections
    assert detection.coordinate.lat == pytest.approx(expected["coords"][0][0])
    assert detection.coordinate.lng == pytest.approx(expected["coords"][0][1])
    assert detection.detected_from_url.endswith(f"/status/{expected['head_tweet_id']}")
    assert detection.source_url == expected["source_url"]
