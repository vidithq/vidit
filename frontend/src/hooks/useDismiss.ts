"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

/** True when `target` sits in `floating` or in a popup a control in it owns through
 *  `aria-controls` (the `Combobox` list, portaled out of it). */
function inside(floating: HTMLElement | null, target: Node): boolean {
  if (!floating) return false;
  if (floating.contains(target)) return true;
  return [...floating.querySelectorAll("[aria-controls]")].some((control) => {
    const id = control.getAttribute("aria-controls");
    return !!id && !!document.getElementById(id)?.contains(target);
  });
}

/**
 * Closes a floating element while `open`: Escape calls `onDismiss(true)`, so focus can return to
 * the anchor, and a press outside the floating element and `anchorRef` calls `onDismiss(false)`.
 * An Escape pressed inside the floating element is marked handled (`preventDefault`), so a surface
 * under it (the media lightbox) stays open.
 */
export function useDismiss({
  open,
  anchorRef,
  floatingRef,
  onDismiss,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  floatingRef: RefObject<HTMLElement | null>;
  onDismiss: (restoreFocus: boolean) => void;
}) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!anchorRef.current?.contains(target) && !inside(floatingRef.current, target)) {
        dismiss(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (floatingRef.current?.contains(e.target as Node)) e.preventDefault();
      dismiss(true);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, floatingRef]);
}
