"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Subscribe to a browser-local preference. `useSyncExternalStore` keeps readers in sync, and
 * its server snapshot avoids a hydration mismatch (corrected on first client commit). This
 * tab fires `event`; the native `storage` event covers other tabs. `subscribe` is memoised on
 * `event` so listeners don't reattach every render. */
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
