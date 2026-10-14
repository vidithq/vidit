import { describe, expect, it } from "vitest";

import { linkKind, splitLinks } from "./outbound";

describe("linkKind", () => {
  it.each([
    ["an exact known host", "https://x.com/ana/status/1"],
    ["a subdomain of a known host", "https://help.x.com/en/archive"],
    ["an archive host", "https://archive.ph/abcde"],
    ["a known host in another case", "HTTPS://T.ME/channel/4"],
    ["a known host over http", "http://youtube.com/watch?v=1"],
  ])("opens %s directly", (_, href) => {
    expect(linkKind(href)).toBe("known");
  });

  it.each([
    ["a look-alike host ending in another domain", "https://x.com.evil.example/ana"],
    ["a host that only ends in the same letters", "https://notx.com/ana"],
    ["a known host in the path", "https://evil.example/x.com"],
    ["a known host in the userinfo", "https://x.com@evil.example/"],
    ["a sibling of a narrow entry", "https://sites.google.com/view/a"],
  ])("asks before %s", (_, href) => {
    expect(linkKind(href)).toBe("unknown");
  });

  it("keeps Vidit and its subdomains in the app", () => {
    expect(linkKind("https://vidit.app/events/1")).toBe("internal");
    expect(linkKind("https://www.vidit.app/")).toBe("internal");
    expect(linkKind("https://vidit.app.evil.example/")).toBe("unknown");
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
