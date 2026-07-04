/**
 * Client-side accent-palette preference: one axis, independent of the light /
 * dark theme ([`theme.ts`](./theme.ts)). Both share the same browser-local
 * plumbing ([`attributePreference.ts`](./attributePreference.ts)): a
 * `localStorage` value mirrored onto `<html data-*>`.
 *
 * The accent reaches the screen two ways, kept in step from here:
 *  - UI chrome: a `data-palette` attribute on <html> remaps the Tailwind
 *    `orange-*` scale (see `globals.css`), re-colouring every accent utility
 *    across the app without touching a single component.
 *  - Map markers: maplibre paint expressions can't read CSS variables, so
 *    `Map.tsx` reads the hex values below through `usePalette`.
 *
 * Orange is the historical accent and stays the default; the other entries are
 * Tailwind's own scales at the same shade stops, so the UI keeps its
 * tinted-on-dark recipe whatever hue is picked. `detected` is the same hue a
 * shade lighter (the `300` stop): a machine `detected` point reads as the same
 * family as a submitted one but stays distinct by lightness.
 */

import { createAttributePreference } from "./attributePreference";

export type PaletteId = "orange" | "blue" | "emerald" | "violet" | "rose";

export interface PaletteOption {
  id: PaletteId;
  label: string;
  /** Representative swatch (the 500 shade) for the settings picker. */
  swatch: string;
  /**
   * Map-marker colours: submitted point (`base`) + the density ramp's two
   * darker stops, plus the lighter `detected` shade for machine points.
   */
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
/** Persist the accent palette, reflect it on <html>, and notify readers. */
export const setPalette = pref.set;
/** Reflect the palette onto <html data-palette>, which remaps the accent scale. */
export const applyPalette = pref.apply;

export function paletteMapColors(id: PaletteId): PaletteOption["map"] {
  return (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).map;
}
