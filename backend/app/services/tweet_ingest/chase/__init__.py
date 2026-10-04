"""Chase the footage a post points at: one module per technology, one dispatcher.

A chase is the single fetch spent on a post's declared source, turning a link
into its date, media and (for X) author and text. Each technology module
exposes ``chase(target, *, client) -> ChaseResult`` and answers ``no_target``
for hosts it does not serve.

:func:`chase_thread` is the one chase step every entry runs once its records
are built; :func:`apply_chase` places the result.

Every chase is fail-soft: a failure reads as "no footage", never fails the
import. The failure class still travels (``records.ChaseOutcome``) on the
declaring record, since "could not read it now" differs from "no footage".
"""

from __future__ import annotations

import dataclasses

import httpx

from ..records import ChasedPost, ChaseResult, QuotedTweet, TelegramFootage, TweetRecord
from ..resolve import sole_candidate
from . import telegram, x

__all__ = ["apply_chase", "chase_post", "chase_thread"]


def chase_post(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """The footage post ``target`` names, chased by the module serving its host.

    ``target`` is a linked URL or a bare X status id (all an export holds for a
    quote). ``no_target`` hands it to the next chaser; the last answer stands.
    ``client`` is for tests (a ``MockTransport``).
    """
    chased = x.chase(target, client=client)
    if chased.outcome != "no_target":
        return chased
    return telegram.chase(target, client=client)


def apply_chase(record: TweetRecord, chased: ChasedPost) -> TweetRecord:
    """``record`` with ``chased`` in the slot its shape fits: a post with a
    status id goes in the quoted slot, anything else in the off-platform slot.
    An existing quote is never overwritten (it outranks a followed link).
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


def _declares(record: TweetRecord, target: str) -> bool:
    """Whether ``record`` named ``target``, by quote id or link."""
    return record.quoted_status_id == target or any(
        link.url == target for link in record.external_sources
    )


def chase_thread(
    records: list[TweetRecord], *, client: httpx.Client | None = None
) -> list[TweetRecord]:
    """``records`` with the thread's one chase target resolved onto it.

    At most one fetch per thread. The target is a quoted post id the records do
    not already carry (an export holds only the id for a post outside it), else
    the thread's sole source candidate URL (``resolve.sole_candidate``, so the
    chase never fetches a link the resolution will not store). A chase authored
    by the thread's own author is a self-reference, not footage.

    A thread that already carries a quote chases nothing (a quote outranks every
    link), nor does an ambiguous thread. Fail-soft: a failed chase leaves the
    records as they were, bar ``TweetRecord.chase_outcome`` on the declaring
    record.
    """
    if any(record.quoted is not None for record in records):
        return records
    quoted_id = next(
        (record.quoted_status_id for record in records if record.quoted_status_id is not None),
        None,
    )
    target = quoted_id if quoted_id is not None else sole_candidate(records)
    if target is None:
        return records
    result = chase_post(target, client=client)
    chased = result.post
    if chased is None:
        return [
            dataclasses.replace(record, chase_outcome=result.outcome)
            if _declares(record, target)
            else record
            for record in records
        ]
    own_handle = records[0].handle.lower() if records else ""
    if quoted_id is None and (chased.author or "").lower() == own_handle:
        # An own-post link that slipped the URL-level exclusion (the handle-less
        # ``i/web/status`` form) is a cross-reference. A quote is exempt: quoting
        # one's own post declares it as the source.
        return records
    return [
        apply_chase(record, chased) if _declares(record, target) else record for record in records
    ]
