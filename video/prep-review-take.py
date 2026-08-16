"""Build the trimmed X export the v0.5 promo B imports on camera, and report
what importing it will do to the instance.

The take films a real archive import. Since v0.5.2 an import matches what it
already produced and updates it in place, so what a given export does to a
given instance is not obvious from the export alone. This script answers that
question before the shoot instead of leaving the take to discover it:

  1. It reads the owner's own export with the backend's own ingest modules
     (``read_tweets`` then ``stitch`` then ``detect``), so the detections it
     reports are the ones the import will produce.
  2. It replays ``_disposition``'s matching rule against the database, read
     only, to label each detection ``create``, ``update`` or ``skip``.
  3. It writes a trimmed copy of the export carrying the threads the take wants
     and their media.

Trimming to a subset of the owner's own posts is what the import panel itself
recommends ("Trim it to your posts"), and it keeps the recorded import inside a
single take: a full export runs to gigabytes and re-processes every draft it
ever produced.

This script never writes to the database. The only file it writes is the
trimmed zip.

Usage (from the repo root, with the backend venv):

  backend/.venv/bin/python video/prep-review-take.py \
      --archive "/path/to/export.zip" --username MPGeoint --report
  backend/.venv/bin/python video/prep-review-take.py \
      --archive "/path/to/export.zip" --username MPGeoint \
      --creating --threads 12 --out video/out/import-trimmed.zip
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import shutil
import sys
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.tweet_ingest.archive import read_tweets  # noqa: E402
from app.services.tweet_ingest.detect import detect  # noqa: E402
from app.services.tweet_ingest.stitch import stitch  # noqa: E402

# The disposition compares coordinates rounded to this many places, mirroring
# ``_COORD_PLACES`` in app/services/detection.py.
COORD_PLACES = 6

TWEETS_FILE = "tweets.js"
MEDIA_DIR = "tweets_media/"


def db_url() -> str:
    """The local instance's database, read from backend/.env like the app does."""
    env = REPO_ROOT / "backend" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("no DATABASE_URL in backend/.env or the environment")
    return url


def archive_root(zf: zipfile.ZipFile) -> tuple[str, str]:
    """Return the export's ``tweets.js`` path and the prefix it sits under.

    Mirrors the root discovery in frontend/src/lib/archive.ts: anchor on a whole
    path segment so ``deleted-tweets.js`` cannot pass for the real file.
    """
    candidates = [
        n
        for n in zf.namelist()
        if n.endswith(TWEETS_FILE) and posixpath.basename(n) == TWEETS_FILE
    ]
    if not candidates:
        raise SystemExit("that zip is not an X data export (no tweets.js inside)")
    tweets = min(candidates, key=len)
    return tweets, tweets[: -len(TWEETS_FILE)]


def load_detections(zip_path: Path, handle: str) -> list[dict]:
    """Every detection the import would produce from ``zip_path``.

    Only ``tweets.js`` is unpacked: the media never has to touch the disk to
    decide which threads to take.
    """
    with zipfile.ZipFile(zip_path) as zf:
        tweets_name, _ = archive_root(zf)
        tmp = Path(tempfile.mkdtemp(prefix="promo-b-"))
        try:
            data_dir = tmp / "data"
            data_dir.mkdir()
            with zf.open(tweets_name) as src, open(data_dir / TWEETS_FILE, "wb") as dst:
                shutil.copyfileobj(src, dst)
            threads = stitch(read_tweets(data_dir, handle=handle))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    out: list[dict] = []
    for thread in threads:
        ids = [r.tweet_id for r in thread]
        for geo in detect(thread):
            out.append(
                {
                    "detected_from_url": geo.detected_from_url,
                    "source_url": geo.source_url,
                    "lat": round(float(geo.coordinate.lat), COORD_PLACES),
                    "lng": round(float(geo.coordinate.lng), COORD_PLACES),
                    "title": geo.title,
                    "event_date": geo.event_date.isoformat() if geo.event_date else None,
                    "thread_ids": ids,
                    "thread_key": ids[0],
                    "has_source_media": bool(geo.source_media),
                    "has_proof_media": bool(geo.proof_media),
                }
            )
    return out


def load_rows(conn, username: str) -> list[dict]:
    """The owner's placed events, with everything ``_disposition`` looks at."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select e.id::text,
                   coalesce(e.detected_from_url, ''),
                   coalesce(e.source_url, ''),
                   round(ST_Y(e.event_coords::geometry)::numeric, %s),
                   round(ST_X(e.event_coords::geometry)::numeric, %s),
                   e.status::text,
                   (e.deleted_at is not null),
                   (e.hidden_at is not null)
              from events e
              join users u on u.id = e.owner_id
             where u.username = %s
               and e.event_coords is not null
            """,
            (COORD_PLACES, COORD_PLACES, username),
        )
        return [
            {
                "id": r[0],
                "detected_from_url": r[1],
                "source_url": r[2],
                "lat": round(float(r[3]), COORD_PLACES),
                "lng": round(float(r[4]), COORD_PLACES),
                "status": r[5],
                "deleted": r[6],
                "hidden": r[7],
            }
            for r in cur.fetchall()
        ]


def matches(row: dict, det: dict) -> bool:
    """``_disposition``'s candidate rule: provenance or source URL, same point."""
    same_url = row["detected_from_url"] == det["detected_from_url"] or (
        det["source_url"] is not None
        and row["source_url"] != ""
        and row["source_url"] == det["source_url"]
    )
    return same_url and row["lat"] == det["lat"] and row["lng"] == det["lng"]


