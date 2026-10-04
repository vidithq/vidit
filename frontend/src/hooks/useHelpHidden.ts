"use client";

import { useClientPreference } from "./useClientPreference";
import { getHelpHidden, HELP_PREF_EVENT } from "@/lib/helpPreference";

/** Whether the `?` field-help is hidden. The server snapshot (`false`) avoids a hydration mismatch. */
export function useHelpHidden(): boolean {
  return useClientPreference(getHelpHidden, HELP_PREF_EVENT, () => false);
}
