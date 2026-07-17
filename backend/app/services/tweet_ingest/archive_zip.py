"""Tweets-only intake guard for an uploaded X "Download your data" archive.

The upload is a whole ``.zip``; we extract ONLY the copy-allowlisted entries
(``tweets.js`` + ``tweets_media/``) into a clean directory and drop everything
else (DMs, email, phone, account data, ``deleted-*``). A copy-allowlist fails
safe where a delete-denylist would leak whatever new file a future export adds.

The zip is attacker-controlled, so extraction is hardened:

* zip-slip: only the basenames of allowlisted members are used, so no member can
  write outside ``dest_dir``.
* zip-bomb: a per-file and a running total uncompressed-size cap abort the
  extraction, enforced against the bytes actually read (a lying ``file_size``
  can't get past it).

The real export nests its files under ``data/`` (and may sit inside a top-level
folder); ``tweets.js`` is located wherever it is and its media rebased beside it,
so the result is the flat ``archive_dir`` that ``archive.read_tweets`` expects.
``note-tweet.js`` (long-form bodies) is a deferred follow-up, not yet read.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


class ArchiveIntakeError(Exception):
    """Base: the uploaded archive can't be safely turned into a backfill dir."""

    code = "archive_invalid"


class MalformedArchiveError(ArchiveIntakeError):
    code = "archive_malformed"


class NoTweetsFileError(ArchiveIntakeError):
    code = "archive_no_tweets"


class ArchiveTooLargeError(ArchiveIntakeError):
    code = "archive_too_large"


# The allowlisted contents: the post history and its inline images.
_TWEETS_FILE = "tweets.js"
_MEDIA_DIR = "tweets_media"

# Cap on the uploaded (compressed) zip. The import runs synchronously behind it;
# a larger archive waits for the durable-worker upgrade. Enforced while streaming
# the upload, before the zip is opened.
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Uncompressed-size caps (zip-bomb guard). The total bounds the disk a single
# import can touch; the per-file bound stops one declared-huge member.
MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_FILE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024

_CHUNK = 1024 * 1024


def extract_allowlisted(zip_path: Path, dest_dir: Path) -> None:
    """Extract the allowlisted archive entries into ``dest_dir``.

    Populates ``dest_dir`` with a flat ``tweets.js`` + ``tweets_media/`` that
    :func:`app.services.tweet_ingest.archive.read_tweets` reads, regardless of the
    ``data/`` (or top-folder) prefix the export uses. Everything outside the
    allowlist is ignored. Raises a typed :class:`ArchiveIntakeError` on a
    malformed zip, a missing ``tweets.js``, or a size-cap breach.
    """
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise MalformedArchiveError("Not a valid zip archive") from exc

    with zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        tweets_member = _find_tweets_member(names)
        if tweets_member is None:
            raise NoTweetsFileError("Archive has no tweets.js")

        # Prefix the export nests under (``data/``, ``""``, or a top folder).
        root = tweets_member[: -len(_TWEETS_FILE)]
        media_prefix = f"{root}{_MEDIA_DIR}/"

        media_dir = dest_dir / _MEDIA_DIR
        media_dir.mkdir(parents=True, exist_ok=True)

        # ``tweets.js`` to the dest root, each media file to ``tweets_media/`` by
        # basename only (so a crafted path can't escape dest_dir).
        plan: list[tuple[str, Path]] = [(tweets_member, dest_dir / _TWEETS_FILE)]
        for name in names:
            if name.startswith(media_prefix):
                base = PurePosixPath(name).name
                if base:
                    plan.append((name, media_dir / base))

        total = 0
        for name, target in plan:
            total += _extract_member(zf, name, target, running_total=total)


# Rough declared bytes per ``tweets.js`` record across real exports: the JSON
# envelope + text + entities. Only feeds the pre-import post estimate, never a
# cap; the worker's parse produces the exact totals.
_BYTES_PER_TWEET_ESTIMATE = 1500


@dataclass(frozen=True)
class ArchiveInspection:
    """What the metadata-only pass could tell about the upload: a rough post
    count (declared ``tweets.js`` size over the per-record average) and the
    media entry count. Estimates for the analyst-facing progress display, not
    contracts."""

    post_estimate: int
    media_entries: int


def inspect_archive(zip_path: Path) -> ArchiveInspection:
    """Cheap pre-enqueue validation: a metadata-only pass, no extraction.

    Lets the upload endpoint reject an obviously bad file (not a zip, no
    ``tweets.js``, declared contents over the cap) before staging it for the
    worker, so the analyst gets the 4xx synchronously instead of a failure
    email. Declared sizes can lie; :func:`extract_allowlisted` re-enforces the
    caps against the bytes actually read when the worker runs. Returns the
    volume estimates the same metadata gives for free.
    """
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise MalformedArchiveError("Not a valid zip archive") from exc

    with zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        tweets_member = _find_tweets_member(names)
        if tweets_member is None:
            raise NoTweetsFileError("Archive has no tweets.js")
        root = tweets_member[: -len(_TWEETS_FILE)]
        media_prefix = f"{root}{_MEDIA_DIR}/"
        media_entries = sum(1 for n in names if n.startswith(media_prefix))
        tweets_bytes = zf.getinfo(tweets_member).file_size
        declared = tweets_bytes + sum(
            zf.getinfo(n).file_size for n in names if n.startswith(media_prefix)
        )
        if declared > MAX_TOTAL_UNCOMPRESSED_BYTES:
            raise ArchiveTooLargeError("Archive contents exceed the size limit")
        return ArchiveInspection(
            post_estimate=max(1, round(tweets_bytes / _BYTES_PER_TWEET_ESTIMATE)),
            media_entries=media_entries,
        )


def _find_tweets_member(names: list[str]) -> str | None:
    """The member that is ``tweets.js`` under any prefix; the shortest path wins."""
    candidates = [n for n in names if n == _TWEETS_FILE or n.endswith(f"/{_TWEETS_FILE}")]
    return min(candidates, key=len) if candidates else None


def _extract_member(zf: zipfile.ZipFile, name: str, target: Path, *, running_total: int) -> int:
    """Copy one member to ``target`` under the size caps; return bytes written.

    Caps are checked against the bytes actually read, so a member whose declared
    ``file_size`` understates its true size still trips the limit mid-copy.
    """
    if zf.getinfo(name).file_size > MAX_FILE_UNCOMPRESSED_BYTES:
        raise ArchiveTooLargeError("An archive file exceeds the size limit")
    written = 0
    with zf.open(name) as src, open(target, "wb") as out:
        while chunk := src.read(_CHUNK):
            written += len(chunk)
            if (
                written > MAX_FILE_UNCOMPRESSED_BYTES
                or running_total + written > MAX_TOTAL_UNCOMPRESSED_BYTES
            ):
                raise ArchiveTooLargeError("Archive contents exceed the size limit")
            out.write(chunk)
    return written
