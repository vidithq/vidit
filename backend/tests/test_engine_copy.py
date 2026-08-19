"""One sentence per code, and every code has one.

Three surfaces show the engine's codes to an analyst: the bot's in-thread
reply, the archive's outcome email and the paste's response, which the import
panel renders. They read one table, so the three cannot describe one code
differently, and this pins that the table covers the whole vocabulary rather
than whichever codes existed when it was written.
"""

from __future__ import annotations

import pytest

from app.services.bot import REPLY_MAX_WEIGHTED_LEN, reply_weighted_len
from app.services.tweet_ingest import REFUSAL_MESSAGES, WARNING_MESSAGES
from app.services.tweet_ingest import resolve as engine


def _declared_codes() -> set[str]:
    """Every code constant the engine declares, read off the module itself.

    A code is an upper-case module constant whose value is its own name folded
    down, which is how ``resolve`` spells all of them. Reading them rather than
    restating them is what makes this test fail on a code added without copy,
    instead of on the day someone remembers to update a second list.
    """
    return {
        value
        for name, value in vars(engine).items()
        if name.isupper() and isinstance(value, str) and value == name.lower()
    }


def test_every_code_has_exactly_one_message() -> None:
    worded = set(WARNING_MESSAGES) | set(REFUSAL_MESSAGES)
    assert worded == _declared_codes()
    # A code is a warning or a refusal, never both: the two tables partition the
    # vocabulary, and a surface picks its table by what it is reporting.
    assert not set(WARNING_MESSAGES) & set(REFUSAL_MESSAGES)


@pytest.mark.parametrize("message", [*WARNING_MESSAGES.values(), *REFUSAL_MESSAGES.values()])
def test_a_message_fits_the_tightest_surface(message: str) -> None:
    """The bot's reply is the tightest surface the table serves: it wraps a
    message in a ⚠ line beside a header and a footer, and X 403s an over-long
    create call. Sentences are held short enough that a reply carrying one is
    never near the cap."""
    assert message
    assert message == message.strip()
    assert "\n" not in message
    # A third of the reply, which leaves room for the header, the footer and
    # the other warnings a pass can raise alongside this one.
    assert reply_weighted_len(message) <= REPLY_MAX_WEIGHTED_LEN // 3


@pytest.mark.parametrize("message", [*WARNING_MESSAGES.values(), *REFUSAL_MESSAGES.values()])
def test_a_message_carries_no_link(message: str) -> None:
    """The reply is linkless by contract: X bills a link-carrying post about 13
    times a plain one, so the clickable link lives in the bot bio."""
    assert "http" not in message
    assert "www." not in message
    assert ".com" not in message
