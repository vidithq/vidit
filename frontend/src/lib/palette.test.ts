import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE,
  PALETTES,
  applyPalette,
  getPalette,
  paletteMapColors,
  setPalette,
} from "./palette";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.palette;
});

describe("getPalette", () => {
  it("defaults to orange when nothing is stored", () => {
    expect(getPalette()).toBe(DEFAULT_PALETTE);
    expect(DEFAULT_PALETTE).toBe("orange");
  });

  it("returns a stored, valid palette id", () => {
    window.localStorage.setItem("vidit:palette", "blue");
    expect(getPalette()).toBe("blue");
  });

  it("ignores an unknown stored value and falls back to the default", () => {
    window.localStorage.setItem("vidit:palette", "chartreuse");
    expect(getPalette()).toBe(DEFAULT_PALETTE);
  });
});

describe("setPalette", () => {
  it("persists the choice, reflects it on <html>, and notifies listeners", () => {
    let notified = false;
    window.addEventListener("vidit:palette-changed", () => {
      notified = true;
    });

    setPalette("violet");

    expect(window.localStorage.getItem("vidit:palette")).toBe("violet");
    expect(document.documentElement.dataset.palette).toBe("violet");
    expect(notified).toBe(true);
  });
});

describe("applyPalette", () => {
  it("sets the data-palette attribute", () => {
    applyPalette("rose");
    expect(document.documentElement.dataset.palette).toBe("rose");
  });
});

describe("paletteMapColors", () => {
  it("returns the marker colors for a known palette", () => {
    expect(paletteMapColors("blue")).toEqual({
      base: "#3b82f6",
      rampMid: "#2563eb",
      rampHigh: "#1d4ed8",
    });
  });

  it("every palette defines a swatch and three map colors", () => {
    for (const p of PALETTES) {
      expect(p.swatch).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.map.base).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.map.rampMid).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.map.rampHigh).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
