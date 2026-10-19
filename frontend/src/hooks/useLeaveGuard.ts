"use client";

import { useEffect } from "react";

/** While `active`, ask the browser to confirm before the tab closes or reloads. Best-effort:
 * browsers show their own generic text (a custom message is ignored), and iOS Safari often
 * skips `beforeunload` entirely. */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Chromium and Safari still need the legacy field set to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
