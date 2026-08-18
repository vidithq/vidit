"""The data half of the two ingest migrations, run over representative rows.

``alembic upgrade`` exercises the schema half on every test run; the backfills
are what a fresh database never touches, because there is nothing to move. They
are the half that decides whether the drafts an analyst already holds keep
matching after the migration, so each revision's statement is table-parameterised
and run here against a scratch table in the pre-migration shape.
"""

from __future__ import annotations

import importlib.util
import pathlib
import uuid

import pytest
from sqlalchemy import text

from app.database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _load_migration(stem: str):
    """One migration module, loaded by path.

    ``alembic/versions`` is not a package, so a revision is imported through the
    file loader rather than a normal import. Only its SQL builders are read; the
    ``op``-driven schema half is what ``alembic upgrade`` exercises.
    """
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / f"{stem}.py"
    spec = importlib.util.spec_from_file_location(stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def events_table(db):
    """A scratch table in the pre-migration events shape, dropped afterwards.

    The backfills run against this rather than against ``events``: the live
    table is already migrated, and both statements are table-parameterised
    precisely so their data half stays testable.
    """
    name = f"events_backfill_{uuid.uuid4().hex[:8]}"
    db.execute(
        text(
            f"""
            CREATE TABLE {name} (
                id UUID PRIMARY KEY,
                detected_from_url TEXT,
                detected_from_tweet_id BIGINT,
                detected_thread_tweet_ids BIGINT[]
            )
            """
        )
    )
    db.commit()
    yield name
    db.execute(text(f"DROP TABLE {name}"))
    db.commit()


def _insert_urls(db, table: str, urls: dict[str, str | None]) -> dict[str, uuid.UUID]:
    ids = {label: uuid.uuid4() for label in urls}
    for label, url in urls.items():
        db.execute(
            text(f"INSERT INTO {table} (id, detected_from_url) VALUES (:id, :url)"),
            {"id": ids[label], "url": url},
        )
    db.commit()
    return ids


def _tweet_ids(db, table: str, ids: dict[str, uuid.UUID]) -> dict[str, int | None]:
    rows = dict(
        db.execute(text(f"SELECT id, detected_from_tweet_id FROM {table}")).all()  # type: ignore[arg-type]
    )
    return {label: rows[event_id] for label, event_id in ids.items()}


def test_the_tweet_id_backfill_reads_every_spelling_of_one_post(db, events_table):
    """One post spells its URL several ways, and the id is what keeps the
    spellings on one draft, so each of them has to parse."""
    migration = _load_migration("d2f4h6j8l0n2_event_detected_from_tweet_id")
    ids = _insert_urls(
        db,
        events_table,
        {
            "x": "https://x.com/analyst/status/1940000000000000001",
            "twitter": "https://twitter.com/Analyst/status/1940000000000000001",
            "i_web": "https://x.com/i/web/status/1940000000000000001",
            "query": "https://x.com/analyst/status/1940000000000000001?s=20&t=abc",
            "trailing_slash": "https://x.com/analyst/status/1940000000000000001/",
            "photo": "https://x.com/analyst/status/1940000000000000001/photo/1",
        },
    )

    db.execute(text(migration.backfill_tweet_id_sql(events_table)))
    db.commit()

    parsed = _tweet_ids(db, events_table, ids)
    assert set(parsed.values()) == {1940000000000000001}


def test_the_tweet_id_backfill_leaves_an_unparseable_url_null(db, events_table):
    """A row the pattern cannot read keeps a NULL id and dedups on its source
    URL alone, which is what it did before the column existed."""
    migration = _load_migration("d2f4h6j8l0n2_event_detected_from_tweet_id")
    ids = _insert_urls(
        db,
        events_table,
        {
            "profile": "https://x.com/analyst",
            "no_digits": "https://x.com/analyst/status/notanid",
            "over_bigint": "https://x.com/analyst/status/9999999999999999999",
            "null_url": None,
            "good": "https://x.com/analyst/status/42",
        },
    )

    db.execute(text(migration.backfill_tweet_id_sql(events_table)))
    db.commit()

    parsed = _tweet_ids(db, events_table, ids)
    assert parsed == {
        "profile": None,
        "no_digits": None,
        "over_bigint": None,
        "null_url": None,
        "good": 42,
    }


def test_the_thread_backfill_seeds_each_row_with_its_own_anchor(db, events_table):
    """A row written before the array matched on its anchor alone, so that is
    exactly the thread it is given; a row with no anchor keeps NULL rather than
    an array holding one."""
    migration = _load_migration("e3g5i7k9m1o3_event_detected_thread_and_via")
    anchored, unanchored = uuid.uuid4(), uuid.uuid4()
    db.execute(
        text(f"INSERT INTO {events_table} (id, detected_from_tweet_id) VALUES (:id, 1234)"),
        {"id": anchored},
    )
    db.execute(
        text(f"INSERT INTO {events_table} (id, detected_from_tweet_id) VALUES (:id, NULL)"),
        {"id": unanchored},
    )
    db.commit()

    db.execute(text(migration.backfill_thread_ids_sql(events_table)))
    db.commit()

    rows = dict(
        db.execute(text(f"SELECT id, detected_thread_tweet_ids FROM {events_table}")).all()  # type: ignore[arg-type]
    )
    assert rows[anchored] == [1234]
    assert rows[unanchored] is None
