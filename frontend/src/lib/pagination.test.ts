import { describe, it, expect } from "vitest";
import { nextCursor } from "./pagination";

describe("nextCursor", () => {
  it("pulls the cursor out of a rel=next link", () => {
    expect(
      nextCursor('<https://api.vidit.app/api/v1/events?limit=2&cursor=abc123>; rel="next"')
    ).toBe("abc123");
  });

  it("keeps the cursor whole when it carries base64url padding characters", () => {
    const cursor = "WyIyMDI2LTA4LTExVDEwOjAwOjAwKzAwOjAwIiwiZi0xIl0";
    expect(nextCursor(`<https://api.vidit.app/api/v1/events?cursor=${cursor}>; rel="next"`)).toBe(
      cursor
    );
  });

  it("reads the next relation out of a multi-relation header", () => {
    expect(
      nextCursor('<https://a.test/x?cursor=p>; rel="prev", <https://a.test/x?cursor=n>; rel="next"')
    ).toBe("n");
  });

  it("returns null when there is no header, no next relation, or no cursor", () => {
    // The three ways a page says "nothing more to ask for".
    expect(nextCursor(null)).toBeNull();
    expect(nextCursor('<https://a.test/x?cursor=p>; rel="prev"')).toBeNull();
    expect(nextCursor('<https://a.test/x>; rel="next"')).toBeNull();
  });

  it("returns null for a header it cannot parse", () => {
    expect(nextCursor("garbage")).toBeNull();
    expect(nextCursor('<not a url>; rel="next"')).toBeNull();
  });
});
