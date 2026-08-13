"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import type { EventDetail } from "@/types";
import { TEXT_LINK } from "@/components/ui/styles";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import ShareButtons from "@/components/event/ShareButtons";
import { EventDetailBody } from "@/components/event/EventDetailBody";

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
                the action row sit flush with the panel's content edge. */}
            <h2 className="text-lg font-medium text-neutral-100 pr-6">
              {detail.title}
            </h2>
            {/* The panel's actions ride the byline row, right-aligned under the
                title and clear of the close button, so this surface puts its
                controls in the same top-right spot the two detail pages do.
                Same ShareButtons as those pages, so tweet and clipboard output
                stays in sync across every share surface. */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-400">
                <AuthorByline author={detail.owner} size="xs" avatar />
              </p>
              <div className="flex items-center gap-3 shrink-0">
                <ShareButtons
                  id={detail.id}
                  title={detail.title}
                  author={detail.owner.username}
                  eventDate={detail.event_date}
                  lat={detail.event_coords?.lat ?? null}
                  lng={detail.event_coords?.lng ?? null}
                  status={detail.status}
                />
                <Link
                  href={`/events/${detail.id}`}
                  className={`flex items-center gap-1 text-[11px] shrink-0 ${TEXT_LINK}`}
                >
                  Full page
                  <ExternalLink size={11} />
                </Link>
              </div>
            </div>
          </div>

          <EventDetailBody geo={detail} variant="panel" />
        </div>
      )}
    </div>
  );
}
