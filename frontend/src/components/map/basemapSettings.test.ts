import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SettingsModule = typeof import("./basemapSettings");

// The module keeps the last read in memory, so each test loads it fresh.
async function load(): Promise<SettingsModule> {
  vi.resetModules();
  return import("./basemapSettings");
}

describe("basemap settings", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to Auto, Latin labels, sparse density, every layer but region borders and relief on, and no overlay", async () => {
    const { getBasemapSettings } = await load();
    expect(getBasemapSettings()).toEqual({
      preset: "auto",
      language: "latin",
      density: "sparse",
      regionBorders: false,
      roads: true,
      buildings: true,
      militaryAndAirports: true,
      relief: false,
      disputedDashed: true,
      grid: false,
    });
  });

  it("persists a change and announces it", async () => {
    const { getBasemapSettings, saveBasemapSettings } = await load();
    const heard = vi.fn();
    window.addEventListener("vidit:basemap-changed", heard);
    saveBasemapSettings({ preset: "terrain" });
    window.removeEventListener("vidit:basemap-changed", heard);
    expect(heard).toHaveBeenCalledOnce();
    expect(getBasemapSettings().preset).toBe("terrain");
    expect(JSON.parse(window.localStorage.getItem("vidit:basemap") ?? "{}")).toMatchObject({
      preset: "terrain",
    });
  });

  it("returns the same object until the stored value changes", async () => {
    const { getBasemapSettings } = await load();
    expect(getBasemapSettings()).toBe(getBasemapSettings());
  });

  it("reads an invalid field as its default and keeps the valid ones", async () => {
    window.localStorage.setItem(
      "vidit:basemap",
      JSON.stringify({ preset: "satellite", language: "local", roads: "no" }),
    );
    const { getBasemapSettings } = await load();
    expect(getBasemapSettings()).toMatchObject({ preset: "auto", language: "local", roads: true });
  });

  it("reads a value stored before a setting existed with that setting at its default", async () => {
    window.localStorage.setItem(
      "vidit:basemap",
      JSON.stringify({
        preset: "vidit-light",
        language: "both",
        density: "normal",
        regionBorders: true,
        roads: false,
      }),
    );
    const { getBasemapSettings } = await load();
    expect(getBasemapSettings()).toMatchObject({
      preset: "vidit-light",
      language: "both",
      density: "normal",
      regionBorders: true,
      roads: false,
      buildings: true,
      militaryAndAirports: true,
      relief: false,
      disputedDashed: true,
      grid: false,
    });
  });

  it("reads an unparsable value as the defaults", async () => {
    window.localStorage.setItem("vidit:basemap", "{not json");
    const { getBasemapSettings } = await load();
    expect(getBasemapSettings().preset).toBe("auto");
  });

  it("keeps a change in memory when the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { getBasemapSettings, saveBasemapSettings } = await load();
    expect(getBasemapSettings().preset).toBe("auto");
    saveBasemapSettings({ preset: "streets" });
    expect(getBasemapSettings().preset).toBe("streets");
  });
});
