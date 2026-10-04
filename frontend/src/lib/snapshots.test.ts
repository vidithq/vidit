import { describe, expect, it } from "vitest";

import { snapshotArchivesAnotherLink } from "./snapshots";

/**
 * The paste field's seatbelt: the server never checks what a snapshot captured, so this is the
 * only mis-paste check. It refuses nothing: quiet on every spelling of the pasted-under link,
 * loud on a plainly different one.
 */
describe("snapshotArchivesAnotherLink", () => {
  const CAPTURE = "https://web.archive.org/web/20260811120000";
  const SOURCE = "https://t.me/channel/42";

  it("names the captured link when the snapshot replays another one", () => {
    expect(snapshotArchivesAnotherLink(SOURCE, `${CAPTURE}/https://elsewhere.test/x`)).toBe(
      "https://elsewhere.test/x"
    );
  });

  it("stays quiet on the link it was pasted under", () => {
    expect(snapshotArchivesAnotherLink(SOURCE, `${CAPTURE}/${SOURCE}`)).toBeNull();
  });

  it("stays quiet on a snapshot that says nothing about what it captured", () => {
    // Short codes and ids embed no original: nothing to compare.
    expect(snapshotArchivesAnotherLink(SOURCE, "https://archive.ph/abcde")).toBeNull();
    expect(
      snapshotArchivesAnotherLink(SOURCE, "https://ghostarchive.org/archive/aBcD1")
    ).toBeNull();
    expect(snapshotArchivesAnotherLink(SOURCE, "")).toBeNull();
    expect(snapshotArchivesAnotherLink(SOURCE, "not a url")).toBeNull();
  });

  // One link written two ways (what made server-side comparison refuse correct snapshots):
  // no warning.
  it.each([
    ["a scheme the crawler settled on", SOURCE, "http://t.me/channel/42"],
    ["a trailing slash picked up in a browser", SOURCE, "https://t.me/channel/42/"],
    ["a host in another case", SOURCE, "https://T.ME/channel/42"],
    ["a leading www.", "https://newsdesk.example/p/1", "https://www.newsdesk.example/p/1"],
    ["Telegram's channel preview", SOURCE, "https://t.me/s/channel/42"],
    ["Telegram's long domain", SOURCE, "https://telegram.me/channel/42"],
    [
      "X's former domain",
      "https://x.com/analyst/status/9876543210",
      "https://twitter.com/analyst/status/9876543210",
    ],
    [
      "X's mobile domain",
      "https://x.com/analyst/status/9876543210",
      "https://mobile.twitter.com/analyst/status/9876543210",
    ],
    [
      "YouTube's share link",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
    ],
    [
      "a watch URL carrying a timestamp",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    ],
    [
      "X's share parameters",
      "https://x.com/analyst/status/9876543210",
      "https://twitter.com/analyst/status/9876543210?s=20&t=abc",
    ],
  ])("stays quiet on %s", (_case, link, embedded) => {
    expect(snapshotArchivesAnotherLink(link, `${CAPTURE}/${embedded}`)).toBeNull();
  });

  it("still warns when an X status id is genuinely another post", () => {
    // Share parameters come off, nothing else: the status id identifies the post.
    expect(
      snapshotArchivesAnotherLink(
        "https://x.com/analyst/status/9876543210",
        `${CAPTURE}/https://twitter.com/analyst/status/1234567890?s=20`
      )
    ).toBe("https://twitter.com/analyst/status/1234567890?s=20");
  });

  // archive.today's long form embeds the original like a replay path, so it warns too.
  it("reads the original out of an archive.today capture URL", () => {
    expect(
      snapshotArchivesAnotherLink(SOURCE, "https://archive.ph/20260811120000/https://elsewhere.test/x")
    ).toBe("https://elsewhere.test/x");
    expect(
      snapshotArchivesAnotherLink(SOURCE, `https://archive.today/20260811120000/${SOURCE}`)
    ).toBeNull();
  });

  it("stays quiet on an archive.today short code, which embeds nothing", () => {
    // An all-digit code must not read as a capture missing its link.
    expect(snapshotArchivesAnotherLink(SOURCE, "https://archive.is/12345")).toBeNull();
    // A lookup, not a capture: no timestamp to read an original behind.
    expect(snapshotArchivesAnotherLink(SOURCE, `https://archive.ph/newest/${SOURCE}`)).toBeNull();
  });

  it("reads a replay URL carrying the player's modifier", () => {
    const snapshot = `https://web.archive.org/web/20260811120000id_/https://elsewhere.test/x`;
    expect(snapshotArchivesAnotherLink(SOURCE, snapshot)).toBe("https://elsewhere.test/x");
  });

  it("puts the captured link's own query back before comparing", () => {
    // The embedded original's query was parsed off the replay URL: dropping it would read two
    // pages as one.
    const link = "https://newsdesk.example/post?id=42";
    expect(snapshotArchivesAnotherLink(link, `${CAPTURE}/${link}`)).toBeNull();
    expect(snapshotArchivesAnotherLink(link, `${CAPTURE}/https://newsdesk.example/post?id=7`)).toBe(
      "https://newsdesk.example/post?id=7"
    );
  });

  it("stays quiet when the link it was pasted under cannot be read", () => {
    // A half-typed source field is not evidence of a mis-paste.
    expect(snapshotArchivesAnotherLink("t.me/chan", `${CAPTURE}/https://elsewhere.test/x`)).toBeNull();
  });
});
