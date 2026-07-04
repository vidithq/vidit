/**
 * Light / dark theme preference. A second axis, independent of the accent
 * palette ([`palette.ts`](./palette.ts)): the palette re-tints the accent hue,
 * the theme flips the neutral base (backgrounds, text, borders) and the map
 * basemap.
 *
 * Dark is the historical default and stays inert (no `data-theme`, or
 * `data-theme="dark"`, both fall back to Tailwind's default neutral scale).
 * `light` reflects `data-theme="light"` onto `<html>`, which remaps the
 * `--color-neutral-*` scale (plus the semantic red / amber scales) to a curated
 * light ramp in [`globals.css`](../app/globals.css), re-colouring every
 * `neutral-*` utility with no per-component change. The map can't read CSS
 * variables, so `Map.tsx` swaps its basemap style off `useTheme`.
 */

import { createAttributePreference } from "./attributePreference";

export type ThemeId = "dark" | "light";

export const DEFAULT_THEME: ThemeId = "dark";
export const THEME_EVENT = "vidit:theme-changed";

function isThemeId(value: string | null): value is ThemeId {
  return value === "dark" || value === "light";
}

const pref = createAttributePreference<ThemeId>({
  key: "vidit:theme",
  attribute: "theme",
  event: THEME_EVENT,
  fallback: DEFAULT_THEME,
  isValid: isThemeId,
});

export const getTheme = pref.get;
export const setTheme = pref.set;
export const applyTheme = pref.apply;
