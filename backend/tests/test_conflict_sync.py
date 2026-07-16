"""Wikipedia ongoing-conflicts sync: parsing, QID identity, grace period.

The page HTML and the pageprops responses are synthetic (built to the real
page's structure: tier tables whose conflict cells nest sub-conflicts in
treelist ``<ul>``s) and served through ``httpx.MockTransport``, so no test
touches the network.
"""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.database import SessionLocal
from app.models.conflict import Conflict
from app.services.conflict_sync import (
    GRACE_PERIOD_DAYS,
    ConflictSyncError,
    extract_page_entries,
    sync_conflicts,
)

# 20 synthetic conflicts across the three ingested tiers (the sanity floor
# is 15), each mapped to a deterministic fake QID.
_NAMES = [f"Test conflict {i:02d}" for i in range(20)]
_QID_BY_NAME = {name: f"Q900{i:03d}" for i, name in enumerate(_NAMES)}


def _row(name: str, sub: str | None = None) -> str:
    sub_html = f'<ul><li><a href="/wiki/x" title="{sub}">{sub}</a></li></ul>' if sub else ""
    return (
        "<tr><td>2020</td>"
        f'<td><div class="treelist"><ul><li>'
        f'<a href="/wiki/x" title="{name}">{name}</a>{sub_html}'
        f"</li></ul></div></td><td>Continent</td></tr>"
    )


def _table(rows: list[str]) -> str:
    return (
        '<table class="wikitable"><tr><th>Start</th><th>Conflict</th><th>Where</th></tr>'
        + "".join(rows)
        + "</table>"
    )


