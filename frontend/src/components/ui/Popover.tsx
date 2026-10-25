"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
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
 * sideways to stay inside the viewport, and follows the trigger on scroll. Its first field takes
 * focus. Escape closes it and returns focus to the trigger; an outside click closes it.
 */
export function Popover({
  label,
  icon,
  children,
}: {
  /** The trigger's accessible name and tooltip, and the panel's name. */
  label: string;
  icon: ReactNode;
  /** The panel's content, handed the close. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // By id rather than the ref: the content calls it, and a ref read there trips the compiler.
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) document.getElementById(triggerId)?.focus();
  };

  // Placed before paint and again on every scroll or resize: style writes, not state.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!open || !panel || !trigger) return;
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const room = document.documentElement.clientWidth - EDGE_PX - panel.offsetWidth;
      panel.style.top = `${anchor.bottom + GAP_PX}px`;
      panel.style.left = `${Math.max(EDGE_PX, Math.min(anchor.left, room))}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target) && !insidePanel(panelRef.current, target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };

  return (
    <div ref={wrapperRef} className="inline-flex">
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
        className={open ? ACCENT_SURFACE : ""}
      >
        {icon}
      </Button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            className={cn("fixed z-50 w-72 max-w-[calc(100vw-1rem)] space-y-2 rounded-md p-2", TOOLTIP_SURFACE)}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}
