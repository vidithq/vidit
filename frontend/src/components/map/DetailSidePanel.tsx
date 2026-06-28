"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import type { GeolocationDetail } from "@/types";
import TrustBadge from "@/components/profile/TrustBadge";
import ShareButtons from "@/components/geolocation/ShareButtons";
import { GeolocationDetailBody } from "@/components/geolocation/GeolocationDetailBody";

interface DetailSidePanelProps {
  /** Null while the selected geolocation is still loading. */
  detail: GeolocationDetail | null;
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
      <button
        onClick={onClose}
        aria-label="Close detail panel"
        className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-300 text-lg z-10"
      >
        &times;
      </button>

      {loading || !detail ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-neutral-500 text-sm">Loading...</span>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="pr-6 space-y-2">
            <h2 className="text-lg font-medium text-neutral-100">
              {detail.title}
            </h2>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-400 inline-flex items-center gap-1">
                by{" "}
                <Link
                  href={`/profile/${detail.author.username}`}
                  className="text-orange-400 hover:underline transition-colors"
                >
                  {detail.author.username}
                </Link>
                <TrustBadge
                  isTrusted={detail.author.is_trusted}
                  trustReason={detail.author.trust_reason}
                  size={12}
                />
              </p>
            </div>
          </div>

          <GeolocationDetailBody geo={detail} variant="panel" />

          {/* Same ShareButtons as the detail page so tweet/clipboard
              output stays in sync across both share surfaces. */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-neutral-800">
            <ShareButtons
              id={detail.id}
              title={detail.title}
              author={detail.author.username}
              eventDate={detail.event_date}
              lat={detail.lat}
              lng={detail.lng}
              status={detail.status}
            />
            <Link
              href={`/geolocations/${detail.id}`}
              className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors shrink-0"
            >
              Full page
              <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
