import { describe, expect, it } from "vitest";

import { snapshotArchivesAnotherLink } from "./snapshots";

/**
 * The paste field's seatbelt. The server checks where a snapshot lives and not
 * what it captured, so this is the only place a mis-paste is noticed, and it
 * refuses nothing: what matters is that it stays quiet on every spelling of the
 * link it was pasted under, and speaks up on a link that is plainly another one.
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
    // An archive.today code and a Ghostarchive id embed no original, so there is
    // nothing to compare and nothing to warn about.
    expect(snapshotArchivesAnotherLink(SOURCE, "https://archive.ph/abcde")).toBeNull();
    expect(
      snapshotArchivesAnotherLink(SOURCE, "https://ghostarchive.org/archive/aBcD1")
    ).toBeNull();
    expect(snapshotArchivesAnotherLink(SOURCE, "")).toBeNull();
    expect(snapshotArchivesAnotherLink(SOURCE, "not a url")).toBeNull();
  });

  // Every one of these is one link written two ways, which is what made a
  // server-side comparison refuse correct snapshots. A warning fires on none of
  // them.
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
  ])("stays quiet on %s", (_case, link, embedded) => {
    expect(snapshotArchivesAnotherLink(link, `${CAPTURE}/${embedded}`)).toBeNull();
  });

  it("reads a replay URL carrying the player's modifier", () => {
    const snapshot = `https://web.archive.org/web/20260811120000id_/https://elsewhere.test/x`;
    expect(snapshotArchivesAnotherLink(SOURCE, snapshot)).toBe("https://elsewhere.test/x");
  });

  it("puts the captured link's own query back before comparing", () => {
    // The embedded original is a whole URL in a path segment, so its query was
    // parsed off the replay URL: dropping it would read two pages as one.
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
