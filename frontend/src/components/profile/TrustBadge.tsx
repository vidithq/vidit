"use client";

import { createPortal } from "react-dom";
import { BadgeCheck } from "lucide-react";

import { usePinnedPopover } from "@/hooks/usePinnedPopover";

interface TrustBadgeProps {
  isTrusted: boolean;
  /** Substantiation note shown in the popover, so the badge isn't an opaque
   *  mark — readers can see why the analyst was vetted. */
  trustReason?: string | null;
  size?: number;
}

/**
 * Orange checkmark next to a vetted analyst's handle with a popover.
 *
 * A `<button>` per the "orange = clickable" rule: clicking pins the popover
 * (touch devices don't hover); hover/focus surface it passively, outside-click
 * and Escape close it (the `usePinnedPopover` machinery, shared with `FieldHelp`,
 * whose portal + viewport clamp keep the popover readable inside `overflow`
 * ancestors like the map side panel). No "View profile" link inside: every
 * callsite already renders the badge next to a handle that links to the
 * profile. Renders nothing when not trusted, so the badge's absence is the
 * "not vetted" signal.
 */
export default function TrustBadge({
  isTrusted,
  trustReason,
  size = 14,
}: TrustBadgeProps) {
  const { open, pinned, wrapperProps, anchorProps, popoverProps } =
    usePinnedPopover();

  if (!isTrusted) return null;
  const heading = "Trusted contributor";
  const aria = trustReason ? `${heading}: ${trustReason}` : heading;

  return (
    <span {...wrapperProps} className="relative inline-flex items-center align-middle">
      <button
        {...anchorProps}
        type="button"
        aria-label={aria}
        aria-expanded={pinned}
        className="inline-flex items-center text-orange-500 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs"
      >
        <BadgeCheck size={size} strokeWidth={1.8} />
      </button>
      {open &&
        createPortal(
          <span
            {...popoverProps}
            role="tooltip"
            className="z-[2000] w-max max-w-sm px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-200 shadow-lg"
          >
            <span className="block text-orange-400 font-medium">{heading}</span>
            {trustReason && (
              <span className="block text-neutral-300 mt-0.5 leading-relaxed">
                {trustReason}
              </span>
            )}
          </span>,
          document.body
        )}
    </span>
  );
}
