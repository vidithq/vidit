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

# Sanity guard on the staged (compressed) zip, not a product limit: the
# presigned POST policy enforces it at upload, and the enqueue + worker
# re-check it before reading the staged object. The product limits are the
# per-media caps at assemble time (``settings.max_image_size`` /
# ``settings.max_video_size``).
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

# Uncompressed-size caps: anti-zip-bomb only, sized far above any legitimate
# export so they never bind a real archive. The total bounds the disk one
# extraction can touch; the per-file bound stops one declared-huge member.
MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
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
        plan: list[tuple[str, Path, bool]] = [(tweets_member, dest_dir / _TWEETS_FILE, False)]
        for name in names:
            if name.startswith(media_prefix):
                base = PurePosixPath(name).name
                if base:
                    plan.append((name, media_dir / base, True))

        # A media member over the per-file cap is SKIPPED, not fatal: real
        # exports carry the occasional long video (a 229 MB mp4 killed a
        # 3790-post import), and downstream media intake enforces its own
        # per-type caps anyway. The per-file cap stays fatal for tweets.js,
        # and the total budget stays fatal for everyone (zip-bomb guard);
        # skipped reads still count toward it.
        total = 0
        for name, target, skippable in plan:
            total += _extract_member(
                zf, name, target, running_total=total, skip_oversized=skippable
            )


def _find_tweets_member(names: list[str]) -> str | None:
    """The member that is ``tweets.js`` under any prefix; the shortest path wins."""
    candidates = [n for n in names if n == _TWEETS_FILE or n.endswith(f"/{_TWEETS_FILE}")]
    return min(candidates, key=len) if candidates else None


def _extract_member(
    zf: zipfile.ZipFile,
    name: str,
    target: Path,
    *,
    running_total: int,
    skip_oversized: bool = False,
) -> int:
    """Copy one member to ``target`` under the size caps; return bytes read.

    Caps are checked against the bytes actually read, so a member whose declared
    ``file_size`` understates its true size still trips the limit mid-copy.
    With ``skip_oversized``, a member over the per-file cap is dropped (any
    partial ``target`` removed) instead of raising; the total budget still
    raises either way.
    """
    if zf.getinfo(name).file_size > MAX_FILE_UNCOMPRESSED_BYTES:
        if skip_oversized:
            return 0
        raise ArchiveTooLargeError("An archive file exceeds the size limit")
    written = 0
    with zf.open(name) as src, open(target, "wb") as out:
        while chunk := src.read(_CHUNK):
            written += len(chunk)
            if running_total + written > MAX_TOTAL_UNCOMPRESSED_BYTES:
                raise ArchiveTooLargeError("Archive contents exceed the size limit")
            if written > MAX_FILE_UNCOMPRESSED_BYTES:
                if skip_oversized:
                    out.close()
                    target.unlink(missing_ok=True)
                    return written
                raise ArchiveTooLargeError("Archive contents exceed the size limit")
            out.write(chunk)
    return written
