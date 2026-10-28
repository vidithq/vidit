import { describe, expect, it, vi } from "vitest";

import {
  DIMENSIONS,
  EMPTY_FILTERS,
  activePills,
  anyActive,
  datesOffered,
  dayCounts,
  dimensionOptions,
  hasCoordsFilter,
  inWindow,
  offeredDimensions,
  scopeState,
  showScope,
  type FilterState,
} from "./model";

const NO_VOCABULARY = { tags: [], conflicts: [] };
const state = (patch: Partial<FilterState>): FilterState => ({ ...EMPTY_FILTERS, ...patch });

describe("the filter model", () => {
  it("offers each surface the dimensions its data serves, in one order", () => {
    expect(offeredDimensions("map", [])).toEqual([
      "show",
      "conflict",
      "tags",
      "sourceKind",
      "level",
      "media",
      "author",
      "approved",
      "approvedBy",
    ]);
    expect(offeredDimensions("feed", [])).toEqual([
      "show",
      "conflict",
      "tags",
      "sourceKind",
      "level",
      "media",
      "locationGuess",
      "following",
      "author",
      "approved",
      "approvedBy",
    ]);
    expect(offeredDimensions("requests", [])).toEqual([
      "conflict",
      "tags",
      "sourceKind",
      "level",
      "media",
      "locationGuess",
      "author",
    ]);
    expect(offeredDimensions("search", [])).not.toContain("following");
  });

  it("offers on search only what the picked kinds answer once no event is listed", () => {
    expect(offeredDimensions("search", ["collection"])).toEqual(["show", "tags", "author"]);
    expect(offeredDimensions("search", ["site"])).toEqual(["show", "author"]);
    expect(offeredDimensions("search", ["user"])).toEqual(["show"]);
    expect(offeredDimensions("search", ["geolocated", "user"])).toContain("level");
    expect(datesOffered("search", ["collection"])).toBe(false);
    expect(datesOffered("search", ["requested"])).toBe(true);
    expect(datesOffered("map", ["site"])).toBe(true);
  });

  it("drops the values a pick no longer offers", () => {
    const scoped = scopeState(
      "search",
      state({ show: ["collection"], tags: ["drone"], levels: ["direct"], eventFrom: "2024-01-01" }),
    );
    expect(scoped).toEqual(state({ show: ["collection"], tags: ["drone"] }));
  });

  it("follows the Show rule: nothing selected shows everything, a selection what it names", () => {
    expect(showScope([])).toEqual({ events: true, others: true });
    expect(showScope(["geolocated"])).toEqual({ events: true, others: false });
    expect(showScope(["site"])).toEqual({ events: false, others: true });
    expect(showScope(["site", "detected"])).toEqual({ events: true, others: true });
  });

  it("offers the Show options each surface lists", () => {
    const values = (surface: "map" | "search" | "feed") =>
      dimensionOptions("show", surface, NO_VOCABULARY).map((o) => o.label);
    expect(values("map")).toEqual(["Detected", "Geolocated", "Sites"]);
    expect(values("feed")).toEqual(["Requested", "Detected", "Geolocated"]);
    expect(values("search")).toEqual([
      "Requested",
      "Detected",
      "Geolocated",
      "Sites",
      "Collections",
      "Analysts",
      "Organizations",
    ]);
  });

  it("names every active filter as a removable pill, dates first", () => {
    const onPatch = vi.fn();
    const pills = activePills(
      "feed",
      state({
        show: ["requested"],
        locationGuess: ["blind"],
        following: true,
        approvedBy: { kind: "organization", slug: "osw", name: "Open Source Watch" },
        eventFrom: "2024-01-01",
      }),
      NO_VOCABULARY,
      onPatch,
    );
    expect(pills.map((p) => [p.filter, p.label])).toEqual([
      ["Event date", "From 1 Jan 2024"],
      ["Show", "Requested"],
      ["Location guess", "No guess"],
      [undefined, "Following"],
      ["Approved by", "Open Source Watch"],
    ]);
    pills[0].onRemove();
    expect(onPatch).toHaveBeenLastCalledWith({ eventFrom: "", eventTo: "" });
    pills[1].onRemove();
    expect(onPatch).toHaveBeenLastCalledWith({ show: [] });
    pills[3].onRemove();
    expect(onPatch).toHaveBeenLastCalledWith({ following: false });
  });

  it("counts only what a surface offers as active", () => {
    expect(anyActive("map", state({ following: true }))).toBe(false);
    expect(anyActive("feed", state({ following: true }))).toBe(true);
    expect(anyActive("requests", EMPTY_FILTERS)).toBe(false);
  });

  it("sends a Location guess pick as has_coords only when it decides", () => {
    expect(DIMENSIONS.locationGuess.param).toBe("has_coords");
    expect(hasCoordsFilter([])).toBeUndefined();
    expect(hasCoordsFilter(["guessed"])).toBe(true);
    expect(hasCoordsFilter(["blind"])).toBe(false);
    expect(hasCoordsFilter(["guessed", "blind"])).toBeUndefined();
  });

  it("counts days and keeps an unknown day inside any window", () => {
    expect(dayCounts(["2024-02-01", null, "2024-01-01", "2024-02-01"])).toEqual([
      { date: "2024-01-01", count: 1 },
      { date: "2024-02-01", count: 2 },
    ]);
    expect(inWindow(null, "2024-01-01", "2024-01-31")).toBe(true);
    expect(inWindow("2024-01-31", "2024-01-01", "2024-01-31")).toBe(true);
    expect(inWindow("2024-02-01", "", "2024-01-31")).toBe(false);
  });
});
