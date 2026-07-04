"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe a component to a browser-local preference (accent palette, theme,
 * help-tooltip visibility). `useSyncExternalStore` keeps every reader in sync
 * with the settings toggle, and its server snapshot avoids a hydration
 * mismatch: the stored value is corrected on the first client commit.
 *
 * The store lives in `localStorage`; changes in this tab fire `event`, and the
 * native `storage` event covers *other* tabs.
 */
export function useClientPreference<T>(
  getSnapshot: () => T,
  event: string,
  getServerSnapshot: () => T,
): T {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener(event, callback);
      window.addEventListener("storage", callback);
      return () => {
        window.removeEventListener(event, callback);
        window.removeEventListener("storage", callback);
      };
    },
    getSnapshot,
    getServerSnapshot,
  );
}
