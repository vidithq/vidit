import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, stripArchive } from "./archive";

function zipFile(entries: Record<string, Uint8Array>): File {
  return new File([zipSync(entries)], "archive.zip", { type: "application/zip" });
}

describe("stripArchive", () => {
  it("keeps only tweets.js + tweets_media and flattens the data/ prefix", async () => {
    const file = zipFile({
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "data/tweets_media/1-a.jpg": new Uint8Array([1, 2, 3]),
      "data/account.js": strToU8("email + phone"),
      "data/direct-messages.js": strToU8("private dms"),
    });
    const stripped = await stripArchive(file);
    const out = unzipSync(new Uint8Array(await stripped.file.arrayBuffer()));
    expect(Object.keys(out).sort()).toEqual(["tweets.js", "tweets_media/1-a.jpg"]);
    // A tiny tweets.js still yields a nonzero cosmetic estimate.
    expect(stripped.postEstimate).toBe(1);
  });

  it("never emits deleted-tweets.js (a loose tweets.js match would catch it)", async () => {
    const file = zipFile({
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "data/tweets_media/1-a.jpg": new Uint8Array([9]),
      "data/deleted-tweets.js": strToU8("window.YTD.deleted_tweets.part0 = []"),
    });
    const stripped = await stripArchive(file);
    const out = unzipSync(new Uint8Array(await stripped.file.arrayBuffer()));
    expect(Object.keys(out).sort()).toEqual(["tweets.js", "tweets_media/1-a.jpg"]);
  });

  it("never emits deleted_tweets_media (its path contains tweets_media/)", async () => {
    // The media of deleted posts is outside the allowlist, and its directory
    // name literally contains `tweets_media/`. A rebased entry from it would
    // reach the backend under a legitimate name, so the backend's own
    // allowlist could no longer tell the two apart.
    const file = zipFile({
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "data/tweets_media/1-a.jpg": new Uint8Array([1]),
      "data/deleted_tweets_media/2-b.jpg": new Uint8Array([2]),
    });
    const stripped = await stripArchive(file);
    const out = unzipSync(new Uint8Array(await stripped.file.arrayBuffer()));
    expect(Object.keys(out).sort()).toEqual(["tweets.js", "tweets_media/1-a.jpg"]);
  });

  it("keeps only the media of the export root the tweets.js came from", async () => {
    // A zip holding a second, nested export: the shortest tweets.js wins, and
    // only the media beside it travels.
    const file = zipFile({
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "data/tweets_media/1-a.jpg": new Uint8Array([1]),
      "other-export/data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "other-export/data/tweets_media/2-b.jpg": new Uint8Array([2]),
    });
    const stripped = await stripArchive(file);
    const out = unzipSync(new Uint8Array(await stripped.file.arrayBuffer()));
    expect(Object.keys(out).sort()).toEqual(["tweets.js", "tweets_media/1-a.jpg"]);
  });

  it("throws archive_no_tweets when there is no tweets.js", async () => {
    const file = zipFile({ "data/account.js": strToU8("x") });
    await expect(stripArchive(file)).rejects.toHaveProperty("code", "archive_no_tweets");
  });

  it("throws archive_malformed on a non-zip", async () => {
    const file = new File([strToU8("not a zip at all")], "x.zip");
    await expect(stripArchive(file)).rejects.toHaveProperty("code", "archive_malformed");
  });

  it("stops copying as soon as the output crosses the cap", async () => {
    const entries: Record<string, Uint8Array> = {
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
    };
    for (let i = 0; i < 8; i++) {
      entries[`data/tweets_media/${i}-a.jpg`] = new Uint8Array(1024).fill(i);
    }
    const file = zipFile(entries);
    // Every byte the strip reads goes through slice(), so counting the calls
    // shows whether the copy walked all nine kept entries before failing.
    const rawSlice = file.slice.bind(file);
    let reads = 0;
    file.slice = (start?: number, end?: number, contentType?: string) => {
      reads += 1;
      return rawSlice(start, end, contentType);
    };

    await expect(stripArchive(file, 1)).rejects.toHaveProperty("code", "archive_too_large");
    // Signature, EOCD tail, central directory, then the first entry's local
    // header and its data: the other eight entries are never touched (copying
    // them all would take upwards of twenty reads).
    expect(reads).toBeLessThan(8);
  });

  it("passes on exactly the cap and fails one byte under it", async () => {
    const file = zipFile({
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "data/tweets_media/1-a.jpg": new Uint8Array([1, 2, 3]),
    });
    const { file: stripped } = await stripArchive(file);
    // The boundary the presigned policy enforces: at the cap is fine, over it
    // is not, and the running check must not shift that by a byte.
    await expect(stripArchive(file, stripped.size)).resolves.toBeTruthy();
    await expect(stripArchive(file, stripped.size - 1)).rejects.toHaveProperty(
      "code",
      "archive_too_large"
    );
  });

  it("mirrors the backend staged-zip guard", () => {
    // Must equal MAX_UPLOAD_BYTES in services/tweet_ingest/archive_zip.py:
    // a smaller value here refuses uploads S3 would accept, a larger one
    // hands the analyst an unretryable storage reject.
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 ** 3);
    // And the copy the analyst reads quotes that same constant.
    expect(MAX_UPLOAD_LABEL).toBe("4 GB");
  });
});
