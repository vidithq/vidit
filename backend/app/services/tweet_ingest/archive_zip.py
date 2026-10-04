"""Tweets-only intake guard for an uploaded X "Download your data" archive.

Only the copy-allowlisted entries (``tweets.js`` + ``tweets_media/``) are
extracted; everything else (DMs, email, phone, account data) is dropped. A
copy-allowlist fails safe where a denylist would leak a future export's new file.

The zip is attacker-controlled, so extraction is hardened:

* zip-slip: only basenames of allowlisted members are used.
* zip-bomb: per-file and running-total size caps, enforced on the bytes
  actually read (a lying ``file_size`` cannot pass).

``tweets.js`` is located under any prefix (``data/``, a top folder) and its media
rebased beside it, giving the flat ``archive_dir`` ``archive.read_tweets`` expects.
Mirrored in the browser by ``frontend/src/lib/archive.ts`` (keep-allowlist,
root discovery, ``MAX_UPLOAD_BYTES``); change both.
"""

from __future__ import annotations

import zipfile
from pathlib import Path, PurePosixPath


class ArchiveIntakeError(Exception):
    """The uploaded archive cannot be safely turned into a backfill dir."""

    code = "archive_invalid"


class MalformedArchiveError(ArchiveIntakeError):
    code = "archive_malformed"


class NoTweetsFileError(ArchiveIntakeError):
    code = "archive_no_tweets"


class ArchiveTooLargeError(ArchiveIntakeError):
    code = "archive_too_large"


_TWEETS_FILE = "tweets.js"
_MEDIA_DIR = "tweets_media"

# Sanity guard on the compressed zip, not a product limit (those are the
# per-media caps at assemble time). Enforced by the presigned POST policy and
# re-checked at enqueue and in the worker. Under S3's 5 GB single-part POST
# ceiling. Mirrored by ``frontend/src/lib/archive.ts``.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024

# Anti-zip-bomb caps, far above any real export: total bounds disk use,
# per-file stops one huge member.
MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
MAX_FILE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024

# Anti-inode-exhaustion: real exports have a few thousand media files; an
# attacker could pack millions of empty entries that pass every byte cap.
MAX_ENTRY_COUNT = 100_000

_CHUNK = 1024 * 1024


def extract_allowlisted(zip_path: Path, dest_dir: Path) -> None:
    """Extract the allowlisted entries into ``dest_dir`` as a flat ``tweets.js`` +
    ``tweets_media/`` for :func:`app.services.tweet_ingest.archive.read_tweets`.

    Raises :class:`ArchiveIntakeError` on a malformed zip, a missing
    ``tweets.js``, or a size-cap breach.
    """
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise MalformedArchiveError("Not a valid zip archive") from exc

    with zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if len(names) > MAX_ENTRY_COUNT:
            raise ArchiveTooLargeError("Archive has too many entries")
        tweets_member = _find_tweets_member(names)
        if tweets_member is None:
            raise NoTweetsFileError("Archive has no tweets.js")

        root = tweets_member[: -len(_TWEETS_FILE)]
        media_prefix = f"{root}{_MEDIA_DIR}/"

        media_dir = dest_dir / _MEDIA_DIR
        media_dir.mkdir(parents=True, exist_ok=True)

        # Basename only, so a crafted path cannot escape dest_dir.
        plan: list[tuple[str, Path, bool]] = [(tweets_member, dest_dir / _TWEETS_FILE, False)]
        for name in names:
            if name.startswith(media_prefix):
                base = PurePosixPath(name).name
                if base:
                    plan.append((name, media_dir / base, True))

        # An oversized media member is skipped, not fatal: real exports carry
        # long videos (a 229 MB mp4 once killed a 3790-post import) and media
        # intake enforces its own caps. The per-file cap stays fatal for
        # tweets.js and the total budget for all; skipped reads count toward it.
        total = 0
        for name, target, skippable in plan:
            total += _extract_member(
                zf, name, target, running_total=total, skip_oversized=skippable
            )


def _find_tweets_member(names: list[str]) -> str | None:
    """The ``tweets.js`` member under any prefix; the shortest path wins."""
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

    Caps apply to the bytes actually read, so an understated ``file_size`` still
    trips mid-copy. With ``skip_oversized``, a member over the per-file cap is
    dropped (partial ``target`` removed) instead of raising; the total budget
    always raises.
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
