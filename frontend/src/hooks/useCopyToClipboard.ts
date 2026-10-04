"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Copy text and flash `copied` for `resetMs`: the one home for the gesture so call sites
 * can't drift on the reset window or leak a timer. A failed write (Clipboard API unavailable
 * on insecure contexts) resolves `false` instead of throwing; every fallback is the same, so
 * no call site needs a try/catch. */
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  // A second copy inside the window replaces the pending reset (a duplicate would clear the
  // flag early); unmount drops it.
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
