"use client";

import { useCallback } from "react";

import { useFlash } from "./useFlash";

/** Copy text and flash `copied` for `resetMs`: the one home for the gesture so call sites
 * can't drift on the reset window. A failed write (Clipboard API unavailable
 * on insecure contexts) resolves `false` instead of throwing; every fallback is the same, so
 * no call site needs a try/catch. */
export function useCopyToClipboard(resetMs = 1500) {
  const { on: copied, flash } = useFlash(resetMs);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      flash();
      return true;
    },
    [flash]
  );

  return { copied, copy };
}
