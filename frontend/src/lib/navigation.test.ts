import { beforeEach, describe, expect, it } from "vitest";
import { recordNavigation, safeNext, smartBack } from "./navigation";

// jsdom origin is pinned to http://localhost:3000 in vitest.config.mts —
// the same-origin check below compares against window.location.origin.
describe("safeNext", () => {
  it("falls back to /map when the param is absent", () => {
    expect(safeNext(null)).toBe("/map");
    expect(safeNext("")).toBe("/map");
  });

  it("honours a same-origin path and preserves search + hash", () => {
    expect(safeNext("/timeline")).toBe("/timeline");
    expect(safeNext("/geolocations/abc?tab=proof#media")).toBe(
      "/geolocations/abc?tab=proof#media"
    );
  });

  it("rejects values that do not start with a slash", () => {
    expect(safeNext("timeline")).toBe("/map");
    expect(safeNext("https://evil.com/x")).toBe("/map");
    expect(safeNext("javascript:alert(1)")).toBe("/map");
  });

  it("rejects scheme-relative URLs (//evil.com)", () => {
    expect(safeNext("//evil.com/x")).toBe("/map");
  });

  it("rejects backslash normalisation (/\\evil.com)", () => {
    // The WHATWG parser normalises \ → / in HTTP-special schemes, so
    // this resolves to //evil.com. A character-position check misses it.
    expect(safeNext("/\\evil.com")).toBe("/map");
  });

  it("rejects tab-stripped origin escapes (/\\t/evil.com)", () => {
    // The parser strips TAB/LF/CR before parsing: "/\t/evil.com"
    // becomes "//evil.com" and escapes the origin.
    expect(safeNext("/\t/evil.com")).toBe("/map");
  });

  it("keeps the tab-stripped value when it stays same-origin", () => {
    // "/\tevil.com" strips to "/evil.com" — a benign same-origin path.
    expect(safeNext("/\tevil.com")).toBe("/evil.com");
  });

  it("strips the origin from the returned value", () => {
    // Same-origin but written absolute — the result must be relative
    // so router.push treats it as internal navigation.
    expect(safeNext("/map?x=1")).toBe("/map?x=1");
  });
});

// Faithful model of the real loop: a forward nav records the path being left
// (what PathTracker does on each route change), and smartBack pops the stack +
// pushes — that push is itself a route change, so it also records the page left
// (which the one-shot flag must swallow).
describe("smartBack back-stack", () => {
  let current: string;

  const setLocation = (path: string) => {
    window.history.pushState({}, "", path);
    current = path;
  };
  const navigate = (to: string) => {
    const left = current;
    setLocation(to);
    recordNavigation(left);
  };
  const router = {
    push: (to: string) => {
      const left = current;
      setLocation(to);
      recordNavigation(left);
    },
  };

  beforeEach(() => {
    window.sessionStorage.clear();
    setLocation("/map"); // fresh load — nothing recorded yet
  });

  it("walks the chain back instead of ping-ponging between two pages", () => {
    navigate("/profile/ana");
    navigate("/profile/ana/detections");

    smartBack(router, "/map");
    expect(current).toBe("/profile/ana");

    // The regression: the second back must continue up the chain to /map,
    // not bounce back to /detections.
    smartBack(router, "/map");
    expect(current).toBe("/map");

    // Stack exhausted — falls through to the fallback and stays put.
    smartBack(router, "/map");
    expect(current).toBe("/map");
  });

  it("falls back when entered directly on a deep page (empty stack)", () => {
    setLocation("/profile/ana/detections");
    window.sessionStorage.clear();
    smartBack(router, "/map");
    expect(current).toBe("/map");
  });

  it("does not loop back to the current page after a reload", () => {
    // Reload leaves the stack in sessionStorage but the page on top is where we
    // already are; smartBack must skip it.
    navigate("/profile/ana");
    window.sessionStorage.setItem(
      "vidit:nav-stack",
      JSON.stringify(["/map", "/profile/ana"])
    );
    smartBack(router, "/map");
    expect(current).toBe("/map");
  });
});
