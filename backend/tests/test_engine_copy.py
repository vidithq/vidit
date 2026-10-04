"""One sentence per code, and every code has one.

The bot reply, the archive outcome email and the paste response read one
table; this pins that the table covers the whole code vocabulary.
"""

from __future__ import annotations

import pytest

from app.services.bot import REPLY_MAX_WEIGHTED_LEN, reply_weighted_len
from app.services.tweet_ingest import REFUSAL_MESSAGES, WARNING_MESSAGES
from app.services.tweet_ingest import resolve as engine


def _declared_codes() -> set[str]:
    """Every upper-case module constant whose value is its own lowercased name (how ``resolve`` spells codes)."""
    return {
        value
        for name, value in vars(engine).items()
        if name.isupper() and isinstance(value, str) and value == name.lower()
    }


def test_every_code_has_exactly_one_message() -> None:
    worded = set(WARNING_MESSAGES) | set(REFUSAL_MESSAGES)
    assert worded == _declared_codes()
    # A code is a warning or a refusal, never both.
    assert not set(WARNING_MESSAGES) & set(REFUSAL_MESSAGES)


@pytest.mark.parametrize("message", [*WARNING_MESSAGES.values(), *REFUSAL_MESSAGES.values()])
def test_a_message_fits_the_tightest_surface(message: str) -> None:
    """The bot reply is the tightest surface (a ⚠ line beside a header and footer;
    X 403s an over-long post), so each message stays well under the cap."""
    assert message
    assert message == message.strip()
    assert "\n" not in message
    # A third of the reply leaves room for the header, footer and other warnings.
    assert reply_weighted_len(message) <= REPLY_MAX_WEIGHTED_LEN // 3


@pytest.mark.parametrize("message", [*WARNING_MESSAGES.values(), *REFUSAL_MESSAGES.values()])
def test_a_message_carries_no_link(message: str) -> None:
    """The reply is linkless: X bills a link-carrying post about 13 times a plain one."""
    assert "http" not in message
    assert "www." not in message
    assert ".com" not in message
