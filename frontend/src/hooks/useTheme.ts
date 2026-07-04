"use client";

import { useClientPreference } from "./useClientPreference";
import { getTheme, DEFAULT_THEME, THEME_EVENT, type ThemeId } from "@/lib/theme";

/**
 * The selected light / dark theme. Kept in sync across the settings toggle and
 * the map basemap; the server snapshot (`DEFAULT_THEME`) matches the pre-paint
 * inline script in the root layout, so there's no hydration mismatch.
 */
export function useTheme(): ThemeId {
  return useClientPreference(getTheme, THEME_EVENT, () => DEFAULT_THEME);
}
