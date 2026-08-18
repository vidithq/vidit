import { describe, expect, it } from "vitest";

import { displayLinkValue } from "./users";

describe("displayLinkValue", () => {
  it("reduces an X or GitHub profile URL to the handle", () => {
    // The icon beside the pill already says which platform it is, so the host
    // is the one part of the value that carries nothing.
    expect(displayLinkValue("x", "https://x.com/LoLManya")).toBe("@LoLManya");
    expect(displayLinkValue("github", "https://github.com/torvalds")).toBe(
      "@torvalds"
    );
  });

  it("accepts the platforms' other hosts and a trailing slash", () => {
    expect(displayLinkValue("x", "https://twitter.com/LoLManya")).toBe("@LoLManya");
    expect(displayLinkValue("x", "https://www.x.com/LoLManya/")).toBe("@LoLManya");
    expect(displayLinkValue("github", "https://www.github.com/torvalds")).toBe(
      "@torvalds"
    );
  });

  it("prefixes a bare handle, with or without the @", () => {
    expect(displayLinkValue("x", "geo_lego")).toBe("@geo_lego");
    expect(displayLinkValue("x", "@geo_lego")).toBe("@geo_lego");
    expect(displayLinkValue("github", "@geo-lego")).toBe("@geo-lego");
  });

  it("leaves a URL on another host as stored", () => {
    // Someone's self-hosted mirror is not a handle on the platform, and
    // printing its first path segment as one would name the wrong account.
    expect(displayLinkValue("x", "https://nitter.net/LoLManya")).toBe(
      "https://nitter.net/LoLManya"
    );
    expect(displayLinkValue("x", "https://x.com")).toBe("https://x.com");
  });

  it("leaves a value that is neither a URL nor a valid handle as stored", () => {
    // A near-miss falls back to text rather than naming an account that the
    // platform's own rules say cannot exist.
    expect(displayLinkValue("x", "some user")).toBe("some user");
    expect(displayLinkValue("x", "sixteencharacters")).toBe("sixteencharacters");
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
    expect(displayLinkValue("discord", "https://discord.gg/abc")).toBe(
      "https://discord.gg/abc"
    );
    expect(displayLinkValue("website", "ana.example")).toBe("ana.example");
  });

  it("prints nothing for an absent or blank value", () => {
    expect(displayLinkValue("x", null)).toBe("");
    expect(displayLinkValue("website", "   ")).toBe("");
  });
});
