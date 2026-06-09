"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck } from "lucide-react";

interface TrustBadgeProps {
  isTrusted: boolean;
  /**
   * Substantiation note. Surfaces in the popover so the badge isn't
   * an opaque "trust me bro" mark — readers can see *why* this analyst
   * was vetted (track record, credentials, established X handle, etc.).
   */
  trustReason?: string | null;
  size?: number;
  className?: string;
}

/**
 * Small orange checkmark next to a vetted analyst's handle, with a
 * popover that surfaces the substantiation note.
 *
 * The badge is a `<button>`: design.md's "orange = clickable" rule
 * applies, and clicking pins the popover open — useful on touch
 * devices where hover doesn't fire. Hover / focus still surface the
 * popover passively on desktop. Outside click and Escape both close.
 *
 * We deliberately don't add a "View profile" link inside the popover
 * — every callsite renders the badge adjacent to a handle that
 * already links to the profile, so the in-popover link would be
 * redundant.
 *
 * Renders nothing when `isTrusted` is false — the *absence* of the
 * badge is itself the signal for "not vetted".
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
          // The badge often sits inside a clickable card / link — don't
          // let the click bubble up to that parent navigation.
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        className="inline-flex items-center text-orange-500 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs"
      >
        <BadgeCheck size={size} strokeWidth={1.8} />
      </button>
      {/* Anchored below the badge (`top-full`) — there's almost always
          more room below the badge than above, and long trust reasons
          would otherwise clip off the top of the viewport when the
          badge sits in a page header. */}
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
