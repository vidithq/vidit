import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";

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

const anchoredTweetsMatch = (name: string) =>
  name === TWEETS_FILE || name.endsWith(`/${TWEETS_FILE}`);

/**
 * Strip an X "Download your data" zip to only the entries we read (`tweets.js`
 * and `tweets_media/`) and re-zip them, in the browser, before upload.
 *
 * The sensitive rest of the export (DMs, email, phone, account data) never
 * leaves the device, and the upload shrinks to a fraction of the original. The
 * server still runs the same copy-allowlist as defence in depth; this is the
 * privacy + size win on top.
 *
 * STREAMING, deliberately: the buffered version (arrayBuffer + unzip + zip)
 * held the input zip, the inflated media, and the recompressed output in
 * memory at once (measured ~3.3x the archive size), which crashed the tab on
 * a real 770 MB export. Here the input is read in chunks, media entries flow
 * STORED into the output (`ZipPassThrough`, no inflate + re-deflate: they are
 * jpg/mp4, recompression buys nothing), and only `tweets.js` is buffered,
 * then deflated. Peak extra memory is about one output-size.
 *
 * Only the allowlisted entries are ever decompressed (files we don't
 * `start()` never inflate; the tweets.js match is anchored so a sibling like
 * `deleted-tweets.js` isn't picked up either). Media is rebased by basename
 * under `tweets_media/`, matching what the server extracts. Any
 * `tweets_media/` directory in the export is included (the buffered version
 * narrowed to the one beside the shortest-path tweets.js after the fact;
 * real X exports only ever have one, and the server's allowlist re-strips
 * the upload regardless). Throws an `ApiError` carrying the same `code` the
 * backend would (`archive_malformed` / `archive_no_tweets`) so the page maps
 * it to one message.
 */
export async function stripArchive(file: File): Promise<StrippedArchive> {
  // A zip opens with a PK signature; the streaming parser scans permissively
  // instead of throwing on garbage, so sniff up front to keep the
  // malformed-vs-empty distinction the page relies on.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b)) {
    throw new ApiError("That file isn't a valid .zip archive.", 0, "archive_malformed");
  }

  const outChunks: Uint8Array[] = [];
  let zipDone: (() => void) | null = null;
  let zipFail: ((e: unknown) => void) | null = null;
  const zipEnded = new Promise<void>((resolve, reject) => {
    zipDone = resolve;
    zipFail = reject;
  });
  const out = new Zip((err, chunk, final) => {
    if (err) {
      zipFail?.(err);
      return;
    }
    if (chunk) outChunks.push(chunk);
    if (final) zipDone?.();
  });

  // tweets.js candidates buffer until the whole archive has streamed (the
  // shortest path wins, and order of appearance is not guaranteed).
  const tweetsCandidates = new Map<string, Uint8Array[]>();
  const seenMedia = new Set<string>();
  const failures: unknown[] = [];

  const unz = new Unzip();
  unz.register(UnzipInflate);
  unz.onfile = (entry) => {
    const { name } = entry;
    if (anchoredTweetsMatch(name)) {
      const chunks: Uint8Array[] = [];
      tweetsCandidates.set(name, chunks);
      entry.ondata = (err, data) => {
        if (err) failures.push(err);
        else if (data) chunks.push(data);
      };
      entry.start();
      return;
    }
    if (name.includes(MEDIA_DIR)) {
      const base = name.slice(name.lastIndexOf("/") + 1);
      if (!base || seenMedia.has(base)) return; // directory entry or dup basename
      seenMedia.add(base);
      const pass = new ZipPassThrough(`${MEDIA_DIR}${base}`);
      out.add(pass);
      entry.ondata = (err, data, final) => {
        if (err) {
          failures.push(err);
          pass.push(new Uint8Array(0), true);
          return;
        }
        pass.push(data ?? new Uint8Array(0), final);
      };
      entry.start();
    }
    // Everything else (DMs, account data, …) is never started: it does not
    // inflate and never reaches the output.
  };

  // Pump the file through in slices; the slice size bounds resident input
  // memory. `slice().arrayBuffer()` rather than `File.stream()`: identical
  // memory profile, and it also exists in jsdom, where the tests run.
  const CHUNK = 4 * 1024 * 1024;
  try {
    for (let off = 0; off < file.size; off += CHUNK) {
      const part = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
      unz.push(part, false);
    }
    unz.push(new Uint8Array(0), true);
  } catch {
    throw new ApiError("That file isn't a valid .zip archive.", 0, "archive_malformed");
  }
  if (failures.length > 0) {
    throw new ApiError("That file isn't a valid .zip archive.", 0, "archive_malformed");
  }

  const tweetsKey = [...tweetsCandidates.keys()].sort((a, b) => a.length - b.length)[0];
  if (!tweetsKey) {
    throw new ApiError(
      "That zip isn't an X data export (no tweets.js inside).",
      0,
      "archive_no_tweets"
    );
  }
  const tweetsChunks = tweetsCandidates.get(tweetsKey) ?? [];
  const tweetsBytes = tweetsChunks.reduce((acc, c) => acc + c.length, 0);
  const tweets = new ZipDeflate(TWEETS_FILE, { level: 6 });
  out.add(tweets);
  for (const chunk of tweetsChunks) tweets.push(chunk, false);
  tweets.push(new Uint8Array(0), true);
  out.end();
  await zipEnded;

  return {
    file: new File(outChunks as BlobPart[], "vidit-archive.zip", {
      type: "application/zip",
    }),
    postEstimate: Math.max(1, Math.round(tweetsBytes / BYTES_PER_TWEET_ESTIMATE)),
  };
}
