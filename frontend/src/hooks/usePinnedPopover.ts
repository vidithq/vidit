"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/** Pin, dismiss and placement for an anchored popover (`FieldHelp`): shown from JS hover state
 * (not CSS `group-hover`, which a surrounding `.group` could trigger), pinned on click (touch
 * doesn't hover), closed by outside-click, Escape, scroll, resize or pointer-leave.
 *
 * Renders in a portal with `position: fixed` (`popoverStyle`) so an `overflow` ancestor can't
 * clip it: the placement effect measures it, places it under the anchor, flips above on bottom
 * overflow, clamps left/right, and keeps it hidden until measured. Callers spread
 * `wrapperProps` / `anchorProps` / `popoverProps` on their own markup. */
export function usePinnedPopover() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = pinned || hovered;

  // The one dismissal, used by the effect below and by callers (a menu item that acts and closes).
  const close = useCallback(() => {
    setPinned(false);
    setHovered(false);
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Grace period so the pointer can cross from the anchor to the portaled popover (no shared
  // hover region); the popover's mouseenter cancels it.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 80);
  };

  // Place the popover, clamped into the viewport. `useEffect` keeps it SSR-safe.
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const b = anchorRef.current?.getBoundingClientRect();
    const tip = popoverRef.current?.getBoundingClientRect();
    if (!b || !tip) return;
    const margin = 8;
    const left = Math.max(margin, Math.min(b.left, window.innerWidth - tip.width - margin));
    let top = b.bottom + 6;
    if (top + tip.height > window.innerHeight - margin) {
      const above = b.top - tip.height - 6;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - tip.height - margin);
    }
    setCoords({ top, left });
  }, [open]);

  // While open: dismiss on outside click (the popover counts as inside), Escape, scroll or
  // resize. Keyed on `open` so a hover-only popover dismisses too.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapperRef.current?.contains(t) && !popoverRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  useEffect(() => () => cancelClose(), []);

  const popoverStyle: CSSProperties = {
    position: "fixed",
    top: coords?.top ?? 0,
    left: coords?.left ?? 0,
    visibility: coords ? "visible" : "hidden",
  };

  return {
    open,
    pinned,
    close,
    wrapperProps: {
      ref: wrapperRef,
      // Hover lives on the wrapper (the popover is portaled out). Leaving un-pins; touch never
      // fires mouseleave, so a tapped pin stays until an outside tap.
      onMouseEnter: () => {
        cancelClose();
        setHovered(true);
      },
      onMouseLeave: () => {
        setPinned(false);
        scheduleClose();
      },
    },
    anchorProps: {
      ref: anchorRef,
      onFocus: () => setHovered(true),
      onBlur: () => setHovered(false),
      onClick: (e: React.MouseEvent) => {
        // The anchor often sits in a clickable card or label: don't bubble the click.
        e.preventDefault();
        e.stopPropagation();
        setPinned((p) => !p);
      },
    },
    popoverProps: {
      ref: popoverRef,
      style: popoverStyle,
      onMouseEnter: cancelClose,
      onMouseLeave: () => setHovered(false),
    },
  };
}
