"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A confirmation that shows for `resetMs` after each `flash`: a copy's check, a setting's
 *  *Saved*. A second flash inside the window restarts it, and unmount drops the timer. */
export function useFlash(resetMs = 1500) {
  const [on, setOn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flash = useCallback(() => {
    setOn(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOn(false), resetMs);
  }, [resetMs]);

  return { on, flash };
}
