"""Unit tests for ``stitch`` — union-find over reply edges.

Pure, no DB. Synthetic records prove the multi-edge thread assembly that the
archive feeder will exercise; the syndication path only ever hands ``stitch`` a
single record (identity), covered by the singleton case.
"""

from __future__ import annotations

from app.services.tweet_ingest import TweetRecord, stitch


def _rec(
    tweet_id: str, created_at: str, *, reply_to: str | None = None, handle: str = "an"
) -> TweetRecord:
    return TweetRecord(
        tweet_id=tweet_id,
        handle=handle,
        text=f"tweet {tweet_id}",
        created_at=created_at,
        permalink=f"https://x.com/{handle}/status/{tweet_id}",
        in_reply_to_status_id=reply_to,
    )


def test_empty_input_yields_no_threads():
    assert stitch([]) == []


def test_single_record_is_its_own_thread():
    threads = stitch([_rec("1", "2025-11-12T10:00:00Z")])
    assert len(threads) == 1
    assert [r.tweet_id for r in threads[0]] == ["1"]


def test_reply_chain_assembles_into_one_thread_head_first():
    # 2 replies to 1, 3 replies to 2 — one thread, ordered by created_at.
    records = [
        _rec("3", "2025-11-12T10:02:00Z", reply_to="2"),
        _rec("1", "2025-11-12T10:00:00Z"),
        _rec("2", "2025-11-12T10:01:00Z", reply_to="1"),
    ]
    threads = stitch(records)
    assert len(threads) == 1
    assert [r.tweet_id for r in threads[0]] == ["1", "2", "3"]


def test_unrelated_records_stay_separate():
    records = [_rec("1", "2025-11-12T10:00:00Z"), _rec("9", "2025-11-12T11:00:00Z")]
    threads = stitch(records)
    assert {tuple(r.tweet_id for r in t) for t in threads} == {("1",), ("9",)}


def test_edge_pointing_outside_batch_is_ignored():
    # Reply to a third party's tweet not in the batch — no stranger pulled in.
    threads = stitch([_rec("5", "2025-11-12T10:00:00Z", reply_to="999")])
    assert len(threads) == 1
    assert [r.tweet_id for r in threads[0]] == ["5"]


def test_malformed_timestamp_does_not_hijack_the_head():
    # An empty / non-ISO created_at must sort LAST, not become the head — detect
    # anchors provenance + event_date on thread[0].
    records = [
        _rec("2", "", reply_to="1"),  # missing timestamp
        _rec("1", "2025-11-12T10:00:00Z"),  # the real head
        _rec("3", "Wed Nov 12 10:05:00 +0000 2025", reply_to="1"),  # non-ISO
    ]
    threads = stitch(records)
    assert len(threads) == 1
    assert threads[0][0].tweet_id == "1"


def test_first_appearance_order_of_threads_is_stable():
    records = [
        _rec("1", "2025-11-12T10:00:00Z"),
        _rec("2", "2025-11-12T10:01:00Z", reply_to="1"),
        _rec("9", "2025-11-12T09:00:00Z"),
    ]
    threads = stitch(records)
    # Thread of 1/2 appears before the singleton 9 (root 1 seen first).
    assert [t[0].tweet_id for t in threads] == ["1", "9"]
