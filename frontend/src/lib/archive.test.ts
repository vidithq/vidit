import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";

import { stripArchive } from "./archive";

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
    const out = unzipSync(new Uint8Array(await stripped.arrayBuffer()));
    // The sensitive files are gone; the data/ prefix is flattened.
    expect(Object.keys(out).sort()).toEqual(["tweets.js", "tweets_media/1-a.jpg"]);
  });

  it("never emits deleted-tweets.js (a loose tweets.js match would catch it)", async () => {
    const file = zipFile({
      "data/tweets.js": strToU8("window.YTD.tweets.part0 = []"),
      "data/tweets_media/1-a.jpg": new Uint8Array([9]),
      "data/deleted-tweets.js": strToU8("window.YTD.deleted_tweets.part0 = []"),
    });
    const stripped = await stripArchive(file);
    const out = unzipSync(new Uint8Array(await stripped.arrayBuffer()));
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
});
