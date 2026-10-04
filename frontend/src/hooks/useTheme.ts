"use client";

import { useClientPreference } from "./useClientPreference";
import { getTheme, DEFAULT_THEME, THEME_EVENT, type ThemeId } from "@/lib/theme";

/** The selected light / dark theme. The server snapshot matches the pre-paint inline script
 * in the root layout, so there is no hydration mismatch. */
export function useTheme(): ThemeId {
  return useClientPreference(getTheme, THEME_EVENT, () => DEFAULT_THEME);
}
