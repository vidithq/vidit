"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck } from "lucide-react";

interface TrustBadgeProps {
  isTrusted: boolean;
  /** Substantiation note shown in the popover, so the badge isn't an opaque
   *  mark — readers can see why the analyst was vetted. */
  trustReason?: string | null;
  size?: number;
  className?: string;
}

/**
 * Orange checkmark next to a vetted analyst's handle with a popover.
 *
 * A `<button>` per the "orange = clickable" rule: clicking pins the popover
 * (touch devices don't hover); hover/focus surface it passively, outside-click
 * and Escape close it. No "View profile" link inside — every callsite already
 * renders the badge next to a handle that links to the profile. Renders
 * nothing when not trusted: the badge's absence is the "not vetted" signal.
 */
export default function TrustBadge({
  isTrusted,
  trustReason,
  size = 14,
  className = "",
}: TrustBadgeProps) {
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

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

  if (!isTrusted) return null;
  const heading = "Trusted contributor";
  const aria = trustReason ? `${heading} — ${trustReason}` : heading;

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex items-center align-middle group ${className}`}
    >
      <button
        type="button"
        aria-label={aria}
        aria-expanded={pinned}
        onClick={(e) => {
          // The badge often sits inside a clickable card — don't let the
          // click bubble up to the parent navigation.
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        className="inline-flex items-center text-orange-500 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs"
      >
        <BadgeCheck size={size} strokeWidth={1.8} />
      </button>
      {/* Anchored below (`top-full`): more room there, and long reasons would
          clip off the top of the viewport when the badge is in a page header. */}
      <span
        role="tooltip"
        className={`absolute left-1/2 top-full mt-1.5 -translate-x-1/2 z-20 w-max max-w-sm px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-200 shadow-lg transition-opacity duration-150 ${
          pinned
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        <span className="block text-orange-400 font-medium">{heading}</span>
        {trustReason && (
          <span className="block text-neutral-300 mt-0.5 leading-relaxed">
            {trustReason}
          </span>
        )}
      </span>
    </span>
  );
}
