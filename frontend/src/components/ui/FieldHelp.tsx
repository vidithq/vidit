"use client";

import { useId } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

import { useHelpHidden } from "@/hooks/useHelpHidden";
import { usePinnedPopover } from "@/hooks/usePinnedPopover";
import { FIELD_HELP, type Concept } from "@/lib/fieldHelp";

/**
 * A `?` help affordance next to a field or section: surfaces a one-line
 * explanation on hover / focus, pinned on click, dismissed by outside-click,
 * Escape, scroll, or pointer-leave. The machinery lives in
 * `usePinnedPopover` (shared with `TrustBadge`), including the portal +
 * viewport clamp so an `overflow` ancestor (e.g. the map detail side panel)
 * can't clip the tooltip.
 *
 * Takes a single `concept` key: the explanation text and the accessible label
 * both come from the one registry in `lib/fieldHelp.ts`, so the same concept
 * reads identically everywhere it appears and never drifts between them.
 *
 * Neutral, not orange: it's meta help, not a content action — orange stays
 * reserved for primary affordances.
 */
export function FieldHelp({
  concept,
  size = 13,
}: {
  concept: Concept;
  size?: number;
}) {
  const { text, label } = FIELD_HELP[concept];
  const { open, pinned, wrapperProps, anchorProps, popoverProps } =
    usePinnedPopover();
  const tooltipId = useId();
  const hidden = useHelpHidden();

  // Power-user opt-out: hide every `?` (toggle on the settings page). Sections
  // carry no always-on subtitle, so with help hidden the form is just labels
  // and fields — the intended power-user view.
  if (hidden) return null;

  return (
    <span {...wrapperProps} className="inline-flex items-center align-middle">
      <button
        {...anchorProps}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={pinned}
        className="inline-flex items-center text-neutral-500 hover:text-neutral-300 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs transition-colors"
      >
        <HelpCircle size={size} strokeWidth={1.8} />
      </button>
      {open &&
        createPortal(
          <span
            {...popoverProps}
            role="tooltip"
            id={tooltipId}
            className="z-[2000] w-max max-w-xs px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 leading-relaxed font-normal normal-case tracking-normal shadow-lg"
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}
