"""Tests for analyst-recorded source archival.

Nothing here talks to an archiving service, because nothing in the module does:
the capture happens in the analyst's browser and the server only checks and
stores what comes back. What is under test is therefore the two halves of that
check (is this one of the event's links, and is this URL a snapshot of it) and
the one-slot write.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models.event import (
    SOURCE_URL_MAX_LENGTH,
    STATUS_DETECTED,
    Event,
    EventSourceLink,
)
from app.models.source_archive import SourceArchive
from app.models.user import User
from app.services import source_archive
from app.services.auth import hash_password
from app.services.sanitize import extract_link_hrefs

SOURCE = "https://newsdesk.example/post/1234567890"
PROOF_LINK = "https://example.org/report"
MIRROR = "https://t.me/channel/42"
DETECTED_FROM = "https://x.com/analyst/status/9876543210"
CAPTURE_TS = "20260811120000"
WAYBACK_SNAPSHOT = f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"
ARCHIVE_TODAY_SNAPSHOT = "https://archive.ph/abcde"


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def owner(db):
    user = User(
        username=f"arc{uuid.uuid4().hex[:8]}",
        email=f"arc-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _proof_doc(*hrefs: str) -> dict:
    """A Tiptap document whose paragraph carries one link mark per href."""
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "see this",
                        "marks": [{"type": "link", "attrs": {"href": href}}],
                    }
                    for href in hrefs
                ],
            }
        ],
    }


@pytest.fixture
def event(db, owner):
    row = Event(
        owner_id=owner.id,
        title="Archived event",
        source_url=SOURCE,
        proof=_proof_doc(PROOF_LINK),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    yield row
    db.expire_all()
    db.query(Event).filter(Event.id == row.id).delete(synchronize_session=False)
    db.commit()


def _with_mirrors(db, event, *urls: str) -> Event:
    """Give an event the ordered secondary source links ``urls``."""
    event.source_links = [
        EventSourceLink(position=index, url=url) for index, url in enumerate(urls)
    ]
    db.commit()
    db.refresh(event)
    return event


# ── link collection ────────────────────────────────────────────────────


def test_extract_link_hrefs_reads_link_marks_and_dedupes():
    doc = _proof_doc(PROOF_LINK, PROOF_LINK, "https://example.org/other")
    assert extract_link_hrefs(doc) == [PROOF_LINK, "https://example.org/other"]


def test_extract_link_hrefs_drops_non_http_schemes():
    doc = _proof_doc("javascript:alert(1)", PROOF_LINK)
    assert extract_link_hrefs(doc) == [PROOF_LINK]


def test_collect_links_orders_source_first_and_tags_origin(event):
    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (PROOF_LINK, "proof_link"),
    ]


def test_collect_links_drops_a_url_the_parse_refuses(db, owner):
    """The archivable set is ``sanitize.safe_link_href``, so a scheme the proof
    editor would refuse is not one an analyst can record a copy for."""
    row = Event(
        owner_id=owner.id,
        title="Bad link",
        source_url=SOURCE,
        proof=_proof_doc("mailto:someone@example.com"),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    assert source_archive.collect_links(row) == [(SOURCE, "source_url")]


def test_collect_links_drops_an_oversized_url(db, owner):
    """Past the ``source_url`` ceiling the value could not be stored anyway, so
    it never reaches the unique index it would abort."""
    oversized = "https://example.org/" + "x" * SOURCE_URL_MAX_LENGTH
    row = Event(
        owner_id=owner.id,
        title="Long link",
        source_url=SOURCE,
        proof=_proof_doc(oversized),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    assert source_archive.collect_links(row) == [(SOURCE, "source_url")]


def test_collect_links_attributes_a_shared_link_to_the_source(db, owner):
    """A link that is both the declared source and a proof citation is one
    link, kept under the strongest provenance the walk reaches first."""
    row = Event(
        owner_id=owner.id,
        title="Cited source",
        source_url=SOURCE,
        proof=_proof_doc(SOURCE),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    assert source_archive.collect_links(row) == [(SOURCE, "source_url")]


def test_collect_links_includes_the_secondary_source_links(db, event):
    _with_mirrors(db, event, MIRROR)
    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (MIRROR, "secondary_source"),
        (PROOF_LINK, "proof_link"),
    ]


def test_collect_links_includes_the_provenance_link(db, event):
    """The analyst's own post carries the geolocation claim, and rots the same
    way the footage source does."""
    event.detected_from_url = DETECTED_FROM
    db.commit()
    db.refresh(event)

    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (DETECTED_FROM, "detected_from"),
        (PROOF_LINK, "proof_link"),
    ]


def test_collect_links_keeps_a_mirror_of_the_source_url_once(db, event):
    """A mirror repeating the declared source is one link, not two."""
    _with_mirrors(db, event, SOURCE, MIRROR)
    assert source_archive.collect_links(event) == [
        (SOURCE, "source_url"),
        (MIRROR, "secondary_source"),
        (PROOF_LINK, "proof_link"),
    ]


def test_origin_of_answers_membership_and_label_together(db, event):
    _with_mirrors(db, event, MIRROR)
    assert source_archive.origin_of(event, SOURCE) == "source_url"
    assert source_archive.origin_of(event, MIRROR) == "secondary_source"
    assert source_archive.origin_of(event, PROOF_LINK) == "proof_link"
    assert source_archive.origin_of(event, "https://elsewhere.example/x") is None


# ── snapshot validation ────────────────────────────────────────────────


def _reject_code(original: str, snapshot: str) -> str:
    with pytest.raises(source_archive.SnapshotRejected) as excinfo:
        source_archive.validate_snapshot(original_url=original, snapshot_url=snapshot)
    return excinfo.value.code


def test_a_wayback_replay_url_of_the_link_is_accepted():
    assert (
        source_archive.validate_snapshot(original_url=SOURCE, snapshot_url=WAYBACK_SNAPSHOT)
        == "wayback"
    )


def test_an_archive_today_code_is_accepted():
    """The short code embeds nothing, so the shape is the whole check."""
    assert (
        source_archive.validate_snapshot(original_url=SOURCE, snapshot_url=ARCHIVE_TODAY_SNAPSHOT)
        == "archive_today"
    )
    assert (
        source_archive.validate_snapshot(
            original_url=SOURCE, snapshot_url="https://archive.today/xY9k2/"
        )
        == "archive_today"
    )


def test_http_is_refused():
    assert (
        _reject_code(SOURCE, f"http://web.archive.org/web/{CAPTURE_TS}/{SOURCE}")
        == "snapshot_url_not_https"
    )


def test_a_host_outside_the_allowlist_is_refused():
    """The allowlist is the abuse bound: the catalog renders the value as an
    outbound link, so a lookalike host is not "an archiving service"."""
    for host in ("archive.org", "web-archive.org.evil.example", "archive.ph.evil.example"):
        assert (
            _reject_code(SOURCE, f"https://{host}/web/{CAPTURE_TS}/{SOURCE}")
            == "snapshot_provider_not_allowed"
        )


def test_a_wayback_url_that_is_not_a_replay_url_is_refused():
    assert _reject_code(SOURCE, "https://web.archive.org/about/") == "snapshot_not_a_replay_url"


def test_a_wayback_replay_of_another_link_is_refused():
    """The embedded original is what makes the snapshot this link's."""
    assert (
        _reject_code(SOURCE, f"https://web.archive.org/web/{CAPTURE_TS}/https://elsewhere.test/x")
        == "snapshot_original_mismatch"
    )


