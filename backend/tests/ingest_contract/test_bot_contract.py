"""Bot entry contract: every typology through the bot's per-mention detection.

Runs ``bot.acquire_tagged_thread`` then ``resolve_threads`` offline (``MockTransport``,
no DB) against the shared typology fixtures. Expected values are ``expected.json``'s top
level; a ``paths.bot`` block holds only the bot's failure reason or a ``skip``.
A coordinate-less mirror post also yields the refusal plus one request draft (the second exit).
"""

from __future__ import annotations

import pytest

from app.services.bot import acquire_tagged_thread
from app.services.tweet_ingest import COORDS_MISSING, Resolution, resolve_threads

from . import loader

_PATH = "bot"


def _resolution(typology: str) -> Resolution:
    """Run the bot's detection half over the typology's post, as if tagged there.

    ``with_requests`` is passed as the bot passes it: the second exit is the bot's alone.
    """
    body = loader.load_body(typology)
    with loader.syndication_client(typology) as client:
        acquired = acquire_tagged_thread(body["id_str"], body["user"]["screen_name"], client=client)
    return resolve_threads([acquired.records], with_requests=True)


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_matches_the_bot_contract(typology: str) -> None:
    block = loader.load_expected(typology).get("paths", {}).get(_PATH, {})
    if "skip" in block:
        pytest.skip(block["skip"])
    loader.assert_resolution_matches(typology, _PATH, _resolution(typology))


# Read off the fixtures so a mirror shape added to the catalogue enters this test.
_MIRROR_TYPOLOGIES = [
    typology for typology in loader.typology_names() if "request" in loader.load_expected(typology)
]


@pytest.mark.parametrize("typology", _MIRROR_TYPOLOGIES)
def test_a_coordinate_less_mirror_post_drafts_one_request(typology: str) -> None:
    """Mirror shapes: no coordinate, so the thread refuses, and the resolution carries one request draft the bot reads off the second exit."""
    resolution = _resolution(typology)

    assert resolution.detections == []
    assert resolution.reason == COORDS_MISSING
    assert len(resolution.requests) == 1


def test_the_bot_reads_the_same_authors_parent() -> None:
    """Two-post field format: coordinate on the analyst's post, footage link on their reply, bot tagged on the reply.

    The parent comes from the shared acquisition, so provenance anchors on it.
    """
    typology = "self_reply_geo_then_source"
    expected = loader.load_expected(typology)
    resolution = _resolution(typology)

    assert resolution.reason is None
    [detection] = resolution.detections
    assert detection.coordinate.lat == pytest.approx(expected["coords"][0][0])
    assert detection.coordinate.lng == pytest.approx(expected["coords"][0][1])
    assert detection.detected_from_url.endswith(f"/status/{expected['head_tweet_id']}")
    assert detection.source_url == expected["source_url"]
