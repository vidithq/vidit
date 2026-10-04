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

export type PaletteId = "orange" | "blue" | "emerald" | "violet" | "rose";

export interface PaletteOption {
  id: PaletteId;
  label: string;
  /** Representative swatch (the 500 shade) for the settings picker. */
  swatch: string;
  /** Map-marker colours: submitted point, the density ramp's two darker stops, and the
   *  lighter `detected` shade. */
  map: { base: string; rampMid: string; rampHigh: string; detected: string };
}

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
export const setPalette = pref.set;

export function paletteMapColors(id: PaletteId): PaletteOption["map"] {
  return (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).map;
}
