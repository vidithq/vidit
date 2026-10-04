"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { EventDetail } from "@/types";
import type { ApiResource } from "@/hooks/useApiResource";
import { cn } from "@/lib/cn";
import { TEXT_LINK } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { useEventActions } from "@/components/event/useEventActions";

/** Where the panel sits. `overlay`: a card over the full-screen map page (a bottom sheet below
 * `sm`), taking the display cutout as margins from `sm` up and as padding on the sheet's three
 * edges. `inline`: the collection step player's own column beside the map, with no insets, sheet
 * or height cap: it fills the block its caller sized. */
type DetailSidePanelPlacement = "overlay" | "inline";

const PLACEMENT: Record<DetailSidePanelPlacement, string> = {
  overlay:
    "absolute top-4 right-4 sm:safe-mt sm:safe-mr max-h-[calc(100dvh-4.5rem)] z-1000 w-96 max-sm:top-auto max-sm:bottom-0 max-sm:inset-x-0 max-sm:w-auto max-sm:max-h-[60dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:safe-pb max-sm:safe-pl max-sm:safe-pr max-sm:border-b-0",
  inline: "relative w-full sm:w-96 sm:shrink-0 sm:h-full",
};

interface DetailSidePanelProps {
  /** The selected event's read from `useApiResource`: one prop so no caller drops the error.
   * `data` is null while loading or after a failed load. */
  resource: ApiResource<EventDetail>;
  /** Closes the panel. Absent where the panel does not float (the collection player). */
  onClose?: () => void;
  /** Chrome pinned to the panel's top edge, above the event (the collection step header). Outlives the event under it. */
  header?: ReactNode;
  placement?: DetailSidePanelPlacement;
}

/**
 * The map's detail overlay. `max-h-[calc(100dvh-4.5rem)]`, not a pinned `bottom-14`, so the panel
 * shrinks to its content yet caps and scrolls when long (4.5rem = top-4 plus 3.5rem clearance for
 * the bottom pill). `dvh` so the cap follows the iOS URL bar.
 *
 * Below `sm` it is a bottom sheet: a 384px card pinned right runs off a 375px viewport. It spans
 * the width, caps at 60dvh, scrolls its own content, and covers the map's zoom control while open.
 *
 * `placement="inline"` drops the insets, sheet and cap; the height comes from the caller's block.
 * `header` sticks to the top edge inside the scroll and sits outside the loading branch, so it
 * stays on screen while the next event lands.
 */
export function DetailSidePanel({
  resource,
  onClose,
  header,
  placement = "overlay",
}: DetailSidePanelProps) {
  // The panel takes no tier: it previews a row whose page is one click away, and acting from a
  // preview would put the same controls in two places. The call stays because the grammar decides
  // that. Called before the loading branch (hooks); `detail` is null until the row lands.
  const { data: detail, error, loading, refetch } = resource;
  const { actions, panels } = useEventActions({ event: detail, surface: "panel" });

  const overlaid = placement === "overlay";

  return (
    // Box and paint are shared by both placements; `PLACEMENT` holds the only difference. The display
    // cutout is part of it (docs/design.md, Phone chrome): margins on the overlay, padding on the
    // sheet's three edges.
    <div
      className={cn(
        "bg-neutral-900 rounded-lg border border-neutral-700 overflow-y-auto",
        PLACEMENT[placement],
      )}
    >
      {/* Sheet grab bar (phone, overlay only): the sheet has no top edge against the map. Centred to
          clear the close button; decorative. */}
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

      {/* `sticky`, not a scrolling middle: the panel scrolls as one box and pinning keeps that shape. */}
      {header && (
        <div className="sticky top-0 z-20 bg-neutral-900">{header}</div>
      )}

      {error !== null ? (
        // `min-h-32` matches the loading box so the chrome holds still; `pr-12` only with a close button.
        <div className={cn("p-4 space-y-3 min-h-32", onClose && "pr-12")}>
          <div className={FORM_ERROR_BANNER} role="alert">
            {error || "Couldn't load this event."}
          </div>
          <Button variant="secondary" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        // `min-h-32` under `h-full`: an inline panel under the map on a phone is content-sized and would
        // collapse, jumping the chrome on every step.
        <div className="flex items-center justify-center h-full min-h-32">
          <span className="text-neutral-500 text-sm">Loading...</span>
        </div>
      ) : detail ? (
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {/* `pr-6` on the heading alone: the absolute close button overlaps it, and the action row stays
                flush below. The title is an explicit TEXT_LINK permalink; no external glyph (ArchivedCopies
                marks external only). */}
            <h2 className="text-lg font-medium pr-6">
              <Link
                href={`/events/${detail.id}`}
                className={`text-neutral-100 ${TEXT_LINK}`}
              >
                {detail.title}
                {/* ArrowRight, the in-app navigation glyph; inline so it rides the last line of a wrapped title. */}
                <ArrowRight size={14} className="ml-1 inline align-[-2px]" />
              </Link>
            </h2>
            {/* Byline alone under the title; anything the grammar returns rides this row (none today). */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-400">
                <AuthorByline author={detail.owner} size="xs" avatar />
              </p>
              {actions && (
                <div className="flex items-center gap-3 shrink-0">{actions}</div>
              )}
            </div>
          </div>

          {panels}

          <EventDetailBody geo={detail} variant="panel" />
        </div>
      ) : null}

    </div>
  );
}
