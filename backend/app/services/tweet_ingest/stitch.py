"""Recombine tweet records into threads (union-find on reply edges).

A geolocation often spans a self-thread (footage in the head, coordinate in a
reply). An archive carries ``in_reply_to_status_id``, so threads assemble; the
syndication path returns one tweet with no edge, so ``stitch`` is the identity.
"""

from __future__ import annotations

from .records import TweetRecord


def stitch(records: list[TweetRecord]) -> list[list[TweetRecord]]:
    """Group ``records`` into threads by reply edges.

    An edge to a tweet outside the batch is ignored, so a reply to a stranger
    pulls nothing in. Each thread is ordered by :func:`_chronological`, head
    first. Threads keep first-appearance order.
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
    """Sort key ordering a thread head-first.

    ISO 8601 timestamps sort lexicographically. A missing or non-ISO
    ``created_at`` sorts last so it cannot take the head, which anchors the
    thread's provenance and event date.

    An archive has second precision and ``tweets.js`` lists newest first, so a
    same-second reply would take the head. Ties break on tweet id ascending
    (snowflake ids are chronological to the millisecond). A non-digit id sorts
    after every digit id, in batch order.
    """
    created_at = record.created_at
    when = created_at if created_at and created_at[0].isdigit() else "￿"
    tweet_id = record.tweet_id
    return (when, 0, int(tweet_id)) if tweet_id.isdigit() else (when, 1, 0)
