import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMapAssets, parseLatest } from "./mapAssets";

const BASE = "https://maps.example/vidit";

const LATEST = {
  planet: { key: "planet/20261025_080012_pt.pmtiles", version: "20261025_080012_pt" },
  sprite: { key: "sprite/ofm_f384/ofm" },
  natural_earth: { key: "natural-earth/ne2sr-z6.pmtiles", max_zoom: 6 },
  relief: { key: "relief/terrarium-z8.pmtiles", max_zoom: 8 },
};

describe("parseLatest", () => {
  it("resolves each file against the base URL, the archives through the pmtiles protocol", () => {
    expect(parseLatest(BASE, LATEST)).toEqual({
      planet: `pmtiles://${BASE}/planet/20261025_080012_pt.pmtiles`,
      sprite: `${BASE}/sprite/ofm_f384/ofm`,
      naturalEarth: `pmtiles://${BASE}/natural-earth/ne2sr-z6.pmtiles`,
      relief: `pmtiles://${BASE}/relief/terrarium-z8.pmtiles`,
    });
  });

  it.each([
    ["a missing file", { ...LATEST, relief: undefined }],
    ["an absolute URL", { ...LATEST, sprite: { key: "https://elsewhere.example/ofm" } }],
    ["a parent path", { ...LATEST, planet: { key: "../planet/x.pmtiles" } }],
    ["a rooted path", { ...LATEST, planet: { key: "/planet/x.pmtiles" } }],
    ["a key of another type", { ...LATEST, planet: { key: 7 } }],
  ])("refuses %s", (_, latest) => {
    expect(() => parseLatest(BASE, latest)).toThrow();
  });

  it("refuses a value that is not an object", () => {
    expect(() => parseLatest(BASE, null)).toThrow();
    expect(() => parseLatest(BASE, "planet")).toThrow();
  });
});

describe("fetchMapAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch(response: () => Promise<Response>) {
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reads latest.json from the base URL", async () => {
    const fetchMock = stubFetch(async () => new Response(JSON.stringify(LATEST)));
    const assets = await fetchMapAssets(BASE);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/latest.json`, { cache: "no-cache" });
    expect(assets?.planet).toBe(`pmtiles://${BASE}/planet/20261025_080012_pt.pmtiles`);
  });

  it.each([
    ["an error status", async () => new Response("missing", { status: 404 })],
    ["a network error", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a body that is not JSON", async () => new Response("<html>")],
    ["an incomplete latest.json", async () => new Response(JSON.stringify({ planet: LATEST.planet }))],
  ])("falls back to the public sources on %s, with one warning", async (_, response) => {
    stubFetch(response);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchMapAssets(BASE)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
