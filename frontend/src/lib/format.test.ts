import { describe, expect, it } from "vitest";

import { formatInstantOrDate, safeHostname } from "@/lib/format";

describe("formatInstantOrDate", () => {
  it("shows the time when the instant is not midnight UTC", () => {
    expect(formatInstantOrDate("2026-01-13T08:12:00Z")).toBe("13 Jan 2026, 08:12 UTC");
  });

  it("shows the day alone at exactly 00:00:00 UTC", () => {
    expect(formatInstantOrDate("2026-01-13T00:00:00Z")).toBe("13 Jan 2026");
    expect(formatInstantOrDate("2026-01-13T02:00:00+02:00")).toBe("13 Jan 2026");
  });

  it("keeps the time for a value seconds past midnight", () => {
    expect(formatInstantOrDate("2026-01-13T00:00:30Z")).toBe("13 Jan 2026, 00:00 UTC");
  });

  it("renders an unparsable value as-is", () => {
    expect(formatInstantOrDate("not a date")).toBe("not a date");
  });
});

describe("safeHostname", () => {
  it("drops a leading www.", () => {
    expect(safeHostname("https://www.gettyimages.com/detail/123")).toBe("gettyimages.com");
  });

  it("keeps other subdomains", () => {
    expect(safeHostname("https://media.www.example.com/a")).toBe("media.www.example.com");
    expect(safeHostname("https://m.youtube.com/watch?v=1")).toBe("m.youtube.com");
  });

  it("returns a malformed value as-is", () => {
    expect(safeHostname("not a url")).toBe("not a url");
  });
});
