"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

import { useHelpHidden } from "@/hooks/useHelpHidden";
import { FIELD_HELP, type Concept } from "@/lib/fieldHelp";

/**
 * A `?` help affordance next to a field or section: surfaces a one-line
 * explanation on hover / focus, pinned on click (touch devices don't hover),
 * closed by outside-click, Escape, scroll, or pointer-leave.
 *
 * The tooltip is shown from JS hover state on the icon itself (not a CSS
 * `group-hover`) so a surrounding `.group` — e.g. the map filter-panel rows —
 * can't trigger it; and it's rendered in a portal with `position: fixed` so an
 * `overflow` ancestor (e.g. the map detail side panel) can't clip it.
 *
 * Takes a single `concept` key — the explanation text and the accessible label
 * both come from the one registry in `lib/fieldHelp.ts`, so the same concept
 * reads identically everywhere it appears and never drifts between them.
 *
 * Neutral, not orange: it's meta help, not a content action — orange stays
 * reserved for primary affordances.
 */
export default function FieldHelp({
  concept,
  size = 13,
  className = "",
}: {
  concept: Concept;
  size?: number;
  className?: string;
}) {
  const { text, label } = FIELD_HELP[concept];
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const hidden = useHelpHidden();

  const open = pinned || hovered;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // A short grace period so the pointer can cross the gap from the icon to the
  // tooltip (the tooltip is portaled, not a DOM child, so there's no shared
  // hover region) without it vanishing mid-move; the tooltip's own mouseenter
  // cancels it.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 80);
  };

  // Position the portaled tooltip, clamped into the viewport on every edge so it
  // can never be truncated. The tooltip first renders hidden (so it is
  // measurable); this effect then places it under the icon, flips it above when
  // it would overflow the bottom, and clamps left/right against its real width.
  // ``useEffect`` (not layout) keeps it SSR-safe; hidden-until-measured means no
  // flash at 0,0.
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const b = buttonRef.current?.getBoundingClientRect();
    const tip = tooltipRef.current?.getBoundingClientRect();
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

  // While open: dismiss on outside click (the portaled tooltip counts as inside),
  // Escape, scroll, or resize. Keyed on ``open`` so a hover-only tooltip is
  // dismissable too (e.g. a stray touch that set hover without a pin).
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHovered(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapperRef.current?.contains(t) && !tooltipRef.current?.contains(t)) close();
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

  // Power-user opt-out: hide every `?` (toggle on the settings page). Sections
  // carry no always-on subtitle, so with help hidden the form is just labels
  // and fields — the intended power-user view.
  if (hidden) return null;

  return (
    <span
      ref={wrapperRef}
      // Hover lives on the wrapper (just the icon — the tooltip is portaled out).
      // Leaving un-pins so a desktop click-then-move-away dismisses naturally;
      // touch never fires mouseleave, so a tapped pin stays until an outside tap.
      onMouseEnter={() => {
        cancelClose();
        setHovered(true);
      }}
      onMouseLeave={() => {
        setPinned(false);
        scheduleClose();
      }}
      className={`inline-flex items-center align-middle ${className}`}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={pinned}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={(e) => {
          // The help icon often sits inside a clickable card / label — don't
          // let the click bubble to the parent.
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        className="inline-flex items-center text-neutral-500 hover:text-neutral-300 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs transition-colors"
      >
        <HelpCircle size={size} strokeWidth={1.8} />
      </button>
      {open &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            id={tooltipId}
            onMouseEnter={cancelClose}
            onMouseLeave={() => setHovered(false)}
            // Hidden until the effect has measured + placed it (see above), so it
            // never flashes at 0,0 and is never truncated at a viewport edge.
            style={{
              position: "fixed",
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
              visibility: coords ? "visible" : "hidden",
            }}
            className="z-[2000] w-max max-w-xs px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 leading-relaxed font-normal normal-case tracking-normal shadow-lg"
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}
