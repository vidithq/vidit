"use client";

import { useId } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

import { useHelpHidden } from "@/hooks/useHelpHidden";
import { usePinnedPopover } from "@/hooks/usePinnedPopover";
import { FIELD_HELP, type Concept } from "@/lib/fieldHelp";

/**
 * A `?` help affordance next to a field or section: a one-line explanation on
 * hover / focus, pinned on click, dismissed by outside-click, Escape, scroll or
 * pointer-leave. `usePinnedPopover` owns the machinery, including the portal and
 * viewport clamp so an `overflow` ancestor (the map detail side panel) can't
 * clip it.
 *
 * Takes a `concept` key: the text and accessible label come from the one
 * registry in `lib/fieldHelp.ts`.
 *
 * Neutral, not orange: orange stays reserved for primary affordances.
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

  // Power-user opt-out (settings page toggle).
  if (hidden) return null;

  return (
    <span {...wrapperProps} className="inline-flex items-center align-middle">
      <button
        {...anchorProps}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={pinned}
        /* On a phone the padding and negative margin grow the hit area to 29 by
           25px around the 13px glyph. The vertical bleed is capped at 6px (the
           label-to-input gap) so a tap just below still lands on the input.
           `usePinnedPopover` measures the bigger box. Desktop keeps the bare
           glyph, where the extra box would swallow hover on the label. */
        className="inline-flex items-center px-2 py-1.5 -mx-2 -my-1.5 sm:px-0 sm:py-0 sm:mx-0 sm:my-0 text-neutral-500 hover:text-neutral-300 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs transition-colors"
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
