import { unzip, zip, type Unzipped } from "fflate";

import { ApiError } from "./api";

// Allowlisted archive contents, mirroring the backend intake guard
// (`services/tweet_ingest/archive_zip.py`).
const TWEETS_FILE = "tweets.js";
const MEDIA_DIR = "tweets_media/";

/** Rough bytes per `tweets.js` record across real exports (JSON envelope +
 *  text + entities). Feeds only the cosmetic pre-import post estimate the
 *  enqueue carries; the worker's parse stamps the exact totals. */
const BYTES_PER_TWEET_ESTIMATE = 1500;

export interface StrippedArchive {
  file: File;
  /** Cosmetic volume hint for the queued-job display: `tweets.js` bytes over
   *  the per-record average, never below 1. */
  postEstimate: number;
}

/**
 * Strip an X "Download your data" zip to only the entries we read (`tweets.js`
 * and `tweets_media/`) and re-zip them, in the browser, before upload.
 *
 * The sensitive rest of the export (DMs, email, phone, account data) never
 * leaves the device, and the upload shrinks to a fraction of the original. The
 * server still runs the same copy-allowlist as defence in depth; this is the
 * privacy + size win on top.
 *
 * Only the allowlisted entries are decompressed (the `filter`, anchored so a
 * sibling like `deleted-tweets.js` isn't inflated either), so the sensitive
 * files never even inflate. The export's `data/` prefix is flattened and media
 * rebased by basename, matching what the server extracts. Throws an `ApiError`
 * carrying the same `code` the backend would (`archive_malformed` /
 * `archive_no_tweets`) so the page maps it to one message.
 */
export async function stripArchive(file: File): Promise<StrippedArchive> {
  const buf = new Uint8Array(await file.arrayBuffer());

  let kept: Unzipped;
  try {
    kept = await new Promise<Unzipped>((resolve, reject) => {
      unzip(
        buf,
        {
          // Anchor the tweets.js match (mirrors `tweetsKey` below); a loose
          // `endsWith("tweets.js")` would also inflate `deleted-tweets.js`.
          filter: (f) =>
            f.name === TWEETS_FILE ||
            f.name.endsWith(`/${TWEETS_FILE}`) ||
            f.name.includes(MEDIA_DIR),
        },
        (err, data) => (err ? reject(err) : resolve(data))
      );
    });
  } catch {
    throw new ApiError("That file isn't a valid .zip archive.", 0, "archive_malformed");
  }

  // Locate tweets.js wherever it sits (`data/` or a top folder); shortest path
  // wins. Its parent is the root the media sits beside.
  const tweetsKey = Object.keys(kept)
    .filter((n) => n === TWEETS_FILE || n.endsWith(`/${TWEETS_FILE}`))
    .sort((a, b) => a.length - b.length)[0];
  if (!tweetsKey) {
    throw new ApiError(
      "That zip isn't an X data export (no tweets.js inside).",
      0,
      "archive_no_tweets"
    );
  }
  const root = tweetsKey.slice(0, tweetsKey.length - TWEETS_FILE.length);
  const mediaPrefix = `${root}${MEDIA_DIR}`;

  const out: Record<string, Uint8Array> = { [TWEETS_FILE]: kept[tweetsKey] };
  for (const [name, bytes] of Object.entries(kept)) {
    if (name.startsWith(mediaPrefix)) {
      const base = name.slice(name.lastIndexOf("/") + 1);
      if (base) out[`${MEDIA_DIR}${base}`] = bytes;
    }
  }

  // Async (worker-backed) zip, matching the `unzip` above, so re-compressing a
  // large `tweets_media` doesn't block the main thread and freeze the tab.
  const zipped = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(out, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
  return {
    file: new File([zipped], "vidit-archive.zip", { type: "application/zip" }),
    postEstimate: Math.max(1, Math.round(kept[tweetsKey].length / BYTES_PER_TWEET_ESTIMATE)),
  };
}
