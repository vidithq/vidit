"""Chase the footage a post points at: one module per technology, one dispatcher.

A "chase" is the single fetch the ingestion spends on a post's declared source,
to turn a bare link into the footage behind it (its date, its media, and for an
X status its author and text). One module per technology serves one host
family, all with the same signature:

    chase(target, *, client) -> ChasedPost | None

:func:`chase_post` is the entry every caller uses. Each chaser recognises its
own host and answers ``None`` for everything else, so the dispatcher is the
order it asks in, and the two call sites (``acquire`` for the live entries,
``archive`` for the export) name no technology at all: they hand over a URL and
place whatever comes back with :func:`apply_chase`.

Every chase is fail-soft: an unreachable post, a refusing upstream or an
unparseable payload reads as "no footage", never as a failure of the import.
"""

from __future__ import annotations

import dataclasses

import httpx

from ..records import ChasedPost, QuotedTweet, TelegramFootage, TweetRecord
from . import telegram, x

__all__ = ["ChasedPost", "apply_chase", "chase_post"]


def chase_post(target: str, *, client: httpx.Client | None = None) -> ChasedPost | None:
    """The footage post ``target`` names, chased by the module serving its host.

    ``target`` is the URL a post linked, or a bare X status id (which is all an
    export holds for a quote). ``None`` when no technology here serves the
    target or the chase came back empty. ``client`` is for tests (a
    ``MockTransport``); production passes ``None``.
    """
    chased = x.chase(target, client=client)
    if chased is not None:
        return chased
    return telegram.chase(target, client=client)


def apply_chase(record: TweetRecord, chased: ChasedPost) -> TweetRecord:
    """``record`` with ``chased`` in the slot its shape fits.

    A post the model has an author and a text for goes in the quoted-post slot,
    anything else in the off-platform footage slot; this is the one place that
    mapping is made, so no caller has to know which technology answered. An
    existing quote is never overwritten: a quote the analyst wrote outranks a
    link the chase followed.
    """
    if chased.status_id is not None:
        quoted = QuotedTweet(
            tweet_id=chased.status_id,
            handle=chased.author or "",
            text=chased.text,
            created_at=chased.posted_at or "",
            media=list(chased.media),
        )
        return dataclasses.replace(record, quoted=record.quoted or quoted)
    return dataclasses.replace(
        record,
        telegram=TelegramFootage(
            url=chased.url, posted_at=chased.posted_at, media=list(chased.media)
        ),
    )
