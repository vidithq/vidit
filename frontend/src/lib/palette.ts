/**
 * Accent-palette preference, independent of the theme ([`theme.ts`](./theme.ts)); both use
 * [`attributePreference.ts`](./attributePreference.ts).
 *
 * The accent reaches the screen two ways, kept in step from here:
 *  - UI chrome: `data-palette` on <html> remaps the Tailwind `orange-*` scale (see
 *    `globals.css`).
 *  - Map markers: maplibre paint expressions can't read CSS variables, so `Map.tsx` reads the
 *    hex values below through `usePalette`.
 *
 * Other entries are Tailwind's scales at the same shade stops. `detected` is the `300` stop:
 * same family as a submitted point, distinct by lightness.
 */

import { createAttributePreference } from "./attributePreference";
import type { components } from "./api-types";
import type { ThemeId } from "./theme";

export type PaletteId = components["schemas"]["DisplayPreferences"]["palette"];

interface PaletteOption {
  id: PaletteId;
  label: string;
  /** Representative swatch (the 500 shade) for the settings picker. */
  swatch: string;
  /** Map-marker colours: submitted point, the density ramp's two darker stops, and the
   *  lighter `detected` shade. */
  map: { base: string; rampMid: string; rampHigh: string; detected: string };
}

// One entry per backend schemas/preferences.PaletteId, each with its globals.css block; change both.
export const PALETTES: readonly PaletteOption[] = [
  {
    id: "orange",
    label: "Orange",
    swatch: "#f97316",
    map: {
      base: "#f97316",
      rampMid: "#ea580c",
      rampHigh: "#c2410c",
      detected: "#fdba74",
    },
  },
  {
    id: "blue",
    label: "Blue",
    swatch: "#3b82f6",
    map: {
      base: "#3b82f6",
      rampMid: "#2563eb",
      rampHigh: "#1d4ed8",
      detected: "#93c5fd",
    },
  },
  {
    id: "emerald",
    label: "Emerald",
    swatch: "#10b981",
    map: {
      base: "#10b981",
      rampMid: "#059669",
      rampHigh: "#047857",
      detected: "#6ee7b7",
    },
  },
  {
    id: "violet",
    label: "Violet",
    swatch: "#8b5cf6",
    map: {
      base: "#8b5cf6",
      rampMid: "#7c3aed",
      rampHigh: "#6d28d9",
      detected: "#c4b5fd",
    },
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "#f43f5e",
    map: {
      base: "#f43f5e",
      rampMid: "#e11d48",
      rampHigh: "#be123c",
      detected: "#fda4af",
    },
  },
] as const;

// Mirrors backend schemas/preferences.DISPLAY_DEFAULTS; change both.
export const DEFAULT_PALETTE: PaletteId = "orange";

export const PALETTE_EVENT = "vidit:palette-changed";

function isPaletteId(value: string | null): value is PaletteId {
  return value !== null && PALETTES.some((p) => p.id === value);
}

const pref = createAttributePreference<PaletteId>({
  key: "vidit:palette",
  attribute: "palette",
  event: PALETTE_EVENT,
  fallback: DEFAULT_PALETTE,
  isValid: isPaletteId,
});

/** The stored accent palette, or the default when absent / invalid. */
export const getPalette = pref.get;
export const getSavedPalette = pref.saved;
export const setPalette = pref.set;
export const clearPalette = pref.clear;

export function paletteMapColors(id: PaletteId): PaletteOption["map"] {
  return (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).map;
}

/** Site zone paints on the map, by theme: the neutral text-secondary grey (`neutral-400`) for
 *  every zone, and the semantic warning (`amber-500`) and danger (`red-500`) for a zone whose
 *  latest linked event shows damage or destruction; `halo` is the canvas (`neutral-950`) behind a
 *  label. Hex of the `globals.css` stops; change both. */
export const SITE_MAP_COLORS: Record<
  ThemeId,
  { zone: string; damage: string; destruction: string; halo: string }
> = {
  dark: { zone: "#a3a3a3", damage: "#f59e0b", destruction: "#ef4444", halo: "#0a0a0a" },
  light: { zone: "#585858", damage: "#f59e0b", destruction: "#ef4444", halo: "#eae8e4" },
};

/** Basemap highlights, relief shading and the coordinate grid, by basemap brightness. Military
 *  areas take Tailwind lime and airports cyan: hues no marker palette above and no site zone uses,
 *  so a highlighted area never reads as an event. The grid is a neutral line, labelled over a halo
 *  of the canvas. The relief shades in translucent neutrals, so the land fills show through. */
export const MAP_LAYER_COLORS: Record<
  ThemeId,
  {
    military: string;
    airport: string;
    grid: string;
    gridLabel: string;
    gridHalo: string;
    reliefShadow: string;
    reliefHighlight: string;
    reliefAccent: string;
  }
> = {
  dark: {
    military: "#a3e635",
    airport: "#22d3ee",
    grid: "rgba(255,255,255,0.22)",
    gridLabel: "#a3a3a3",
    gridHalo: "#0a0a0a",
    reliefShadow: "rgba(0,0,0,0.7)",
    reliefHighlight: "rgba(255,255,255,0.14)",
    reliefAccent: "rgba(0,0,0,0.25)",
  },
  light: {
    military: "#4d7c0f",
    airport: "#0e7490",
    grid: "rgba(0,0,0,0.25)",
    gridLabel: "#525252",
    gridHalo: "#ffffff",
    reliefShadow: "rgba(64,56,48,0.4)",
    reliefHighlight: "rgba(255,255,255,0.45)",
    reliefAccent: "rgba(64,56,48,0.15)",
  },
};