def verdict(det: dict, rows: list[dict]) -> str:
    """``create`` / ``update`` / ``skip`` for one detection."""
    cands = [r for r in rows if matches(r, det)]
    if not cands:
        return "create"
    if any(c["deleted"] or c["hidden"] or c["status"] != "detected" for c in cands):
        return "skip"
    return "update"


def blockers(det: dict) -> list[str]:
    """The queue's readiness blockers, mirroring ``batchCompletionBlockers``."""
    out = []
    if not det["source_url"]:
        out.append("Source URL")
    if not det["has_source_media"]:
        out.append("Source media")
    if not det["has_proof_media"]:
        out.append("Proof image")
    return out


def write_trimmed(source: Path, dest: Path, tweet_ids: set[str]) -> None:
    """Copy the export down to the selected posts and their media.

    Keeps the export's own layout (``<root>/data/tweets.js`` beside
    ``tweets_media/``) so the browser's strip pass and the backend read it
    exactly as they read a full export.
    """
    with zipfile.ZipFile(source) as zf:
        tweets_name, root = archive_root(zf)
        raw = zf.read(tweets_name).decode("utf-8")
        prefix_re = re.compile(r"^\s*window\.YTD\.\w[\w-]*\.part\d+\s*=\s*")
        prefix = prefix_re.match(raw).group(0)
        entries = json.loads(prefix_re.sub("", raw, count=1))
        kept = [e for e in entries if e.get("tweet", {}).get("id_str") in tweet_ids]

        media_prefix = f"{root}{MEDIA_DIR}"
        media = [
            n
            for n in zf.namelist()
            if n.startswith(media_prefix)
            and posixpath.basename(n).split("-", 1)[0] in tweet_ids
        ]

        dest.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as out:
            out.writestr(tweets_name, prefix + json.dumps(kept, indent=2))
            for name in media:
                with zf.open(name) as src:
                    out.writestr(name, src.read())
    size = dest.stat().st_size
    print(
        f"wrote {dest} ({size / 1024 / 1024:.1f} MB, "
        f"{len(kept)} posts, {len(media)} media files)"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Trim an X export for the promo take.")
    ap.add_argument("--archive", required=True, help="the owner's own X export (.zip)")
    ap.add_argument("--username", required=True, help="the Vidit account that owns it")
    ap.add_argument("--out", default=str(REPO_ROOT / "video" / "out" / "import-trimmed.zip"))
    ap.add_argument(
        "--report",
        action="store_true",
        help="print what a full re-import would do, write nothing",
    )
    ap.add_argument(
        "--creating",
        action="store_true",
        help="keep every thread whose detections the instance does not hold",
    )
    ap.add_argument(
        "--threads",
        type=int,
        default=0,
        help="add this many further recent threads (they import as updates)",
    )
    args = ap.parse_args()

    # psycopg2 is what the backend venv carries; the queries here are plain
    # DB-API and read only.
    import psycopg2 as psycopg

    source = Path(args.archive)
    conn = psycopg.connect(db_url())
    with conn.cursor() as cur:
        cur.execute("select x_handle, username from users where username = %s", (args.username,))
        row = cur.fetchone()
    if not row:
        raise SystemExit(f"no account {args.username} on this instance")
    handle = row[0] or row[1]

    dets = load_detections(source, handle)
    rows = load_rows(conn, args.username)
    print(f"archive: {len(dets)} detections · instance: {len(rows)} placed events for {args.username}")

    for det in dets:
        det["verdict"] = verdict(det, rows)
    counts = defaultdict(int)
    for det in dets:
        counts[det["verdict"]] += 1
    print(f"a re-import of the whole export: {dict(counts)}")

    creating = [d for d in dets if d["verdict"] == "create"]
    print(f"\ndetections the instance does not hold ({len(creating)}):")
    for det in creating:
        mark = "ready to review" if not blockers(det) else "missing: " + ", ".join(blockers(det))
        print(f"  · {det['event_date']}  {det['title'][:52]:52s}  {mark}")

    if args.report:
        print("\n--report: nothing written")
        return

    by_thread: dict[str, list[dict]] = defaultdict(list)
    for det in dets:
        by_thread[det["thread_key"]].append(det)

    def recency(key: str) -> str:
        return max((d["event_date"] or "") for d in by_thread[key])

    keys: list[str] = []
    if args.creating:
        keys = sorted({d["thread_key"] for d in creating}, key=recency, reverse=True)
    # Then the most recent threads, up to --threads in total. They already
    # exist on the instance, so they import as updates: they give the
    # extraction step something to count through on camera.
    for key in sorted(by_thread, key=recency, reverse=True):
        if len(keys) >= args.threads:
            break
        if key not in keys:
            keys.append(key)

    if not keys:
        raise SystemExit("nothing selected: pass --creating and/or --threads")

    picked = [d for k in keys for d in by_thread[k]]
    picked_counts = defaultdict(int)
    for det in picked:
        picked_counts[det["verdict"]] += 1
    print(
        f"\ntrimmed export: {len(keys)} threads, {len(picked)} detections "
        f"({dict(picked_counts)})"
    )

    tweet_ids = {i for k in keys for d in by_thread[k] for i in d["thread_ids"]}
    write_trimmed(source, Path(args.out), tweet_ids)


if __name__ == "__main__":
    main()
