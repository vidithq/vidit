"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useAnchoredPosition } from "@/hooks/useAnchoredPosition";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { ACCENT_SURFACE, TOOLTIP_SURFACE } from "./styles";

/**
 * An icon button that opens a small panel anchored under it, for a control too small to sit in
 * the page (the byline's account picker). The panel floats over the page, so nothing moves when it
 * opens. It is fixed to the viewport from a portal, starts at the trigger's left edge, shifts
 * sideways to stay inside the viewport, and follows the trigger on scroll. A field with
 * `autoFocus` takes focus, or else the panel does. Escape closes it and returns focus to the
 * trigger; an outside click closes it.
 */
export function Popover({
  label,
  icon,
  compact = false,
  children,
}: {
  /** The trigger's accessible name and tooltip, and the panel's name. */
  label: string;
  icon: ReactNode;
  /** A 24px trigger on a desktop that takes no more height than a 20px line: a byline's. The
   *  phone keeps its tap floor, its overhang held off the line by the same margins. */
  compact?: boolean;
  /** The panel's content, handed the close. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // By id rather than the ref: the content calls it, and a ref read there trips the compiler.
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) document.getElementById(triggerId)?.focus();
  };

  return (
    <div className="inline-flex">
      <Button
        ref={triggerRef}
        id={triggerId}
        icon
        variant="ghost"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cn(compact && "-my-2 sm:-my-0.5 sm:size-6", open && ACCENT_SURFACE)}
      >
        {icon}
      </Button>
      {open && (
        <PopoverPanel id={panelId} label={label} anchorRef={triggerRef} onClose={close}>
          {children(close)}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * The panel of a `<Popover>`, for a caller that owns its trigger (a write that asks one more
 * thing before it runs, the edit form's version note, the map's basemap control). Mount it while
 * open. `useAnchoredPosition` places it under `anchorRef`, or above it when the room below is
 * short, starting at the anchor's left edge, or ending at its right edge with `align="end"`. It
 * takes focus when no field in it took it. Escape calls `onClose(true)`, so focus can return to
 * the anchor; a press outside the panel and the anchor calls `onClose(false)`.
 */
export function PopoverPanel({
  id,
  label,
  anchorRef,
  onClose,
  align = "start",
  wide = false,
  className,
  children,
}: {
  id?: string;
  /** The panel's accessible name. */
  label: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: (restoreFocus: boolean) => void;
  align?: "start" | "end";
  /** 24rem instead of 18rem, for a row of choices that needs the room. */
  wide?: boolean;
  /** Caller-wins extras: a panel opened from a surface above `z-50` (the map's filter panel, a
   *  sheet) lifts itself over it. */
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition({ open: true, anchorRef, floatingRef: panelRef, align });
  useDismiss({ open: true, anchorRef, floatingRef: panelRef, onDismiss: onClose });

  // After `autoFocus`, which React applies during commit: a panel without a focused field takes
  // focus itself, so a keyboard or screen reader user lands in it and its Escape is its own.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={position}
      className={cn(
        "fixed z-50 outline-none max-w-[calc(100vw-1rem)] space-y-2 rounded-md p-2",
        wide ? "w-96" : "w-72",
        TOOLTIP_SURFACE,
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
