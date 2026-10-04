"use client";

import { useEffect, useRef, useState } from "react";

/** How long an armed control waits for its confirming second click. */
export const ARM_MS = 3000;

/** Two-click confirm: the first `trigger()` arms, the second fires `action`; optionally
 * auto-disarms after `timeoutMs`. The arm/reset logic is bug-prone, so it lives here; call
 * sites keep their markup and read `armed`. `dismissOnOutside` also disarms on Escape and any
 * outside click or focus; the call site attaches `controlRef` to the control. */
export function useConfirmAction(
  action: () => void | Promise<void>,
  options?: { timeoutMs?: number; dismissOnOutside?: boolean }
) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // `pointerdown`, not `click`: disarming happens before the click lands, so the control the
    // reader meant to press next behaves normally.
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
