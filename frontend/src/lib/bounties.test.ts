import { describe, expect, it } from "vitest";

import { missingBountyFields } from "./bounties";

// missingBountyFields returns {key,label}[]; assert on the labels.
const labels = (s: Parameters<typeof missingBountyFields>[0]) =>
  missingBountyFields(s).map((m) => m.label);

describe("missingBountyFields", () => {
  it("returns nothing when title, source, and media are present", () => {
    expect(
      labels({
        title: "Unplaced footage",
        sourceUrl: "https://t.me/c/1",
        mediaCount: 1,
      })
    ).toEqual([]);
  });

  it("lists the bounty floor (no coords / dates / proof / tags) at once", () => {
    expect(labels({ title: "", sourceUrl: "", mediaCount: 0 })).toEqual([
      "Title",
      "Source URL",
      "Source media",
    ]);
  });

  it("treats a blank-string title as missing", () => {
    expect(
      labels({ title: "   ", sourceUrl: "https://t.me/c/1", mediaCount: 1 })
    ).toEqual(["Title"]);
  });
});
