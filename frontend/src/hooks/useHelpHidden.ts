"use client";

import { useClientPreference } from "./useClientPreference";
import { getHelpHidden, HELP_PREF_EVENT } from "@/lib/helpPreference";

/**
 * Whether the user has hidden the `?` field-help. Kept in sync across every
 * `FieldHelp` + the settings toggle; the server snapshot (`false`) avoids a
 * hydration mismatch, corrected on the first client commit.
 */
export function useHelpHidden(): boolean {
  return useClientPreference(getHelpHidden, HELP_PREF_EVENT, () => false);
}
