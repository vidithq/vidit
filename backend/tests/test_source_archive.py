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


_ARCHIVE_TODAY_MIRRORS = (
    "archive.ph",
    "archive.today",
    "archive.is",
    "archive.md",
    "archive.li",
    "archive.vn",
)


@pytest.mark.parametrize(
    ("snapshot", "provider"),
    [
        pytest.param(WAYBACK_SNAPSHOT, "wayback", id="wayback-replay"),
        # Validation says where a snapshot lives, never what it captured: the embedded original
        # keeps whatever form the platform had at capture time, so comparing would refuse
        # correct snapshots. The form warns the analyst.
        *(
            pytest.param(
                f"https://web.archive.org/web/{CAPTURE_TS}/{embedded}",
                "wayback",
                id=f"replays-{embedded}",
            )
            for embedded in (
                "https://elsewhere.test/x",
                "https://youtu.be/dQw4w9WgXcQ",
                "https://twitter.com/analyst/status/9876543210",
            )
        ),
        # A link copied from the Wayback player keeps the replay modifier on the timestamp.
        pytest.param(
            f"https://web.archive.org/web/{CAPTURE_TS}id_/{SOURCE}", "wayback", id="replay-modifier"
        ),
        # The short code embeds nothing, so the shape is the whole check.
        pytest.param(
            "https://archive.today/xY9k2/", "archive_today", id="archive-today-trailing-slash"
        ),
        # archive.today serves snapshots under six interchangeable domains.
        *(
            pytest.param(f"https://{host}/abcde", "archive_today", id=f"mirror-{host}")
            for host in _ARCHIVE_TODAY_MIRRORS
        ),
        # One capture has two addresses: the short code and ``/<timestamp>/<original url>``.
        pytest.param(
            f"https://archive.ph/{CAPTURE_TS}/{SOURCE}", "archive_today", id="archive-today-capture"
        ),
        # A page capture and a video capture (addressed by the YouTube video id).
        pytest.param(
            "https://ghostarchive.org/archive/aBcD1", "ghostarchive", id="ghostarchive-page"
        ),
        pytest.param(
            "https://ghostarchive.org/varchive/dQw4w9WgXcQ", "ghostarchive", id="ghostarchive-video"
        ),
    ],
)
def test_validate_snapshot_accepts(snapshot, provider):
    assert source_archive.validate_snapshot(snapshot) == provider


@pytest.mark.parametrize(
    ("snapshot", "code"),
    [
        # ``newest`` is not one fixed capture, nor a digit timestamp.
        pytest.param(
            f"https://archive.ph/newest/{SOURCE}",
            "snapshot_not_a_snapshot_code",
            id="archive-today-lookup",
        ),
        pytest.param(
            "https://archive.ph/", "snapshot_not_a_snapshot_code", id="archive-today-root"
        ),
        pytest.param(
            "https://ghostarchive.org/", "snapshot_not_a_snapshot_code", id="ghostarchive-root"
        ),
        pytest.param(
            f"https://ghostarchive.org/search/{SOURCE}",
            "snapshot_not_a_snapshot_code",
            id="ghostarchive-search",
        ),
        pytest.param(
            f"http://web.archive.org/web/{CAPTURE_TS}/{SOURCE}", "snapshot_url_not_https", id="http"
        ),
        # The allowlist bounds abuse (the catalog renders the value as an outbound link). The
        # hostname is parsed, not prefix-matched, so subdomain and suffix tricks fail.
        *(
            pytest.param(
                f"https://{host}/web/{CAPTURE_TS}/{SOURCE}",
                "snapshot_provider_not_allowed",
                id=f"host-{host}",
            )
            for host in (
                "archive.org",
                "web-archive.org.evil.example",
                "archive.ph.evil.example",
                "archive.today.evil.example",
                "ghostarchive.org.evil.example",
                "evil-archive.is",
            )
        ),
        pytest.param(
            "https://web.archive.org/about/", "snapshot_not_a_replay_url", id="wayback-not-replay"
        ),
        pytest.param(
            "https://archive.ph/" + "a" * SOURCE_URL_MAX_LENGTH,
            "snapshot_url_too_long",
            id="oversized",
        ),
    ],
)
def test_validate_snapshot_refuses(snapshot, code):
    assert _reject_code(snapshot) == code


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
