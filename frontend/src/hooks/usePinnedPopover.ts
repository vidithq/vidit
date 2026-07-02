"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * The pin + dismiss + placement machinery shared by the anchored popovers
 * (`FieldHelp`, `TrustBadge`): shown from JS hover state on the anchor (not a
 * CSS `group-hover`, so a surrounding `.group` can't trigger it), pinned on
 * click (touch devices don't hover), closed by outside-click, Escape, scroll,
 * resize, or pointer-leave.
 *
 * The popover is meant to render in a portal with `position: fixed`
 * (`popoverStyle`) so an `overflow` ancestor (e.g. the map detail side panel)
 * can never clip it: the placement effect measures the rendered popover, then
 * places it under the anchor, flips it above when it would overflow the
 * bottom, and clamps left/right against its real width. Hidden until measured,
 * so it never flashes at 0,0.
 *
 * Callers spread `wrapperProps` / `anchorProps` / `popoverProps` on their own
 * markup and keep full control of icon, content, and classes.
 */
export function usePinnedPopover() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = pinned || hovered;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // A short grace period so the pointer can cross the gap from the anchor to
  // the popover (portaled, not a DOM child, so there's no shared hover region)
  // without it vanishing mid-move; the popover's own mouseenter cancels it.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 80);
  };

  // Place the portaled popover, clamped into the viewport on every edge.
  // ``useEffect`` (not layout) keeps it SSR-safe.
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

  // While open: dismiss on outside click (the portaled popover counts as
  // inside), Escape, scroll, or resize. Keyed on ``open`` so a hover-only
  // popover is dismissable too (e.g. a stray touch that set hover without a
  // pin).
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHovered(false);
    };
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
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  // Hidden until the placement effect has measured + positioned it.
  const popoverStyle: CSSProperties = {
    position: "fixed",
    top: coords?.top ?? 0,
    left: coords?.left ?? 0,
    visibility: coords ? "visible" : "hidden",
  };

  return {
    open,
    pinned,
    wrapperProps: {
      ref: wrapperRef,
      // Hover lives on the wrapper (just the anchor, the popover is portaled
      // out). Leaving un-pins so a desktop click-then-move-away dismisses
      // naturally; touch never fires mouseleave, so a tapped pin stays until
      // an outside tap.
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
        // The anchor often sits inside a clickable card / label, so do not let
        // the click bubble to the parent.
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
