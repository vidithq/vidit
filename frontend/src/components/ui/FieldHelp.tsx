"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

/**
 * A `?` help affordance next to a field label: surfaces a one-line explanation
 * on hover / focus, pinned on click (touch devices don't hover), closed by
 * outside-click or Escape. Mirrors TrustBadge's popover mechanics.
 *
 * Neutral, not orange: it's meta help, not a content action — orange stays
 * reserved for primary affordances.
 */
export default function FieldHelp({
  text,
  label = "Field help",
  size = 13,
  className = "",
}: {
  text: string;
  /** aria-label for the trigger; defaults to a generic phrase. */
  label?: string;
  size?: number;
  className?: string;
}) {
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

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

  return (
    <span
      ref={wrapperRef}
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