@pytest.mark.parametrize(
    "embedded",
    [
        # Wayback settles on its own scheme for the crawled URL.
        "http://newsdesk.example/post/1234567890",
        # A copied link picks up or loses a trailing slash on the way through
        # a browser.
        "https://newsdesk.example/post/1234567890/",
        # The host is folded to lower case, and ``www.`` is not an identity.
        "https://WWW.Newsdesk.Example/post/1234567890",
    ],
)
def test_a_replay_url_naming_the_same_page_is_accepted(embedded):
    """A difference that names the same page is not a different link. Rejecting
    these would refuse correct snapshots for spelling alone."""
    snapshot = f"https://web.archive.org/web/{CAPTURE_TS}/{embedded}"
    assert source_archive.validate_snapshot(original_url=SOURCE, snapshot_url=snapshot) == "wayback"


def test_a_replay_url_keeps_the_originals_query_string():
    """The embedded original's query is parsed off the replay URL, so it has to
    be put back before the two are compared."""
    original = "https://newsdesk.example/post?id=42"
    snapshot = f"https://web.archive.org/web/{CAPTURE_TS}/{original}"
    assert (
        source_archive.validate_snapshot(original_url=original, snapshot_url=snapshot) == "wayback"
    )
    assert (
        _reject_code(original, f"https://web.archive.org/web/{CAPTURE_TS}/{original}&extra=1")
        == "snapshot_original_mismatch"
    )


def test_a_replay_modifier_is_accepted():
    """The Wayback player appends a replay modifier to the timestamp; a link
    copied out of it is still a snapshot of the page."""
    snapshot = f"https://web.archive.org/web/{CAPTURE_TS}id_/{SOURCE}"
    assert source_archive.validate_snapshot(original_url=SOURCE, snapshot_url=snapshot) == "wayback"


def test_an_archive_today_url_carrying_a_path_is_refused():
    """``archive.ph/newest/<url>`` is a lookup, not a snapshot: it resolves to
    whatever the service holds today rather than to a fixed capture."""
    assert (
        _reject_code(SOURCE, f"https://archive.ph/newest/{SOURCE}")
        == "snapshot_not_a_snapshot_code"
    )
    assert _reject_code(SOURCE, "https://archive.ph/") == "snapshot_not_a_snapshot_code"


