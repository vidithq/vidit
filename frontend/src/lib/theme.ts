/**
 * Light / dark theme preference, independent of the accent palette ([`palette.ts`](./palette.ts)):
 * it flips the neutral base and the map basemap.
 *
 * Dark is the default and inert (no `data-theme`, or `dark`). `light` reflects
 * `data-theme="light"` onto `<html>`, remapping the `--color-neutral-*` scale (plus semantic
 * red / amber) in [`globals.css`](../app/globals.css). The map can't read CSS variables, so
 * `Map.tsx` swaps its basemap off `useTheme`.
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
