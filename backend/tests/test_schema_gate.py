"""The schema gate holds a scheduler service while the database is behind the alembic head."""

from __future__ import annotations

import pytest

from app import schema_gate
from app.database import engine


def _head_and_previous() -> tuple[str, str]:
    script = schema_gate.script_directory()
    head = script.get_current_head()
    assert head is not None
    revisions = [rev.revision for rev in script.walk_revisions()]
    assert len(revisions) > 1, "the chain needs a revision below head"
    return head, revisions[1]


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def test_a_database_at_head_passes_without_waiting():
    clock = _Clock()
    schema_gate.wait_for_schema_head(engine, sleep=clock.sleep, clock=lambda: clock.now)
    assert clock.slept == []


def test_a_database_behind_head_waits_until_the_migration_lands(monkeypatch):
    head, previous = _head_and_previous()
    seen = iter([None, previous, previous, head])
    monkeypatch.setattr(schema_gate, "_db_revision", lambda _engine: next(seen))
    clock = _Clock()

    schema_gate.wait_for_schema_head(engine, sleep=clock.sleep, clock=lambda: clock.now)

    assert clock.slept == [schema_gate.POLL_SECONDS] * 3


def test_a_database_ahead_of_the_code_passes(monkeypatch):
    monkeypatch.setattr(
        schema_gate, "_db_revision", lambda _engine: "a_revision_from_a_later_commit"
    )
    clock = _Clock()
    schema_gate.wait_for_schema_head(engine, sleep=clock.sleep, clock=lambda: clock.now)
    assert clock.slept == []


def test_a_migration_that_never_lands_exits_non_zero_and_pages(monkeypatch):
    _, previous = _head_and_previous()
    monkeypatch.setattr(schema_gate, "_db_revision", lambda _engine: previous)
    captured: list[str] = []
    monkeypatch.setattr(schema_gate.sentry_sdk, "capture_message", captured.append)
    clock = _Clock()

    with pytest.raises(SystemExit):
        schema_gate.wait_for_schema_head(engine, sleep=clock.sleep, clock=lambda: clock.now)

    assert clock.now >= schema_gate.TIMEOUT_SECONDS
    assert len(captured) == 1
