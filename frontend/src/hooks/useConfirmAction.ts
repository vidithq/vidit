"use client";

import { useEffect, useRef, useState } from "react";

/** How long an armed control waits for its confirming second click. Long
 *  enough to re-read the button, short enough that a control left armed is
 *  disarmed again by the time attention returns to it. */
export const ARM_MS = 3000;

/**
 * Two-click confirm for an action worth a second look: the first `trigger()`
 * arms it, the second fires `action`. Optionally auto-disarms after
 * `timeoutMs`. The arm/reset logic is the bug-prone part (fire on the wrong
 * click, never reset), so it lives here once; each call site keeps its own
 * button markup and reads `armed` to swap label / paint the armed state.
 *
 * `dismissOnOutside` adds the other two ways out of an armed state: Escape, and
 * a click or a focus that lands anywhere else. It needs to know what "the
 * control" is, so the call site attaches the returned `controlRef` to it. Without the
 * option nothing is bound and the hook behaves exactly as before.
 */
export function useConfirmAction(
  action: () => void | Promise<void>,
  options?: { timeoutMs?: number; dismissOnOutside?: boolean }
) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The armed control itself, so an outside click can be told from its own.
  const controlRef = useRef<HTMLButtonElement>(null);

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

  const dismissOnOutside = options?.dismissOnOutside ?? false;

  useEffect(() => {
    if (!dismissOnOutside || !armed) return;
    const outside = (e: Event) => {
      const el = controlRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setArmed(false);
      clearTimer();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setArmed(false);
      clearTimer();
    };
    // `pointerdown` rather than `click`: the state is gone before the click
    // that disarmed it reaches whatever it landed on, so a control the reader
    // meant to press next behaves normally.
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [dismissOnOutside, armed]);

  useEffect(() => clearTimer, []);

  return { armed, trigger, cancel, controlRef };
}
