"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Two-click confirm for a destructive action: the first `trigger()` arms it,
 * the second fires `action`. Optionally auto-disarms after `timeoutMs`. The
 * arm/reset logic is the bug-prone part (fire on the wrong click, never reset),
 * so it lives here once; each call site keeps its own button markup and reads
 * `armed` to swap label / show a Confirm+Cancel pair.
 */
export function useConfirmAction(
  action: () => void | Promise<void>,
  options?: { timeoutMs?: number }
) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const cancel = () => {
    clearTimer();
    setArmed(false);
  };

  const trigger = () => {
    if (!armed) {
      setArmed(true);
      if (options?.timeoutMs) {
        timerRef.current = setTimeout(() => setArmed(false), options.timeoutMs);
      }
      return;
    }
    cancel();
    void action();
  };

  // Drop any pending auto-disarm timer on unmount.
  useEffect(() => clearTimer, []);

  return { armed, trigger, cancel };
}
