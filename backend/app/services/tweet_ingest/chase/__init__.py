"""Chase the footage a post points at: one module per technology, one dispatcher.

A "chase" is the single fetch the ingestion spends on a post's declared source,
to turn a bare link into the footage behind it (its date, its media, and for an
X status its author and text). One module per technology serves one host
family, all with the same signature:

    chase(target, *, client) -> ChaseResult

:func:`chase_thread` is the one chase step, and every entry runs it once its
records are built. It reads what the thread declares, picks at most one target
and hands it to :func:`chase_post`, which asks each chaser in turn. A chaser
recognises its own host and answers ``no_target`` for everything else, so no
caller names a technology: :func:`apply_chase` places whatever comes back.

Every chase is fail-soft: an unreachable post, a refusing upstream or an
unparseable payload reads as "no footage", never as a failure of the import.
The class of the failure still travels (``records.ChaseOutcome``), stamped on
the record that declared the target, because a source nobody could read right
now is a different thing to tell the analyst than a source with no footage.
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

    ``target`` is the URL a post linked, or a bare X status id (which is all an
    export holds for a quote). Each chaser answers ``no_target`` for a host it
    does not serve, which is what hands the target to the next one; the last
    answer stands when none of them serves it. ``client`` is for tests (a
    ``MockTransport``); production passes ``None``.
    """
    chased = x.chase(target, client=client)
    if chased.outcome != "no_target":
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


def _declares(record: TweetRecord, target: str) -> bool:
    """Whether ``record`` is the one that named ``target``, by quote id or by
    link, so the chase lands on the record the analyst wrote it in."""
    return record.quoted_status_id == target or any(
        link.url == target for link in record.external_sources
    )


def chase_thread(
    records: list[TweetRecord], *, client: httpx.Client | None = None
) -> list[TweetRecord]:
    """``records`` with the thread's one chase target resolved onto it.

    The one chase step, run once a thread's records are built: the live
    acquisition on its one hop, the archive backfill on each stitched
    self-thread. At most one fetch per thread, and the thread names its target
    one of two ways.

    A quote names it by post id, when the records do not already carry the
    quoted post: an export holds the id alone for a post outside the export,
    while syndication embeds the post and the export joins its own. Failing a
    quote, the thread's sole source candidate names it by URL
    (``resolve.sole_candidate``, so the chase can never fetch a link the
    resolution will not store), and a chase that comes back authored by the
    thread's own author is a cross-reference to their own post, not footage.

    A thread that already carries a quote chases nothing, since a quote outranks
    every link at resolution; nor does an ambiguous thread, whose source slot
    stays empty for review. Fail-soft: a chase that yields nothing leaves the
    records as they were, bar the class of the failure, which is stamped on the
    record that declared the target (``TweetRecord.chase_outcome``) so the
    resolution can tell an unreadable source from a source with no footage.
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
        # A link to the analyst's own post that slipped the URL-level own-handle
        # exclusion (the handle-less ``i/web/status`` form) is a cross-reference,
        # never footage. A quote is exempt: quoting one's own post declares it as
        # the source, which is what the export's in-archive join stores too.
        return records
    return [
        apply_chase(record, chased) if _declares(record, target) else record for record in records
    ]
