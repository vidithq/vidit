"""Paste entry contract: every typology through the pasted-post import.

Runs ``tweet_ingest.acquire_pasted_thread`` then ``resolve_threads`` (what
``detection.import_pasted_post`` runs before writing) offline (``MockTransport``, no DB)
against the shared typology fixtures. Expected values are ``expected.json``'s top level;
a ``paths.paste`` block holds only a ``skip``.
"""

from __future__ import annotations

import pytest

from app.services.tweet_ingest import acquire_pasted_thread, resolve_threads

from . import loader

_PATH = "paste"


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_matches_the_paste_contract(typology: str) -> None:
    block = loader.load_expected(typology).get("paths", {}).get(_PATH, {})
    if "skip" in block:
        pytest.skip(block["skip"])
    body = loader.load_body(typology)

    with loader.syndication_client(typology) as client:
        acquired = acquire_pasted_thread(loader.owner_url(body), client=client)

    loader.assert_resolution_matches(typology, _PATH, resolve_threads([acquired.records]))


@pytest.mark.parametrize("typology", ["mirror_telegram_no_coord", "mirror_x_status_no_coord"])
def test_a_coordinate_less_mirror_post_drafts_nothing_for_the_paste(typology: str) -> None:
    """The paste never opens the second exit: mirror shapes the bot drafts a request for are a plain ``coords_missing`` refusal here."""
    body = loader.load_body(typology)
    with loader.syndication_client(typology) as client:
        acquired = acquire_pasted_thread(loader.owner_url(body), client=client)
    resolution = resolve_threads([acquired.records])

    assert resolution.requests == []
    assert resolution.reason == "coords_missing"


def test_the_paste_reads_the_same_authors_parent() -> None:
    """Two-post field format, pasted on the reply: provenance anchors on the parent, the head of the acquired thread."""
    typology = "self_reply_geo_then_source"
    expected = loader.load_expected(typology)
    body = loader.load_body(typology)

    with loader.syndication_client(typology) as client:
        acquired = acquire_pasted_thread(loader.owner_url(body), client=client)
    resolution = resolve_threads([acquired.records])

    assert resolution.reason is None
    [detection] = resolution.detections
    assert detection.detected_from_url.endswith(f"/status/{expected['head_tweet_id']}")
    assert detection.source_url == expected["source_url"]
