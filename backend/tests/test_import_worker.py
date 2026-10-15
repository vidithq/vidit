"""The worker pass: one email queue that raises never holds back the others or the jobs."""

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

    def product_updates(_db):
        ran.append("product updates")
        return 1

    async def jobs(_db):
        ran.append("jobs and mentions")
        return 2

    monkeypatch.setattr(worker, "drain_notification_emails", broken)
    monkeypatch.setattr(worker, "drain_product_update_emails", product_updates)
    monkeypatch.setattr(worker, "_drain_both", jobs)
    monkeypatch.setattr(worker.sentry_sdk, "capture_exception", lambda: captured.append(None))

    assert worker._drain() == 3
    assert ran == ["product updates", "jobs and mentions"]
    assert len(captured) == 1