def test_an_oversized_snapshot_is_refused():
    oversized = "https://archive.ph/" + "a" * SOURCE_URL_MAX_LENGTH
    assert _reject_code(SOURCE, oversized) == "snapshot_url_too_long"


# ── storing a copy ─────────────────────────────────────────────────────


def _stage(db, event, url, snapshot):
    """Stage the copy the way a write path does: resolve the origin, then upsert."""
    origin = source_archive.origin_of(event, url)
    assert origin is not None
    source_archive.stage_snapshot(
        db, event=event, original_url=url, origin=origin, snapshot_url=snapshot
    )
    db.commit()


def test_staging_stores_the_copy_with_its_provider_and_origin(db, event):
    _stage(db, event, SOURCE, WAYBACK_SNAPSHOT)

    stored = db.query(SourceArchive).filter(SourceArchive.event_id == event.id).all()
    assert [(r.original_url, r.origin) for r in stored] == [(SOURCE, "source_url")]
    assert [(r.snapshot_url, r.provider) for r in stored] == [(WAYBACK_SNAPSHOT, "wayback")]


def test_staging_overwrites_the_slot_on_a_resubmission(db, event):
    """One copy per link is what makes a second paste the owner's correction
    path rather than a competing row."""
    _stage(db, event, SOURCE, WAYBACK_SNAPSHOT)
    _stage(db, event, SOURCE, ARCHIVE_TODAY_SNAPSHOT)

    stored = db.query(SourceArchive).filter(SourceArchive.event_id == event.id).all()
    assert len(stored) == 1
    assert (stored[0].snapshot_url, stored[0].provider) == (
        ARCHIVE_TODAY_SNAPSHOT,
        "archive_today",
    )


def test_a_link_the_event_does_not_carry_has_no_origin(db, event):
    """``origin_of`` is the membership test every path runs before it files a
    copy, so a URL the event never declared resolves to nothing."""
    assert source_archive.origin_of(event, "https://elsewhere.example/x") is None


def test_every_kind_of_link_the_event_carries_has_its_own_origin(db, event):
    """The source, a mirror, the provenance link and a proof citation are all
    archivable, each stored under its own origin."""
    event.detected_from_url = DETECTED_FROM
    _with_mirrors(db, event, MIRROR)

    for url in (SOURCE, MIRROR, DETECTED_FROM, PROOF_LINK):
        _stage(db, event, url, ARCHIVE_TODAY_SNAPSHOT)

    stored = db.query(SourceArchive).filter(SourceArchive.event_id == event.id).all()
    assert {r.original_url: r.origin for r in stored} == {
        SOURCE: "source_url",
        MIRROR: "secondary_source",
        DETECTED_FROM: "detected_from",
        PROOF_LINK: "proof_link",
    }


def test_archive_row_for_matches_a_link_by_url(db, event):
    _stage(db, event, PROOF_LINK, ARCHIVE_TODAY_SNAPSHOT)
    db.refresh(event)

    assert source_archive.archive_row_for(event, PROOF_LINK).snapshot_url == (
        ARCHIVE_TODAY_SNAPSHOT
    )
    assert source_archive.archive_row_for(event, SOURCE) is None
    assert source_archive.archive_row_for(event, None) is None


# ── is this paste the copy already stored ──────────────────────────────


def test_a_re_paste_of_the_stored_copy_is_the_same_snapshot():
    """A snapshot URL reaches the form through a browser, which is where a
    trailing slash and a host in another case come from. The fold is the one
    ``validate_snapshot`` uses, so the two never disagree about "same URL"."""
    assert source_archive.same_snapshot(WAYBACK_SNAPSHOT, WAYBACK_SNAPSHOT)
    assert source_archive.same_snapshot(WAYBACK_SNAPSHOT, f"{WAYBACK_SNAPSHOT}/")
    assert source_archive.same_snapshot(
        WAYBACK_SNAPSHOT, WAYBACK_SNAPSHOT.replace("web.archive.org", "WEB.ARCHIVE.ORG")
    )


def test_a_different_copy_is_not_the_same_snapshot():
    assert not source_archive.same_snapshot(WAYBACK_SNAPSHOT, ARCHIVE_TODAY_SNAPSHOT)
    # A link holding no copy is never matched by a paste.
    assert not source_archive.same_snapshot(None, WAYBACK_SNAPSHOT)
    # A capture at another timestamp is another copy, not a spelling of this one.
    assert not source_archive.same_snapshot(
        WAYBACK_SNAPSHOT, WAYBACK_SNAPSHOT.replace(CAPTURE_TS, "20270101000000")
    )


def test_the_provider_constraint_rejects_an_unknown_service(db, event):
    """The Literal is pinned at the database too, so a row written outside the
    service cannot introduce a provider the read surface has no glyph for."""
    db.add(
        SourceArchive(
            event_id=event.id,
            original_url=SOURCE,
            origin="source_url",
            snapshot_url=WAYBACK_SNAPSHOT,
            provider="somewhere_else",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
