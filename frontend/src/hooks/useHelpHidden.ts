"use client";

import { useSyncExternalStore } from "react";
import { getHelpHidden, HELP_PREF_EVENT } from "@/lib/helpPreference";

function subscribe(callback: () => void): () => void {
  window.addEventListener(HELP_PREF_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(HELP_PREF_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Whether the user has hidden the `?` field-help. `useSyncExternalStore` keeps
 * every `FieldHelp` + the settings toggle in sync, and its server snapshot
 * (`false`) avoids a hydration mismatch — the preference is corrected on the
 * first client commit.
 */
export function useHelpHidden(): boolean {
  return useSyncExternalStore(subscribe, getHelpHidden, () => false);
}
