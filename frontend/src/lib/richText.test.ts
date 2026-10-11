import { describe, expect, it } from "vitest";

import { isSafeLinkHref, richTextContract } from "./richText";

describe("richTextContract", () => {
  it("matches the allowlist the server sanitizer loads", async () => {
    // The drift gate: an editor extension added, removed or upgraded without regenerating the
    // backend allowlist fails here. Regenerate with `npx vitest run -u src/lib/richText.test.ts`.
    await expect(`${JSON.stringify(richTextContract(), null, 2)}\n`).toMatchFileSnapshot(
      "../../../backend/app/services/rich_text_contract.json",
    );
  });
});

describe("isSafeLinkHref", () => {
  // The editor mints links against this rule and the renderer re-applies it, so a link the editor
  // allows is one `services/sanitize.py::safe_link_href` keeps.
  it("accepts absolute http(s) URLs with a host", () => {
    expect(isSafeLinkHref("https://x.com/user/status/1")).toBe(true);
    expect(isSafeLinkHref("http://localhost:8000/p")).toBe(true);
    expect(isSafeLinkHref("HTTPS://X.COM/a")).toBe(true);
  });

  it("rejects the other protocols linkify registers by default", () => {
    for (const url of [
      "mailto:analyst@example.com",
      "tel:+33123456789",
      "sms:+33123456789",
      "ftp://files.example.com/x",
      "xmpp:analyst@example.com",
    ]) {
      expect(isSafeLinkHref(url)).toBe(false);
    }
  });

  it("rejects a scheme-less value, an email, and a smuggled javascript: scheme", () => {
    expect(isSafeLinkHref("example.com/a")).toBe(false);
    expect(isSafeLinkHref("analyst@example.com")).toBe(false);
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("https://")).toBe(false);
  });

  it("rejects an href past the 2000-byte ceiling the server applies", () => {
    expect(isSafeLinkHref("https://example.com/" + "x".repeat(2000))).toBe(false);
  });
});
