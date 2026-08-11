"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy text to the clipboard and flash a "copied" flag for `resetMs`.
 *
 * The one home for the copy gesture's behaviour (write, flash, reset), so the
 * share rows on an event, the profile share control and the admin invite codes
 * can't drift on the reset window or leak a timer. Callers keep their own
 * markup and read `copied` to swap icon / label.
 *
 * A failed write resolves `false` instead of throwing: the Clipboard API is
 * unavailable on insecure contexts (plain http, some embedded webviews), and
 * every call site's fallback is the same (the value stays on screen or in the
 * address bar), so no call site has to carry a try/catch.
 */
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  // Held so a second copy inside the window replaces the pending reset instead
  // of queueing a duplicate (which would clear the flag early), and so unmount
  // drops it.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), resetMs);
      return true;
    },
    [resetMs]
  );

  return { copied, copy };
}
