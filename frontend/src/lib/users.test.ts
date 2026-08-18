import { describe, expect, it } from "vitest";

import { displayLinkValue, resolveLinkHref } from "./users";

describe("resolveLinkHref", () => {
  it("links an X or GitHub handle to the account on the platform", () => {
    expect(resolveLinkHref("x", "LoLManya")).toBe("https://x.com/LoLManya");
    expect(resolveLinkHref("x", "@LoLManya")).toBe("https://x.com/LoLManya");
    expect(resolveLinkHref("github", "@torvalds")).toBe(
      "https://github.com/torvalds"
    );
  });

  it("links a profile URL on the platform's own hosts", () => {
    expect(resolveLinkHref("x", "https://twitter.com/LoLManya")).toBe(
      "https://x.com/LoLManya"
    );
    expect(resolveLinkHref("x", "https://www.x.com/LoLManya/")).toBe(
      "https://x.com/LoLManya"
    );
  });

  it("links nothing for a URL on a host the platform does not own", () => {
    // The button carries the platform's brand mark, so a host the platform
    // does not own would send a reader somewhere else under X's own logo.
    expect(resolveLinkHref("x", "https://nitter.net/LoLManya")).toBeNull();
    expect(resolveLinkHref("x", "https://x.com.evil.example/LoLManya")).toBeNull();
    expect(resolveLinkHref("github", "https://gitlab.com/torvalds")).toBeNull();
  });

  it("links nothing for a URL that carries more than an account", () => {
    expect(resolveLinkHref("x", "https://x.com/LoLManya/status/1")).toBeNull();
    expect(resolveLinkHref("x", "https://x.com/i/flow")).toBeNull();
    expect(resolveLinkHref("x", "https://x.com/LoLManya?ref=1")).toBeNull();
    expect(resolveLinkHref("github", "https://github.com/orgs/vidithq/people")).toBeNull();
  });

  it("links nothing for a value the platform's own rules refuse", () => {
    expect(resolveLinkHref("x", "some user")).toBeNull();
    expect(resolveLinkHref("x", "sixteencharacters")).toBeNull();
    expect(resolveLinkHref("x", "x.com/LoLManya")).toBeNull();
  });

  it("links a website, and blocks a scheme an anchor must never carry", () => {
    expect(resolveLinkHref("website", "https://ana.example/blog")).toBe(
      "https://ana.example/blog"
    );
    expect(resolveLinkHref("website", "ana.example")).toBeNull();
    expect(resolveLinkHref("website", "javascript:alert(1)")).toBeNull();
  });

  it("links nothing for Discord, which publishes no profile URL", () => {
    expect(resolveLinkHref("discord", "ana")).toBeNull();
    expect(resolveLinkHref("discord", "https://discord.gg/abc")).toBeNull();
  });

  it("links nothing for an absent or blank value", () => {
    expect(resolveLinkHref("x", null)).toBeNull();
    expect(resolveLinkHref("x", "   ")).toBeNull();
  });
});

describe("displayLinkValue", () => {
  it("reduces an X or GitHub profile URL to the handle", () => {
    // The icon already says which platform it is, so the host is the one part
    // of the value that carries nothing.
    expect(displayLinkValue("x", "https://x.com/LoLManya")).toBe("@LoLManya");
    expect(displayLinkValue("github", "https://github.com/torvalds")).toBe(
      "@torvalds"
    );
  });

  it("accepts the platforms' other hosts and a trailing slash", () => {
    expect(displayLinkValue("x", "https://twitter.com/LoLManya")).toBe("@LoLManya");
    expect(displayLinkValue("x", "https://www.twitter.com/LoLManya/")).toBe(
      "@LoLManya"
    );
    expect(displayLinkValue("github", "https://www.github.com/torvalds")).toBe(
      "@torvalds"
    );
  });

  it("prefixes a bare handle, with or without the @", () => {
    expect(displayLinkValue("x", "geo_lego")).toBe("@geo_lego");
    expect(displayLinkValue("x", "@geo_lego")).toBe("@geo_lego");
    expect(displayLinkValue("github", "@geo-lego")).toBe("@geo-lego");
  });

  it("prints a value that names no account as stored", () => {
    // The text and the href run off one parse, so anything the row declines to
    // link is also anything it declines to call a handle.
    expect(displayLinkValue("x", "https://nitter.net/LoLManya")).toBe(
      "https://nitter.net/LoLManya"
    );
    expect(displayLinkValue("x", "https://x.com/LoLManya/status/1")).toBe(
      "https://x.com/LoLManya/status/1"
    );
    expect(displayLinkValue("x", "https://x.com/i/flow")).toBe(
      "https://x.com/i/flow"
    );
    expect(displayLinkValue("x", "https://x.com/@LoLManya")).toBe(
      "https://x.com/@LoLManya"
    );
    expect(displayLinkValue("github", "https://github.com/orgs/vidithq/people")).toBe(
      "https://github.com/orgs/vidithq/people"
    );
    expect(displayLinkValue("x", "some user")).toBe("some user");
  });

  it("strips a website's scheme and trailing slash, keeping the path", () => {
    expect(displayLinkValue("website", "https://osintmethat.com/")).toBe(
      "osintmethat.com"
    );
    expect(displayLinkValue("website", "http://ana.example")).toBe("ana.example");
    expect(displayLinkValue("website", "https://ana.example/blog")).toBe(
      "ana.example/blog"
    );
  });

  it("prints a Discord name and a non-URL website as stored", () => {
    expect(displayLinkValue("discord", "ana#1234")).toBe("ana#1234");
    expect(displayLinkValue("website", "ana.example")).toBe("ana.example");
  });

  it("prints nothing for an absent or blank value", () => {
    expect(displayLinkValue("x", null)).toBe("");
    expect(displayLinkValue("website", "   ")).toBe("");
  });
});