def _page_html(names: list[str] = _NAMES, tiers: int = 3) -> str:
    headings = ["Major wars", "Minor wars", "Conflicts", "Skirmishes and clashes"]
    third = max(1, len(names) // 3)
    buckets = [names[:third], names[third : 2 * third], names[2 * third :]]
    parts = []
    for i in range(tiers):
        rows = [_row(n, sub=f"Sub-conflict of {n}") for n in buckets[i]] if i < 3 else []
        parts.append(f"<h2>{headings[i]}</h2>{_table(rows)}")
    # The skirmishes tier must be ignored even when present.
    parts.append(f"<h2>{headings[3]}</h2>{_table([_row('Skirmish entry')])}")
    return "".join(parts)


def _mock_client(html: str, qid_by_name: dict[str, str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if params.get("action") == "parse":
            return httpx.Response(200, json={"parse": {"text": html}})
        if params.get("action") == "query":
            titles = params["titles"].split("|")
            pages = [
                {"title": t, "pageprops": {"wikibase_item": qid_by_name[t]}}
                for t in titles
                if t in qid_by_name
            ]
            return httpx.Response(200, json={"query": {"pages": pages}})
        return httpx.Response(404, json={})

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def _clean_test_conflicts(db):
    """Sweep every row this module's synthetic QIDs / names could leave."""
    yield
    db.rollback()
    db.execute(
        Conflict.__table__.delete().where(
            Conflict.wikidata_id.in_(list(_QID_BY_NAME.values()))
            | Conflict.name.in_(_NAMES + ["Renamed conflict 00"])
        )
    )
    db.commit()


def test_extract_page_entries_top_level_only():
    entries = extract_page_entries(_page_html())
    # Sub-conflicts and the skirmishes tier excluded.
    assert [e.title for e in entries] == _NAMES
    # Tier follows the bucket the fixture placed each name in, start year
    # comes from the row's first cell (every fixture row says 2020).
    third = len(_NAMES) // 3
    expected_tiers = (
        ["major"] * third + ["minor"] * third + ["conflict"] * (len(_NAMES) - 2 * third)
    )
    assert [e.tier for e in entries] == expected_tiers
    assert all(e.start_year == 2020 for e in entries)


def test_extract_raises_on_missing_tier():
    with pytest.raises(ConflictSyncError, match="tier tables"):
        extract_page_entries(_page_html(tiers=2))


def test_extract_raises_when_tier_heading_has_no_table_of_its_own():
    # "Major wars" carries no table; the next tier's table follows directly.
    # The scoped lookup must not let the tableless heading claim it.
    third = len(_NAMES) // 3
    html = (
        "<h2>Major wars</h2>"
        f"<h2>Minor wars</h2>{_table([_row(n) for n in _NAMES[:third]])}"
        f"<h2>Conflicts</h2>{_table([_row(n) for n in _NAMES[third:]])}"
    )
    with pytest.raises(ConflictSyncError, match="tier tables"):
        extract_page_entries(html)


def test_extract_raises_on_implausible_count():
    with pytest.raises(ConflictSyncError, match="sanity bounds"):
        extract_page_entries(_page_html(names=_NAMES[:6]))


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_creates_rows_keyed_by_qid(db):
    with _mock_client(_page_html(), _QID_BY_NAME) as client:
        result = sync_conflicts(db, client=client)
    assert result.created == len(_NAMES)
    row = db.query(Conflict).filter(Conflict.wikidata_id == _QID_BY_NAME[_NAMES[0]]).one()
    assert row.name == _NAMES[0]
    assert row.ongoing is True
    assert row.source == "sync"
    assert row.last_seen_at is not None
    # First bucket of the fixture is the major-wars table; every fixture
    # row's start cell says 2020.
    assert row.tier == "major"
    assert row.start_year == 2020
    last = db.query(Conflict).filter(Conflict.wikidata_id == _QID_BY_NAME[_NAMES[-1]]).one()
    assert last.tier == "conflict"


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_updates_tier_but_never_clobbers_start_year(db):
    seeded = Conflict(
        name=_NAMES[0],
        wikidata_id=_QID_BY_NAME[_NAMES[0]],
        ongoing=True,
        source="seed",
        start_year=1998,
        tier="major",
    )
    db.add(seeded)
    db.commit()

    # Rotate the name to the end of the list: it lands in the conflicts
    # bucket, as if the death toll slid below the minor-wars threshold.
    rotated = [*_NAMES[1:], _NAMES[0]]
    with _mock_client(_page_html(names=rotated), _QID_BY_NAME) as client:
        sync_conflicts(db, client=client)

    db.expire_all()
    row = db.query(Conflict).filter(Conflict.wikidata_id == _QID_BY_NAME[_NAMES[0]]).one()
    assert row.tier == "conflict"  # tier follows the page
    assert row.start_year == 1998  # the more precise seed year survives


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_renames_in_place_on_same_qid(db):
    with _mock_client(_page_html(), _QID_BY_NAME) as client:
        sync_conflicts(db, client=client)
    before = db.query(Conflict).filter(Conflict.wikidata_id == _QID_BY_NAME[_NAMES[0]]).one()

    renamed = ["Renamed conflict 00", *_NAMES[1:]]
    qids = {**_QID_BY_NAME, "Renamed conflict 00": _QID_BY_NAME[_NAMES[0]]}
    with _mock_client(_page_html(names=renamed), qids) as client:
        result = sync_conflicts(db, client=client)

    assert result.renamed == 1
    assert result.created == 0
    db.expire_all()
    after = db.query(Conflict).filter(Conflict.wikidata_id == _QID_BY_NAME[_NAMES[0]]).one()
    assert after.id == before.id  # same row, events keep their association
    assert after.name == "Renamed conflict 00"


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_adopts_qidless_row_with_same_name(db):
    manual = Conflict(name=_NAMES[0], ongoing=True, source="manual")
    db.add(manual)
    db.commit()
    manual_id = manual.id

    with _mock_client(_page_html(), _QID_BY_NAME) as client:
        result = sync_conflicts(db, client=client)

    assert result.adopted == 1
    assert result.created == len(_NAMES) - 1
    db.expire_all()
    adopted = db.query(Conflict).filter(Conflict.id == manual_id).one()
    assert adopted.wikidata_id == _QID_BY_NAME[_NAMES[0]]


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_deactivates_after_grace_and_spares_unseen_rows(db):
    stale = Conflict(
        name=_NAMES[0],
        wikidata_id=_QID_BY_NAME[_NAMES[0]],
        ongoing=True,
        source="sync",
        last_seen_at=datetime.now(UTC) - timedelta(days=GRACE_PERIOD_DAYS + 1),
    )
    never_seen = Conflict(name=_NAMES[1], ongoing=True, source="manual")
    db.add_all([stale, never_seen])
    db.commit()
    stale_id, never_seen_id = stale.id, never_seen.id

    # The page now lists neither: names[2:] only (still >= sanity floor).
    remaining = _NAMES[2:]
    with _mock_client(_page_html(names=remaining), _QID_BY_NAME) as client:
        result = sync_conflicts(db, client=client)

    assert result.deactivated == 1
    db.expire_all()
    assert db.query(Conflict).filter(Conflict.id == stale_id).one().ongoing is False
    # Never synced (last_seen_at NULL): immune to the grace period.
    assert db.query(Conflict).filter(Conflict.id == never_seen_id).one().ongoing is True


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_within_grace_keeps_row_ongoing(db):
    recent = Conflict(
        name=_NAMES[0],
        wikidata_id=_QID_BY_NAME[_NAMES[0]],
        ongoing=True,
        source="sync",
        last_seen_at=datetime.now(UTC) - timedelta(days=2),
    )
    db.add(recent)
    db.commit()
    recent_id = recent.id

    with _mock_client(_page_html(names=_NAMES[2:]), _QID_BY_NAME) as client:
        result = sync_conflicts(db, client=client)

    assert result.deactivated == 0
    db.expire_all()
    assert db.query(Conflict).filter(Conflict.id == recent_id).one().ongoing is True


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_aborts_on_api_error_body(db):
    """An HTTP 200 whose JSON body carries an ``error`` key (maxlag, rate
    limit) must abort the run and write nothing."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"error": {"code": "maxlag", "info": "Waiting for a database"}}
        )

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        pytest.raises(ConflictSyncError, match="maxlag"),
    ):
        sync_conflicts(db, client=client)
    db.rollback()
    assert (
        db.query(Conflict).filter(Conflict.wikidata_id.in_(list(_QID_BY_NAME.values()))).count()
        == 0
    )


@pytest.mark.usefixtures("_clean_test_conflicts")
def test_sync_aborts_before_deactivation_when_qid_resolution_fails(db):
    """The page parses fine but pageprops resolves zero QIDs: the run must
    raise before the grace-period sweep, so a stale ongoing row is never
    aged toward deactivation by a silently failed resolution."""
    stale = Conflict(
        name=_NAMES[0],
        wikidata_id=_QID_BY_NAME[_NAMES[0]],
        ongoing=True,
        source="sync",
        last_seen_at=datetime.now(UTC) - timedelta(days=GRACE_PERIOD_DAYS + 1),
    )
    db.add(stale)
    db.commit()
    stale_id = stale.id

    # No QID mapping resolves: pageprops comes back empty for every title.
    with (
        _mock_client(_page_html(), {}) as client,
        pytest.raises(ConflictSyncError, match="resolved"),
    ):
        sync_conflicts(db, client=client)

    db.rollback()
    db.expire_all()
    assert db.query(Conflict).filter(Conflict.id == stale_id).one().ongoing is True


def test_sync_aborts_writing_nothing_on_parse_failure(db):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"parse": {"text": "<p>not the page</p>"}})

    marker = f"pre-existing-{uuid.uuid4().hex[:8]}"
    row = Conflict(name=marker, ongoing=True, source="manual")
    db.add(row)
    db.commit()
    row_id = row.id

    try:
        with (
            httpx.Client(transport=httpx.MockTransport(handler)) as client,
            pytest.raises(ConflictSyncError),
        ):
            sync_conflicts(db, client=client)
        db.expire_all()
        assert db.query(Conflict).filter(Conflict.id == row_id).one().ongoing is True
    finally:
        db.rollback()
        db.execute(Conflict.__table__.delete().where(Conflict.id == row_id))
        db.commit()
