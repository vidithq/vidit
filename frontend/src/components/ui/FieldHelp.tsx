"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

import { useHelpHidden } from "@/hooks/useHelpHidden";
import { FIELD_HELP, type Concept } from "@/lib/fieldHelp";

/**
 * A `?` help affordance next to a field or section: surfaces a one-line
 * explanation on hover / focus, pinned on click (touch devices don't hover),
 * closed by outside-click or Escape. Mirrors TrustBadge's popover mechanics.
 *
 * Takes a single `concept` key — the explanation text and the accessible label
 * both come from the one registry in `lib/fieldHelp.ts`, so the same concept
 * reads identically everywhere it appears (submit form, detail page, map panel)
 * and never drifts between them.
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
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const hidden = useHelpHidden();

  useEffect(() => {
    if (!pinned) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  // Power-user opt-out: hide every `?` (toggle on the settings page). Sections
  // carry no always-on subtitle, so with help hidden the form is just labels
  // and fields — the intended power-user view.
  if (hidden) return null;

  return (
    <span
      ref={wrapperRef}
      // Leaving the `?` (and its tooltip) un-pins it, so on desktop a click-then-
      // move-away dismisses naturally instead of lingering until an outside click.
      // Touch never fires mouseleave, so there a tap pins and an outside tap (the
      // document handler above) dismisses — both paths covered.
      onMouseLeave={() => setPinned(false)}
      className={`relative inline-flex items-center align-middle group ${className}`}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={pinned}
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
      {/* Left-anchored (the icon sits at the start of a label, near the left
          edge): extending rightward keeps the tooltip on-screen where centering
          would clip it off the panel's left. */}
      <span
        role="tooltip"
        id={tooltipId}
        className={`absolute left-0 top-full mt-1.5 z-20 w-max max-w-xs px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 leading-relaxed font-normal normal-case tracking-normal shadow-lg transition-opacity duration-150 ${
          pinned
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
