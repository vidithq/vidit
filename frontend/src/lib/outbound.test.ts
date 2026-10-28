import { describe, expect, it } from "vitest";

import { linkKind, linkTarget, splitLinks } from "./outbound";

describe("linkKind", () => {
  it.each([
    ["an exact known host", "https://x.com/ana/status/1"],
    ["a subdomain of a known host", "https://help.x.com/en/archive"],
    ["an archive host", "https://archive.ph/abcde"],
    ["a known host in another case", "HTTPS://T.ME/channel/4"],
    ["a known host over http", "http://youtube.com/watch?v=1"],
    ["the map check", "https://www.google.com/maps?q=48.85,2.35"],
    ["a map source page", "https://registry.opendata.aws/terrain-tiles/"],
    ["a map source home page", "https://openfreemap.org/"],
  ])("opens %s directly", (_, href) => {
    expect(linkKind(href)).toBe("known");
  });

  it.each([
    ["a look-alike host ending in another domain", "https://x.com.evil.example/ana"],
    ["a host that only ends in the same letters", "https://notx.com/ana"],
    ["a known host in the path", "https://evil.example/x.com"],
    ["a known host in the userinfo", "https://x.com@evil.example/"],
    ["a sibling of a narrow entry", "https://sites.google.com/view/a"],
    ["a redirector beside a path entry", "https://www.google.com/url?q=https://evil.example"],
    ["a path below a path entry", "https://www.google.com/maps/url?q=https://evil.example"],
    ["a dot segment out of a path entry", "https://www.google.com/maps/../url?q=https://evil.example"],
    ["a subdomain of a path entry", "https://evil.www.google.com/maps"],
    ["another page of a map source host", "https://registry.opendata.aws/other/"],
  ])("asks before %s", (_, href) => {
    expect(linkKind(href)).toBe("unknown");
  });

  it("keeps Vidit and its subdomains in the app", () => {
    expect(linkKind("https://vidit.app/events/1")).toBe("internal");
    expect(linkKind("https://www.vidit.app/")).toBe("internal");
    expect(linkKind("https://vidit.app.evil.example/")).toBe("unknown");
  });

  it.each([
    ["a doubled slash", "https://vidit.app//evil.example/x"],
    ["a backslash", "https://vidit.app/\\evil.example"],
  ])("asks before a Vidit URL whose path starts with %s", (_, href) => {
    expect(linkKind(href)).toBe("unknown");
  });

  it.each([
    ["a malformed URL", "https://"],
    ["plain text", "not a url"],
    ["a relative path", "/events/1"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a mailto: URL", "mailto:a@example.com"],
  ])("refuses %s", (_, href) => {
    expect(linkKind(href)).toBeNull();
  });
});

describe("linkTarget", () => {
  it("resolves a Vidit path starting // to the host it names", () => {
    expect(linkTarget("https://vidit.app//evil.example/x?a=1#b")).toBe(
      "https://evil.example/x?a=1#b",
    );
  });

  it("leaves every other link as written", () => {
    expect(linkTarget("https://vidit.app/events/1")).toBe("https://vidit.app/events/1");
    expect(linkTarget("https://example.org//x")).toBe("https://example.org//x");
  });
});

describe("splitLinks", () => {
  it("returns plain text as one run", () => {
    expect(splitLinks("OSINT analyst")).toEqual([{ text: "OSINT analyst" }]);
  });

  it("cuts out each URL and keeps trailing punctuation as text", () => {
    expect(splitLinks("See https://x.com/ana, or (https://a.example/b).")).toEqual([
      { text: "See " },
      { text: "https://x.com/ana", href: "https://x.com/ana" },
      { text: ", or (" },
      { text: "https://a.example/b", href: "https://a.example/b" },
      { text: ")." },
    ]);
  });

  it("leaves a scheme with no host as text", () => {
    expect(splitLinks("broken https:// link")).toEqual([{ text: "broken https:// link" }]);
  });

  it("links a URL that fills the whole text", () => {
    expect(splitLinks("https://t.me/c")).toEqual([
      { text: "https://t.me/c", href: "https://t.me/c" },
    ]);
  });
});
