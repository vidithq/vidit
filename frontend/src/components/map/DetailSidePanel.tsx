"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { EventDetail } from "@/types";
import { TEXT_LINK } from "@/components/ui/styles";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { useEventActions } from "@/components/event/useEventActions";

interface DetailSidePanelProps {
  /** Null while the selected geolocation is still loading. */
  detail: EventDetail | null;
  loading: boolean;
  onClose: () => void;
}

/**
 * The map's detail overlay. `max-h-[calc(100vh-4.5rem)]` rather than a
 * pinned `bottom-14` so the panel shrinks to its content (no grey filler)
 * yet still caps and scrolls when content is long. 4.5rem = top-4 (1rem)
 * + 3.5rem clearance to keep the bottom pill off the panel even on hover.
 */
export function DetailSidePanel({ detail, loading, onClose }: DetailSidePanelProps) {
  // The panel is a reading surface, so it takes the utilities tier only: the
  // share pair and the report flag, in the same order and the same spot the
  // detail pages put them. Called before the loading branch, as every hook must
  // be; `detail` is null until the row lands.
  const { actions, panels } = useEventActions({ event: detail, surface: "panel" });

  return (
    <div className="absolute top-4 right-4 max-h-[calc(100vh-4.5rem)] z-1000 w-96 bg-neutral-900 rounded-lg border border-neutral-700 overflow-y-auto">
      <Button
        icon
        variant="ghost"
        onClick={onClose}
        aria-label="Close detail panel"
        className="absolute top-3 right-3 z-10 text-lg"
      >
        &times;
      </Button>

      {loading || !detail ? (
        <div className="flex items-center justify-center h-full">
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
            {/* The panel's actions ride the byline row, right-aligned under the
                title and clear of the close button, so this surface puts its
                controls in the same top-right spot the two detail pages do.
                The same shared cluster as those pages, so tweet and clipboard
                output and the report form stay in sync across every surface.
                Navigation lives on the title permalink above, so the row
                carries actions only. */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-400">
                <AuthorByline author={detail.owner} size="xs" avatar />
              </p>
              <div className="flex items-center gap-3 shrink-0">{actions}</div>
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
