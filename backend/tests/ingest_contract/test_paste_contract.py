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
