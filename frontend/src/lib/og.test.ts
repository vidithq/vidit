import { describe, expect, it } from "vitest";

import {
  isFetchableAvatarUrl,
  isPrivateAddress,
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
    // The last space (index 19) sits past 75% of the 24-character budget, so
    // the trailing partial word goes rather than being cut through.
    expect(ogTruncate("alpha bravo charlie delta", 24)).toBe("alpha bravo charlie…");
  });

  it("drops the trailing partial word rather than cutting through it", () => {
    expect(ogTruncate("alpha bravo charlie delta", 20)).toBe("alpha bravo charlie…");
  });

  it("cuts mid-word when the last space is too early to be useful", () => {
    expect(ogTruncate("a superlongsingletoken", 12)).toBe("a superlong…");
  });

  it("cuts astral characters whole, leaving no lone surrogate", () => {
    expect(ogTruncate("🚀🚀🚀🚀🚀🚀", 4)).toBe("🚀🚀🚀…");
  });

  it("measures the budget in code points, not UTF-16 units", () => {
    // Two astral characters are four UTF-16 units: a length-based budget would
    // cut this, a code-point one leaves it alone.
    expect(ogTruncate("🚀🚀", 3)).toBe("🚀🚀");
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

  it("rejects a private name spelled with the root's trailing dot", () => {
    // `localhost.` resolves exactly like `localhost`, and it carries a dot, so
    // it clears both the dotted-hostname check and every suffix comparison
    // unless the root label is stripped first.
    expect(isFetchableAvatarUrl("https://localhost./x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://printer.local./x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://db.internal./x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://vault.home.arpa./x.png")).toBe(false);
    expect(isFetchableAvatarUrl("https://169.254.169.254./x.png")).toBe(false);
  });

  it("accepts a public host spelled with the root's trailing dot", () => {
    expect(isFetchableAvatarUrl("https://cdn.example.com./a.png")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isFetchableAvatarUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isFetchableAvatarUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("isPrivateAddress", () => {
  it("accepts public unicast addresses", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("192.169.0.1")).toBe(false);
    expect(isPrivateAddress("100.128.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects the v4 loopback, unspecified and broadcast space", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("127.255.255.254")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("255.255.255.255")).toBe(true);
    expect(isPrivateAddress("239.0.0.1")).toBe(true);
  });

  it("rejects the v4 private, link-local and CGNAT ranges at their edges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("100.127.255.255")).toBe(true);
  });

  it("rejects the v6 loopback, unspecified, ULA, link-local and multicast", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("febf::1")).toBe(true);
    expect(isPrivateAddress("ff02::1")).toBe(true);
  });

  it("looks through an IPv4-mapped v6 address in either spelling", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("ignores a zone index and surrounding whitespace", () => {
    expect(isPrivateAddress("fe80::1%eth0")).toBe(true);
    expect(isPrivateAddress("  8.8.8.8  ")).toBe(false);
  });

  it("treats anything it cannot parse as unsafe", () => {
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("not-an-address")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
    expect(isPrivateAddress("1.2.3")).toBe(true);
    expect(isPrivateAddress("fe80::1::2")).toBe(true);
  });
});
