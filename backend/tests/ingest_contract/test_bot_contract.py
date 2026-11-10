"""Bot entry contract: every typology through the bot's per-mention detection.

Runs ``bot.acquire_tagged_thread`` then ``resolve_threads`` offline (``MockTransport``,
no DB) against the shared typology fixtures. Expected values are ``expected.json``'s top
level; a ``paths.bot`` block holds only the bot's failure reason or a ``skip``.
A coordinate-less mirror post also yields the refusal plus one request draft (the second exit).
"""

from __future__ import annotations

import pytest

from app.services.bot import acquire_tagged_thread
from app.services.tweet_ingest import Resolution, resolve_threads

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
