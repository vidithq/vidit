import { describe, expect, it } from "vitest";

import {
  isFetchableAvatarUrl,
  ogCount,
  ogTruncate,
  projectEquirectangular,
} from "./og";

describe("projectEquirectangular", () => {
  it("puts the null island at the centre of the frame", () => {
    expect(projectEquirectangular(0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("maps the corners of the world to the corners of the frame", () => {
    expect(projectEquirectangular(90, -180)).toEqual({ x: 0, y: 0 });
    expect(projectEquirectangular(-90, 180)).toEqual({ x: 1, y: 1 });
  });

  it("places a northern-hemisphere point above and right of centre", () => {
    const { x, y } = projectEquirectangular(48.5, 37.8);
    expect(x).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.5);
  });

  it("clamps a value outside the world box into the frame", () => {
    expect(projectEquirectangular(500, 900)).toEqual({ x: 1, y: 0 });
  });
});

describe("ogTruncate", () => {
  it("leaves a short string alone", () => {
    expect(ogTruncate("Strike on a bridge", 40)).toBe("Strike on a bridge");
  });

  it("collapses runs of whitespace", () => {
    expect(ogTruncate("  two   words\nhere ", 40)).toBe("two words here");
  });

  it("cuts on a word boundary near the end of the budget", () => {
    expect(ogTruncate("alpha bravo charlie delta", 20)).toBe("alpha bravo charlie…");
  });

  it("cuts mid-word when the last space is too early to be useful", () => {
    expect(ogTruncate("a superlongsingletoken", 12)).toBe("a superlong…");
  });
});

describe("ogCount", () => {
  it("separates thousands", () => {
    expect(ogCount(1234567)).toBe("1,234,567");
  });
});

describe("isFetchableAvatarUrl", () => {
  it("accepts an https URL on a public dotted host", () => {
    expect(isFetchableAvatarUrl("https://cdn.example.com/a.png")).toBe(true);
  });

  it("rejects an empty or unparsable value", () => {
    expect(isFetchableAvatarUrl(null)).toBe(false);
    expect(isFetchableAvatarUrl("")).toBe(false);
    expect(isFetchableAvatarUrl("not a url")).toBe(false);
  });

  it("rejects plain http, which is how the cloud metadata services answer", () => {
    expect(isFetchableAvatarUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects address literals in every spelling", () => {
    expect(isFetchableAvatarUrl("https://169.254.169.254/x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://[::1]/x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://2130706433/x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://0x7f000001/x.png")).toBe(false);
  });

  it("rejects private-network names", () => {
    expect(isFetchableAvatarUrl("https://localhost/x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://vault/x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://db.internal/x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://printer.local/x.png")).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isFetchableAvatarUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isFetchableAvatarUrl("file:///etc/passwd")).toBe(false);
  });
});
