import { Zip, type ZipInputFile } from "fflate";

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

const malformed = () =>
  new ApiError("That file isn't a valid .zip archive.", 0, "archive_malformed");

// One central-directory record, resolved to what the copy needs.
interface CdEntry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  headerOffset: number;
}

const sliceBytes = async (file: File, start: number, end: number) =>
  new Uint8Array(await file.slice(start, end).arrayBuffer());

/**
 * Parse the end-of-central-directory record (and its zip64 variant when the
 * classic record overflows) into the central directory's offset and size.
 * The EOCD sits in the last 22..65557 bytes (its comment is bounded).
 */
async function readCentralDirectory(file: File): Promise<CdEntry[]> {
  const tailLen = Math.min(file.size, 65557 + 20);
  const tailStart = file.size - tailLen;
  const tail = await sliceBytes(file, tailStart, file.size);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw malformed();
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // zip64: the locator sits right before the EOCD, pointing at the zip64
    // EOCD record.
    const locAt = eocd - 20;
    if (locAt < 0 || dv.getUint32(locAt, true) !== 0x07064b50) throw malformed();
    const z64At = Number(dv.getBigUint64(locAt + 8, true));
    const z64 = await sliceBytes(file, z64At, z64At + 56);
    const zv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
    if (zv.getUint32(0, true) !== 0x06064b50) throw malformed();
    count = Number(zv.getBigUint64(32, true));
    cdSize = Number(zv.getBigUint64(40, true));
    cdOffset = Number(zv.getBigUint64(48, true));
  }

  const cd = await sliceBytes(file, cdOffset, cdOffset + cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const decoder = new TextDecoder();
  const entries: CdEntry[] = [];
  let at = 0;
  for (let i = 0; i < count && at + 46 <= cd.length; i++) {
    if (cv.getUint32(at, true) !== 0x02014b50) throw malformed();
    const method = cv.getUint16(at + 10, true);
    const crc = cv.getUint32(at + 16, true);
    let csize: number = cv.getUint32(at + 20, true);
    let usize: number = cv.getUint32(at + 24, true);
    const nameLen = cv.getUint16(at + 28, true);
    const extraLen = cv.getUint16(at + 30, true);
    const commentLen = cv.getUint16(at + 32, true);
    let headerOffset: number = cv.getUint32(at + 42, true);
    const name = decoder.decode(cd.subarray(at + 46, at + 46 + nameLen));
    // zip64 extra field (0x0001) carries the 64-bit values for whichever of
    // these overflowed, in this fixed order.
    if (csize === 0xffffffff || usize === 0xffffffff || headerOffset === 0xffffffff) {
      let ex = at + 46 + nameLen;
      const exEnd = ex + extraLen;
      while (ex + 4 <= exEnd) {
        const id = cv.getUint16(ex, true);
        const len = cv.getUint16(ex + 2, true);
        if (id === 0x0001) {
          let f = ex + 4;
          if (usize === 0xffffffff) {
            usize = Number(cv.getBigUint64(f, true));
            f += 8;
          }
          if (csize === 0xffffffff) {
            csize = Number(cv.getBigUint64(f, true));
            f += 8;
          }
          if (headerOffset === 0xffffffff) {
            headerOffset = Number(cv.getBigUint64(f, true));
          }
          break;
        }
        ex += 4 + len;
      }
    }
    entries.push({ name, method, crc, csize, usize, headerOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
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
 * RAW COPY over the central directory, deliberately. Two earlier shapes
 * failed on real exports: the buffered strip (arrayBuffer + unzip + zip)
 * peaked at ~3.3x the archive size and crashed the tab on a 770 MB export,
 * and fflate's streaming Unzip chokes ("unexpected EOF") on some large
 * data-descriptor entries that python's zipfile reads fine. So this walks
 * the zip's own central directory via random-access slices and copies each
 * kept entry's COMPRESSED bytes verbatim into the output (sizes and CRCs
 * come from the directory): no inflate, no re-deflate, no CRC pass, flat
 * memory (4 MB slices plus the output), and data descriptors are irrelevant
 * because nothing parses the local data stream.
 *
 * Sensitive entries (DMs, account data, …) are never read at all; only
 * their directory records are. Media is rebased by basename under
 * `tweets_media/`; the tweets.js match is anchored so `deleted-tweets.js`
 * is not picked up. Throws an `ApiError` carrying the same `code` the
 * backend would (`archive_malformed` / `archive_no_tweets`) so the page
 * maps it to one message.
 */
export async function stripArchive(file: File): Promise<StrippedArchive> {
  const head = await sliceBytes(file, 0, 4);
  if (!(head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b)) {
    throw malformed();
  }

  let entries: CdEntry[];
  try {
    entries = await readCentralDirectory(file);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw malformed();
  }

  const tweetsEntry = entries
    .filter((e) => anchoredTweetsMatch(e.name))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!tweetsEntry) {
    throw new ApiError(
      "That zip isn't an X data export (no tweets.js inside).",
      0,
      "archive_no_tweets"
    );
  }

  const seenMedia = new Set<string>();
  const kept: { entry: CdEntry; outName: string }[] = [{ entry: tweetsEntry, outName: TWEETS_FILE }];
  for (const entry of entries) {
    if (!entry.name.includes(MEDIA_DIR)) continue;
    const base = entry.name.slice(entry.name.lastIndexOf("/") + 1);
    if (!base || entry.name.endsWith("/") || seenMedia.has(base)) continue;
    seenMedia.add(base);
    kept.push({ entry, outName: `${MEDIA_DIR}${base}` });
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

  const CHUNK = 4 * 1024 * 1024;
  try {
    for (const { entry, outName } of kept) {
      // The local header repeats name/extra with its own lengths; read them
      // to find where the entry's data actually starts.
      const lh = await sliceBytes(file, entry.headerOffset, entry.headerOffset + 30);
      const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
      if (lv.getUint32(0, true) !== 0x04034b50) throw malformed();
      const dataStart =
        entry.headerOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);

      // Raw pre-compressed pass-through: fflate writes exactly the bytes we
      // push under the method/size/crc we declare.
      const raw: ZipInputFile = {
        filename: outName,
        size: entry.usize,
        crc: entry.crc,
        compression: entry.method,
        flag: 0,
      };
      out.add(raw);
      if (entry.csize === 0) {
        raw.ondata?.(null, new Uint8Array(0), true);
        continue;
      }
      for (let off = 0; off < entry.csize; off += CHUNK) {
        const end = Math.min(off + CHUNK, entry.csize);
        const part = await sliceBytes(file, dataStart + off, dataStart + end);
        if (part.length !== end - off) throw malformed();
        raw.ondata?.(null, part, end === entry.csize);
      }
    }
    out.end();
    await zipEnded;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw malformed();
  }

  return {
    file: new File(outChunks as BlobPart[], "vidit-archive.zip", {
      type: "application/zip",
    }),
    postEstimate: Math.max(1, Math.round(tweetsEntry.usize / BYTES_PER_TWEET_ESTIMATE)),
  };
}
