"""The worker pass: one queue that raises never holds back the others or the jobs, and the
mentions catch-up and the expired-upload reaper run at start and once per interval."""

from __future__ import annotations

import importlib.util
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

    assert worker._drain(catch_up=False) == 2
    assert ran == ["jobs and mentions"]
    assert len(captured) == 1


def test_the_catch_up_runs_only_when_configured_and_due(monkeypatch):
    worker = _worker()
    pulled: list[str] = []

    def catch_up(_db):
        pulled.append("pulled")
        return worker.bot.BotRunOutcome(mentions_seen=3, already_handled=1)

    async def jobs(_db):
        return 0

    monkeypatch.setattr(worker.bot, "catch_up", catch_up)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)

    monkeypatch.setattr(worker.bot, "is_configured", lambda: False)
    assert worker._drain(catch_up=True) == 0
    assert pulled == []

    monkeypatch.setattr(worker.bot, "is_configured", lambda: True)
    assert worker._drain(catch_up=False) == 0
    assert pulled == []
    assert worker._drain(catch_up=True) == 2
    assert pulled == ["pulled"]


def test_a_failing_catch_up_leaves_the_rest_of_the_pass(monkeypatch):
    worker = _worker()
    captured: list[BaseException | None] = []

    def broken(_db):
        raise RuntimeError("mentions pull failed")

    async def jobs(_db):
        return 1

    monkeypatch.setattr(worker.bot, "is_configured", lambda: True)
    monkeypatch.setattr(worker.bot, "catch_up", broken)
    monkeypatch.setattr(worker, "drain_notification_emails", lambda _db: 0)
    monkeypatch.setattr(worker, "_drain_both", jobs)
    monkeypatch.setattr(worker.sentry_sdk, "capture_exception", lambda: captured.append(None))

    assert worker._drain(catch_up=True) == 1
    assert len(captured) == 1


def test_the_expired_uploads_are_reaped_on_the_catch_up_cadence_only(monkeypatch):
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

    assert worker._drain(catch_up=False) == 1
    assert reaped == []
    # Reaped rows are not work handled: the count stays the jobs'.
    assert worker._drain(catch_up=True) == 1
    assert reaped == ["reaped"]

    def broken(_db):
        raise RuntimeError("reaper broke")

    monkeypatch.setattr(worker, "reap_expired_uploads", broken)
    assert worker._drain(catch_up=True) == 1
    assert len(captured) == 1
