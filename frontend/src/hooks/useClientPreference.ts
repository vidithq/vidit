"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe a component to a browser-local preference (accent palette, theme,
 * help-tooltip visibility). `useSyncExternalStore` keeps every reader in sync
 * with the settings toggle, and its server snapshot avoids a hydration
 * mismatch: the stored value is corrected on the first client commit.
 *
 * The store lives in `localStorage`; changes in this tab fire `event`, and the
 * native `storage` event covers *other* tabs. `subscribe` is memoised on
 * `event` so `useSyncExternalStore` doesn't detach and reattach the listeners
 * on every render (`getSnapshot` is a stable module-level ref at each call site).
 */
export function useClientPreference<T>(
  getSnapshot: () => T,
  event: string,
  getServerSnapshot: () => T,
): T {
  const subscribe = useCallback(
    (callback: () => void) => {
      window.addEventListener(event, callback);
      window.addEventListener("storage", callback);
      return () => {
        window.removeEventListener(event, callback);
        window.removeEventListener("storage", callback);
      };
    },
    [event],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
