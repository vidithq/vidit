"""Paste entry contract: every typology through the pasted-post import.

The paste's detection half is its own acquisition
(``tweet_ingest.acquire_pasted_thread``, the URL parsed once then the shared one
hop) followed by the engine (``resolve_threads``), which is what
``detection.import_pasted_post`` runs before it writes. It runs here against the
same typology fixtures the other consumers use, offline (a ``MockTransport``
over the typology's bodies) and with no DB, so what this file pins is that the
paste's entry answers what the shared expectation says.

Each typology's expected value is ``expected.json``'s top level. A
``paths.paste`` block holds only a ``skip`` for a shape no live post can carry.
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


def test_the_paste_reads_the_same_authors_parent() -> None:
    """The two-post field format, pasted on the reply: the coordinate sits on
    the analyst's post and the footage link on their own reply. Provenance
    anchors on the parent, which is the head of the acquired thread."""
    typology = "self_reply_geo_then_source"
    expected = loader.load_expected(typology)
    body = loader.load_body(typology)

    with loader.syndication_client(typology) as client:
        acquired = acquire_pasted_thread(loader.owner_url(body), client=client)
    resolution = resolve_threads([acquired.records])

    assert resolution.reason is None
    [draft] = resolution.drafts
    assert draft.detected_from_url.endswith(f"/status/{expected['head_tweet_id']}")
    assert draft.source_url == expected["source_url"]
