"""Recombine individual tweet records into threads — union-find on reply edges.

An OSINT geolocation often spans a self-thread: the footage in the head tweet,
the coordinate in a reply. ``stitch`` groups records that belong to the same
reply chain so ``detect`` sees the whole thread at once (head media + reply
coord).

Source-agnostic: the edges come from whatever fed the records. An archive
carries ``in_reply_to_status_id`` inline, so real self-threads assemble; the
syndication path returns one tweet with no edge, so there each record is its
own singleton thread (``stitch`` is the identity).
"""

from __future__ import annotations

from .records import TweetRecord


def stitch(records: list[TweetRecord]) -> list[list[TweetRecord]]:
    """Group ``records`` into threads by their reply edges.

    Two records join the same thread when one replies to the other (its
    ``in_reply_to_status_id`` matches a record's ``tweet_id`` *present in the
    batch* — an edge pointing outside the batch is ignored, so a reply to a
    third party's tweet doesn't pull in a stranger). Each thread is ordered by
    ``created_at`` ascending, then by tweet id (:func:`_chronological`), so the
    head (the earliest, media-carrying tweet) is first. Threads keep
    first-appearance order for determinism.
    """
    if not records:
        return []

    id_to_idx = {r.tweet_id: i for i, r in enumerate(records)}
    parent = list(range(len(records)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]  # path-halving
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, r in enumerate(records):
        pid = r.in_reply_to_status_id
        if pid is not None and pid in id_to_idx:
            union(id_to_idx[pid], i)

    groups: dict[int, list[TweetRecord]] = {}
    for i, r in enumerate(records):
        groups.setdefault(find(i), []).append(r)

    return [sorted(members, key=_chronological) for members in groups.values()]


def _chronological(record: TweetRecord) -> tuple[str, int, int]:
    """Sort key for ordering a thread head-first.

    ISO 8601 timestamps sort lexicographically by time. A missing ("") or
    non-ISO ``created_at`` (an adapter that couldn't normalise the upstream
    format) is pushed *last* so it can't hijack the head: ``detect`` anchors
    the thread's provenance + event date on ``thread[0]``.

    An archive stores ``created_at`` at second precision, so a reply posted in
    the same second as its parent ties on the timestamp, and ``tweets.js`` lists
    newest first, which would hand the head slot to the reply. The tie breaks on
    the tweet id ascending: snowflake ids are chronological at millisecond
    precision, so the lower id is the earlier post. A non-digit id (no upstream
    writes one, the archive path rejects them outright) carries no order, so it
    sorts after every digit id and keeps batch order among its peers.
    """
    created_at = record.created_at
    when = created_at if created_at and created_at[0].isdigit() else "￿"
    tweet_id = record.tweet_id
    return (when, 0, int(tweet_id)) if tweet_id.isdigit() else (when, 1, 0)
