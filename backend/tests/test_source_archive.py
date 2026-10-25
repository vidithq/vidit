"""Tests for the check of an analyst-recorded snapshot URL.

The capture happens in the analyst's browser and the snapshot URL rides on a source link.
Under test: whether a pasted URL is a snapshot address on an accepted provider, which
provider a stored URL lives on, and whether a re-paste names the stored copy.
"""

from __future__ import annotations

import pytest

from app.models.source import SOURCE_URL_MAX_LENGTH
from app.services import source_archive

SOURCE = "https://newsdesk.example/post/1234567890"
CAPTURE_TS = "20260811120000"
WAYBACK_SNAPSHOT = f"https://web.archive.org/web/{CAPTURE_TS}/{SOURCE}"
ARCHIVE_TODAY_SNAPSHOT = "https://archive.ph/abcde"


# ── snapshot validation ────────────────────────────────────────────────


def _reject_code(snapshot: str) -> str:
    with pytest.raises(source_archive.SnapshotRejected) as excinfo:
        source_archive.validate_snapshot(snapshot)
    return excinfo.value.code


def test_a_wayback_replay_url_is_accepted():
    assert source_archive.validate_snapshot(WAYBACK_SNAPSHOT) == "wayback"


def test_a_well_formed_replay_url_is_accepted_whatever_it_replays():
    """Validation says where a snapshot lives, never what it captured. A replay URL
    naming another link is accepted: the embedded original uses whatever form the
    platform had at capture time (``youtu.be``, ``twitter.com``, ``t.me/s/``), so
    comparing would refuse correct snapshots. The form warns the analyst."""
    for embedded in (
        "https://elsewhere.test/x",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://twitter.com/analyst/status/9876543210",
    ):
        snapshot = f"https://web.archive.org/web/{CAPTURE_TS}/{embedded}"
        assert source_archive.validate_snapshot(snapshot) == "wayback"


def test_a_replay_modifier_is_accepted():
    """A link copied from the Wayback player (replay modifier on the timestamp) is still a snapshot."""
    assert (
        source_archive.validate_snapshot(f"https://web.archive.org/web/{CAPTURE_TS}id_/{SOURCE}")
        == "wayback"
    )


def test_an_archive_today_code_is_accepted():
    """The short code embeds nothing, so the shape is the whole check."""
    assert source_archive.validate_snapshot(ARCHIVE_TODAY_SNAPSHOT) == "archive_today"
    assert source_archive.validate_snapshot("https://archive.today/xY9k2/") == "archive_today"


def test_every_archive_today_mirror_is_the_same_provider():
    """archive.today serves snapshots under six interchangeable domains; refusing any refuses valid pastes."""
    for host in (
        "archive.ph",
        "archive.today",
        "archive.is",
        "archive.md",
        "archive.li",
        "archive.vn",
    ):
        assert source_archive.validate_snapshot(f"https://{host}/abcde") == "archive_today"


def test_an_archive_today_capture_url_is_accepted():
    """One capture has two addresses: the short code and ``/<timestamp>/<original url>``."""
    assert (
        source_archive.validate_snapshot(f"https://archive.ph/{CAPTURE_TS}/{SOURCE}")
        == "archive_today"
    )


def test_an_archive_today_lookup_is_still_refused():
    """``archive.ph/newest/<url>`` is not one fixed capture, and ``newest`` is not a digit timestamp, so it is refused."""
    assert _reject_code(f"https://archive.ph/newest/{SOURCE}") == "snapshot_not_a_snapshot_code"
    assert _reject_code("https://archive.ph/") == "snapshot_not_a_snapshot_code"


def test_both_ghostarchive_shapes_are_accepted():
    """A page capture and a video capture (addressed by the YouTube video id)."""
    assert (
        source_archive.validate_snapshot("https://ghostarchive.org/archive/aBcD1") == "ghostarchive"
    )
    assert (
        source_archive.validate_snapshot("https://ghostarchive.org/varchive/dQw4w9WgXcQ")
        == "ghostarchive"
    )


def test_a_ghostarchive_url_of_another_shape_is_refused():
    assert _reject_code("https://ghostarchive.org/") == "snapshot_not_a_snapshot_code"
    assert (
        _reject_code(f"https://ghostarchive.org/search/{SOURCE}") == "snapshot_not_a_snapshot_code"
    )


def test_http_is_refused():
    assert (
        _reject_code(f"http://web.archive.org/web/{CAPTURE_TS}/{SOURCE}")
        == "snapshot_url_not_https"
    )


def test_a_host_outside_the_allowlist_is_refused():
    """The allowlist bounds abuse (the catalog renders the value as an outbound link).
    The hostname is parsed, not prefix-matched, so subdomain and suffix tricks fail."""
    for host in (
        "archive.org",
        "web-archive.org.evil.example",
        "archive.ph.evil.example",
        "archive.today.evil.example",
        "ghostarchive.org.evil.example",
        "evil-archive.is",
    ):
        assert (
            _reject_code(f"https://{host}/web/{CAPTURE_TS}/{SOURCE}")
            == "snapshot_provider_not_allowed"
        )


def test_a_wayback_url_that_is_not_a_replay_url_is_refused():
    assert _reject_code("https://web.archive.org/about/") == "snapshot_not_a_replay_url"


def test_an_oversized_snapshot_is_refused():
    oversized = "https://archive.ph/" + "a" * SOURCE_URL_MAX_LENGTH
    assert _reject_code(oversized) == "snapshot_url_too_long"


# ── provider of a stored copy ──────────────────────────────────────────


def test_provider_of_reads_the_provider_off_the_host():
    assert source_archive.provider_of(WAYBACK_SNAPSHOT) == "wayback"
    assert source_archive.provider_of("https://ARCHIVE.IS/abcde") == "archive_today"
    assert source_archive.provider_of("https://ghostarchive.org/archive/aBcD1") == "ghostarchive"


def test_provider_of_a_host_outside_the_allowlist_is_none():
    assert source_archive.provider_of("https://elsewhere.example/web/1/x") is None


# ── is this paste the copy already stored ──────────────────────────────


def test_a_re_paste_of_the_stored_copy_is_the_same_snapshot():
    """Browsers add a trailing slash or change host case, so both sides are folded before a re-paste counts as a correction."""
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
