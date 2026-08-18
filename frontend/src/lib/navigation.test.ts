import { beforeEach, describe, expect, it } from "vitest";
import {
  recordNavigation,
  safeNext,
  skipBackRecord,
  smartBack,
} from "./navigation";

// jsdom origin is pinned to http://localhost:3000 in vitest.config.mts —
// the same-origin check below compares against window.location.origin.
describe("safeNext", () => {
  it("falls back to /map when the param is absent", () => {
    expect(safeNext(null)).toBe("/map");
    expect(safeNext("")).toBe("/map");
  });

  it("honours a same-origin path and preserves search + hash", () => {
    expect(safeNext("/timeline")).toBe("/timeline");
    expect(safeNext("/events/abc?tab=proof#media")).toBe(
      "/events/abc?tab=proof#media"
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

// A doorway route exists only to send the reader somewhere else. Left in the
// chain it is a trap: walking back onto it runs its redirect again and lands
// where the walk started, which reads as a back arrow that does nothing.
describe("redirect-only routes", () => {
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
    setLocation("/map");
  });

  it("leaves the doorway out of the chain, so back reaches the page before it", () => {
    navigate("/profile/ana/detections");
    // Start reviewing, which lands on a route that only redirects.
    navigate("/profile/ana/detections/review");
    skipBackRecord();
    navigate("/events/d1/edit");

    // Back from the detection goes to the queue, not onto the doorway that would
    // redirect straight back to the detection.
    smartBack(router, "/profile/ana/detections");
    expect(current).toBe("/profile/ana/detections");
  });

  it("unwinds a walk of detections entered through the doorway", () => {
    navigate("/profile/ana/detections");
    navigate("/profile/ana/detections/review");
    skipBackRecord();
    navigate("/events/d1/edit");
    navigate("/events/d2/edit");

    smartBack(router, "/profile/ana/detections");
    expect(current).toBe("/events/d1/edit");
    smartBack(router, "/profile/ana/detections");
    expect(current).toBe("/profile/ana/detections");
  });

  it("is one-shot: only the navigation it was set for goes unrecorded", () => {
    navigate("/profile/ana/detections");
    skipBackRecord();
    navigate("/events/d1/edit");
    navigate("/events/d2/edit");

    // The second hop is an ordinary forward nav and records normally.
    smartBack(router, "/map");
    expect(current).toBe("/events/d1/edit");
  });
});
