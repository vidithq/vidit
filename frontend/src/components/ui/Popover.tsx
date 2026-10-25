"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { ACCENT_SURFACE, TOOLTIP_SURFACE } from "./styles";

// The panel keeps this much room from either viewport edge.
const EDGE_PX = 8;
// Between the trigger's bottom edge and the panel.
const GAP_PX = 4;

/** True when `target` sits in the panel or in a popup a control in it owns through
 *  `aria-controls` (the `Combobox` list, portaled out of the panel). */
function insidePanel(panel: HTMLElement | null, target: Node): boolean {
  if (!panel) return false;
  if (panel.contains(target)) return true;
  return [...panel.querySelectorAll("[aria-controls]")].some((control) => {
    const id = control.getAttribute("aria-controls");
    return !!id && !!document.getElementById(id)?.contains(target);
  });
}

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
 * thing before it runs, the edit form's version note). Mount it while open. It is fixed to the
 * viewport from a portal under `anchorRef`, starting at the anchor's left edge, or ending at its
 * right edge with `align="end"`, shifted to stay inside the viewport, and follows the anchor on
 * scroll. It takes focus when no field in it took it, so Escape reaches it. Escape calls `onClose(true)`, so focus can return to the anchor; a press outside the
 * panel and the anchor calls `onClose(false)`.
 */
export function PopoverPanel({
  id,
  label,
  anchorRef,
  onClose,
  align = "start",
  children,
}: {
  id?: string;
  /** The panel's accessible name. */
  label: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: (restoreFocus: boolean) => void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Placed before paint and again on every scroll or resize: style writes, not state.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchorEl = anchorRef.current;
    if (!panel || !anchorEl) return;
    const place = () => {
      const anchor = anchorEl.getBoundingClientRect();
      const room = document.documentElement.clientWidth - EDGE_PX - panel.offsetWidth;
      const left = align === "end" ? anchor.right - panel.offsetWidth : anchor.left;
      panel.style.top = `${anchor.bottom + GAP_PX}px`;
      panel.style.left = `${Math.max(EDGE_PX, Math.min(left, room))}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, align]);

  // After `autoFocus`, which React applies during commit: a panel without a focused field takes
  // focus itself, or its Escape handler never sees a key.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!anchorRef.current?.contains(target) && !insidePanel(panelRef.current, target)) {
        onClose(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [anchorRef, onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onClose(true);
  };

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn("fixed z-50 outline-none w-72 max-w-[calc(100vw-1rem)] space-y-2 rounded-md p-2", TOOLTIP_SURFACE)}
    >
      {children}
    </div>,
    document.body,
  );
}
