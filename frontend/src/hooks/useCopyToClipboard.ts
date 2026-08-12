"use client";

import { useEffect, useRef, useState } from "react";

/** How long the "copied" flash stays up before the label reverts. */
const COPIED_FLASH_MS = 1500;

/**
 * Copy text to the clipboard and flash a confirmation. `copied` is true for
 * `COPIED_FLASH_MS` after a successful copy; a second copy within the window
 * restarts the flash instead of queuing a duplicate timer (which would flip the
 * label back early), and unmounting clears it.
 *
 * A failed write resolves silently: `navigator.clipboard` rejects on insecure
 * contexts (http://, embedded webviews), where the value is still on screen (or
 * in the address bar) to copy by hand, so a thrown error would be noise.
 */
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  };

  return { copied, copy };
}
