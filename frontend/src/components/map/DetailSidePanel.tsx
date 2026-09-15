"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { EventDetail } from "@/types";
import { cn } from "@/lib/cn";
import { TEXT_LINK } from "@/components/ui/styles";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { useEventActions } from "@/components/event/useEventActions";

/** Where the panel sits.
 *
 *  `overlay` is the map page: a card floating over a full-screen canvas,
 *  pinned in from the top-right corner and a bottom sheet below `sm`, so it
 *  takes the display cutout as margins from `sm` up and as padding on the
 *  three edges the sheet touches.
 *
 *  `inline` is the collection page's step player: a column of its own beside
 *  the map inside a card, stacking under it below `sm`. It floats over
 *  nothing, so it takes no viewport insets, no sheet and no height cap of its
 *  own: it fills the block its caller sized and scrolls inside it. */
type DetailSidePanelPlacement = "overlay" | "inline";

const PLACEMENT: Record<DetailSidePanelPlacement, string> = {
  overlay:
    "absolute top-4 right-4 sm:safe-mt sm:safe-mr max-h-[calc(100dvh-4.5rem)] z-1000 w-96 max-sm:top-auto max-sm:bottom-0 max-sm:inset-x-0 max-sm:w-auto max-sm:max-h-[60dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:safe-pb max-sm:safe-pl max-sm:safe-pr max-sm:border-b-0",
  inline: "relative w-full sm:w-96 sm:shrink-0 sm:h-full",
};

interface DetailSidePanelProps {
  /** Null while the selected geolocation is still loading. */
  detail: EventDetail | null;
  loading: boolean;
  /** Closes the panel. Absent on a surface the panel does not float over (the
   *  collection page's player, which is a block of the page), where there is
   *  nothing to close it back to. */
  onClose?: () => void;
  /** Chrome pinned to the panel's top edge, above the event: the step header
   *  on the collection page. It stays put while the body scrolls and outlives
   *  the event under it, so stepping keeps the reader's controls still. */
  header?: ReactNode;
  placement?: DetailSidePanelPlacement;
}

/**
 * The map's detail overlay. `max-h-[calc(100dvh-4.5rem)]` rather than a
 * pinned `bottom-14` so the panel shrinks to its content (no grey filler)
 * yet still caps and scrolls when content is long. 4.5rem = top-4 (1rem)
 * + 3.5rem clearance to keep the bottom pill off the panel even on hover.
 * `dvh` and not `vh`, so the cap follows the iOS URL bar rather than the
 * taller viewport it hides.
 *
 * Below `sm` the same panel is a bottom sheet: a 384px card pinned to the
 * right runs off a 375px viewport, and the map page clips it (`overflow-hidden`).
 * It spans the width, sits on the bottom edge (square there, rounded on top,
 * borderless where it meets the edge), caps at 60dvh and scrolls its own
 * content. The sheet covers the map's bottom-left zoom control while open;
 * closing it hands the control back.
 *
 * `placement="inline"` drops all of that for the collection page's step
 * player, where the panel is a column of the page rather than a card over a
 * canvas: no insets, no sheet, no cap of its own, and the height comes from
 * the block the caller sized.
 *
 * `header` sticks to the panel's top edge inside the scroll, for a surface
 * that reads a whole set through this panel. It sits outside the loading
 * branch, so chrome saying where in the set the reader is stays on screen
 * while the next event lands.
 */
export function DetailSidePanel({
  detail,
  loading,
  onClose,
  header,
  placement = "overlay",
}: DetailSidePanelProps) {
  // The panel takes no tier at all: it previews a row whose own page is one
  // click away on the title, and acting on a record from a hover-sized preview
  // of it puts the same controls in two places. The call stays because the
  // grammar decides that, not this component, and it hands back the slots a
  // future tier would land in. Called before the loading branch, as every hook
  // must be; `detail` is null until the row lands.
  const { actions, panels } = useEventActions({ event: detail, surface: "panel" });

  const overlaid = placement === "overlay";

  return (
    // The box and its paint are one string for both placements; where it sits
    // is the `PLACEMENT` entry, which is the only thing the two differ by. The
    // display cutout is part of that (docs/design.md -> Phone chrome): the
    // overlay floats a set distance in from the top-right corner, so the
    // insets are margins that move the whole box clear, and below `sm` it is a
    // sheet on the bottom edge taking them as padding on the three sides it
    // touches.
    <div
      className={cn(
        "bg-neutral-900 rounded-lg border border-neutral-700 overflow-y-auto",
        PLACEMENT[placement],
      )}
    >
      {/* The sheet's grab bar, phone only and overlay only: the sheet has no
          top edge of its own against the map, and the bar is what says the
          panel is the surface that scrolls. An inline panel is a block of a
          scrolling page and scrolls with it, so it has nothing to say.
          Centred, so it clears the close button in the same 40px strip;
          decorative, so it takes no pointer and no name. */}
      {overlaid && (
        <div className="sm:hidden flex justify-center py-2" aria-hidden="true">
          <div className="h-1 w-9 rounded-full bg-neutral-600" />
        </div>
      )}

      {onClose && (
        <Button
          icon
          variant="ghost"
          onClick={onClose}
          aria-label="Close detail panel"
          title="Close detail panel"
          className="absolute top-3 right-3 z-10 text-lg"
        >
          &times;
        </Button>
      )}

      {/* `sticky`, not a flex column with a scrolling middle: the panel sizes
          itself to its content and scrolls as one box, so pinning an edge is
          what keeps that shape while the chrome holds still. */}
      {header && (
        <div className="sticky top-0 z-20 bg-neutral-900">{header}</div>
      )}

      {loading || !detail ? (
        // `min-h-32` under the `h-full`: an inline panel stacked under the map
        // on a phone is sized by its content, so a `h-full` box holding one
        // line would collapse to that line and the chrome above it would jump
        // on every step.
        <div className="flex items-center justify-center h-full min-h-32">
          <span className="text-neutral-500 text-sm">Loading...</span>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {/* `pr-6` on the heading alone: it is the line the absolute close
                button overlaps, and keeping the inset off the block below lets
                the action row sit flush with the panel's content edge. The
                title is the permalink to the event page, an explicit TEXT_LINK
                like every other in-app link in this rich preview (the byline
                below, requested-by in the body); no external glyph, since that
                marks external destinations only (ArchivedCopies). */}
            <h2 className="text-lg font-medium pr-6">
              <Link
                href={`/events/${detail.id}`}
                className={`text-neutral-100 ${TEXT_LINK}`}
              >
                {detail.title}
                {/* ArrowRight, the in-app navigation glyph (detections entry,
                    landing CTAs); the external ↗ stays reserved for external
                    destinations. Inline so it rides the last line of a
                    wrapped title instead of breaking the wrap. */}
                <ArrowRight size={14} className="ml-1 inline align-[-2px]" />
              </Link>
            </h2>
            {/* The byline alone under the title. Anything the grammar hands
                back rides the same row, right-aligned and clear of the close
                button, so a tier this surface ever takes lands in the top-right
                spot the two detail pages use; it carries none today. */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-400">
                <AuthorByline author={detail.owner} size="xs" avatar />
              </p>
              {actions && (
                <div className="flex items-center gap-3 shrink-0">{actions}</div>
              )}
            </div>
          </div>

          {/* Under the byline row, where the trigger that opened it is. */}
          {panels}

          <EventDetailBody geo={detail} variant="panel" />
        </div>
      )}

    </div>
  );
}
