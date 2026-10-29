"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { useAnchoredPosition } from "./useAnchoredPosition";
import { useDismiss } from "./useDismiss";

// Fixed before it is measured, so it measures at the size it shows at.
const UNPLACED: CSSProperties = { position: "fixed", visibility: "hidden" };

/** Pin, dismiss and placement for an anchored popover (`FieldHelp`): shown from JS hover state
 * (not CSS `group-hover`, which a surrounding `.group` could trigger), pinned on click (touch
 * doesn't hover), closed by outside-click, Escape, scroll, resize or pointer-leave.
 *
 * Renders in a portal placed by `useAnchoredPosition` (`popoverStyle`), so an `overflow` ancestor
 * can't clip it. Callers spread `wrapperProps` / `anchorProps` / `popoverProps` on their own
 * markup.
 *
 * `shown` holds it open whatever the pointer does (a copy's confirmation). */
export function usePinnedPopover<
  Popover extends HTMLElement = HTMLSpanElement,
  Anchor extends HTMLElement = HTMLButtonElement,
>({ shown = false }: { shown?: boolean } = {}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<Anchor>(null);
  const popoverRef = useRef<Popover>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = pinned || hovered || shown;

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

  const position = useAnchoredPosition({ open, anchorRef, floatingRef: popoverRef });
  useDismiss({ open, anchorRef: wrapperRef, floatingRef: popoverRef, onDismiss: close });

  // Keyed on `open` so a hover-only popover closes too.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  useEffect(() => () => cancelClose(), []);

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
      style: position ?? UNPLACED,
      onMouseEnter: cancelClose,
      onMouseLeave: () => setHovered(false),
    },
  };
}
