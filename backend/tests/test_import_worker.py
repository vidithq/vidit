"""The worker pass: one queue that raises never holds back the others or the jobs, the
expired-upload reaper runs at start and once an hour, and the mentions catch-up is checked at
start, hourly and when the clock passes the daily slot, and pulls only when due."""

from __future__ import annotations

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path

_SCRIPT = Path(__file__).parent.parent / "scripts" / "run_import_worker.py"


def _worker():
    spec = importlib.util.spec_from_file_location("run_import_worker", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_failing_notification_drain_leaves_the_rest_of_the_pass(monkeypatch):
    worker = _worker()
    captured: list[BaseException | None] = []
    ran: list[str] = []

    def broken(_db):
        raise RuntimeError("notification queue broke")

    async def jobs(_db):
        ran.append("jobs and mentions")
        return 2

    monkeypatch.setattr(worker, "drain_notification_emails", broken)
    monkeypatch.setattr(worker, "_drain_both", jobs)
    monkeypatch.setattr(worker.sentry_sdk, "capture_exception", lambda: captured.append(None))

    assert worker._drain(reap=False, catch_up=False) == 2
    assert ran == ["jobs and mentions"]
    assert len(captured) == 1


def test_the_catch_up_runs_only_when_configured_and_due(monkeypatch):
    worker = _worker()
    pulled: list[str] = []

    def catch_up(_db):
        pulled.append("pulled")
        return worker.bot.BotRunOutcome(mentions_seen=3, queued=2)

    async def jobs(_db):
        return 0

    monkeypatch.setattr(worker.bot, "catch_up", catch_up)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)

    monkeypatch.setattr(worker.bot, "is_configured", lambda: False)
    assert worker._drain(reap=True, catch_up=True) == 0
    assert pulled == []

    monkeypatch.setattr(worker.bot, "is_configured", lambda: True)
    monkeypatch.setattr(worker.bot, "catch_up_due", lambda _db: True)
    assert worker._drain(reap=False, catch_up=False) == 0
    assert pulled == []
    assert worker._drain(reap=True, catch_up=True) == 2
    assert pulled == ["pulled"]


def test_a_recent_pull_skips_the_catch_up_unless_forced(monkeypatch):
    worker = _worker()
    pulled: list[str] = []

    def catch_up(_db):
        pulled.append("pulled")
        return worker.bot.BotRunOutcome(mentions_seen=1, queued=1)

    async def jobs(_db):
        return 0

    monkeypatch.setattr(worker.bot, "is_configured", lambda: True)
    monkeypatch.setattr(worker.bot, "catch_up_due", lambda _db: False)
    monkeypatch.setattr(worker.bot, "catch_up", catch_up)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)

    # A restart after today's pull: the start-up check reads no mentions.
    assert worker._drain(reap=True, catch_up=True) == 0
    assert pulled == []
    # ``IMPORT_WORKER_ONCE`` forces one.
    assert worker._drain(reap=True, catch_up=True, force_catch_up=True) == 1
    assert pulled == ["pulled"]


def test_a_failing_catch_up_leaves_the_rest_of_the_pass(monkeypatch):
    worker = _worker()
    captured: list[BaseException | None] = []

    def broken(_db):
        raise RuntimeError("mentions pull failed")

    async def jobs(_db):
        return 1

    monkeypatch.setattr(worker.bot, "is_configured", lambda: True)
    monkeypatch.setattr(worker.bot, "catch_up_due", lambda _db: True)
    monkeypatch.setattr(worker.bot, "catch_up", broken)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)
    monkeypatch.setattr(worker.sentry_sdk, "capture_exception", lambda: captured.append(None))

    assert worker._drain(reap=True, catch_up=True) == 1
    assert len(captured) == 1


def test_the_expired_uploads_are_reaped_on_the_hourly_tick_only(monkeypatch):
    worker = _worker()
    reaped: list[str] = []
    captured: list[BaseException | None] = []

    async def jobs(_db):
        return 1

    monkeypatch.setattr(worker.bot, "is_configured", lambda: False)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)
    monkeypatch.setattr(worker, "reap_expired_uploads", lambda _db: reaped.append("reaped") or 4)
    monkeypatch.setattr(worker.sentry_sdk, "capture_exception", lambda: captured.append(None))

    assert worker._drain(reap=False, catch_up=False) == 1
    assert reaped == []
    # Reaped rows are not work handled: the count stays the jobs'.
    assert worker._drain(reap=True, catch_up=True) == 1
    assert reaped == ["reaped"]

    def broken(_db):
        raise RuntimeError("reaper broke")

    monkeypatch.setattr(worker, "reap_expired_uploads", broken)
    assert worker._drain(reap=True, catch_up=True) == 1
    assert len(captured) == 1


def test_the_loop_checks_the_catch_up_at_start_hourly_and_at_the_slot_only(monkeypatch):
    worker = _worker()
    checked: list[datetime] = []
    clock = [datetime(2026, 11, 10, 11, 58, 30, tzinfo=UTC)]

    async def jobs(_db):
        return 0

    def due(_db):
        checked.append(clock[0])
        return False

    monkeypatch.setattr(worker.bot, "is_configured", lambda: True)
    monkeypatch.setattr(worker.bot, "catch_up_due", due)
    monkeypatch.setattr(worker, "reap_expired_uploads", lambda _db: 0)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)

    cadence = worker._Cadence(clock[0])
    # One pass every 5 seconds, as an idle worker runs, until 12:01.
    while clock[0] < datetime(2026, 11, 10, 12, 1, tzinfo=UTC):
        reap, catch_up = cadence.tick(clock[0])
        worker._drain(reap=reap, catch_up=catch_up)
        clock[0] += timedelta(seconds=5)

    assert checked == [
        datetime(2026, 11, 10, 11, 58, 30, tzinfo=UTC),
        datetime(2026, 11, 10, 12, 0, 0, tzinfo=UTC),
    ]


def test_the_cadence_reaps_hourly_and_checks_at_the_next_slot():
    worker = _worker()
    start = datetime(2026, 11, 10, 9, 30, tzinfo=UTC)
    cadence = worker._Cadence(start)

    assert cadence.tick(start) == (True, True)
    assert cadence.tick(start + timedelta(minutes=59)) == (False, False)
    assert cadence.tick(start + timedelta(hours=1)) == (True, True)
    assert cadence.tick(start + timedelta(hours=2, minutes=1)) == (True, True)
    # 11:59 then 12:00: the slot fires off the hourly tick.
    assert cadence.tick(datetime(2026, 11, 10, 11, 59, tzinfo=UTC)) == (False, False)
    assert cadence.tick(datetime(2026, 11, 10, 12, 0, tzinfo=UTC)) == (False, True)
    assert cadence.tick(datetime(2026, 11, 10, 12, 0, 5, tzinfo=UTC)) == (False, False)
