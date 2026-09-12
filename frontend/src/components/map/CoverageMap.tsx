"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { pointsBounds } from "@/components/map/bounds";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import type { MapPoint } from "@/types";

// Same dynamic import as the map page and the event detail page: MapLibre
// touches `window` at module scope, so it never server-renders.
const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * A set of events on a map, framed on the set: the Coverage card the profile
 * and a collection page both open their work with.
 *
 * One card for the two surfaces, so an analyst's map and a collection's map are
 * the same box at the same heights and a click on a pin goes the same place.
 * The camera is fitted to the points handed in (`fitBounds` on the shared
 * `<Map>`), so the map opens on the region the set covers rather than on a
 * default camera, and `embedded` hands the one-finger swipe back to the page.
 *
 * `caption` is the count beside the heading, which each surface words in its
 * own vocabulary: the profile splits its two statuses to stay honest against
 * the Insights card beside it, and a collection counts items.
 *
 * A set with no mappable point renders nothing at all: an empty world map says
 * less than no map, and both callers have a list under it that says the rest.
 */
export function CoverageMap({
  points,
  caption,
}: {
  points: MapPoint[];
  caption: string;
}) {
  const router = useRouter();
  const bounds = useMemo(() => pointsBounds(points), [points]);

  if (!bounds) return null;

  return (
    <Card as="section">
      <div className="flex items-center justify-between gap-3">
        <SectionEyebrow title="Coverage" margin="none" />
        <span className="text-xs text-neutral-500">{caption}</span>
      </div>

      {/* Same embedded-map shape as the event detail page: a fixed height with
          the rounded corners clipped on the map alone. Taller from `sm` up, so
          a phone keeps the map under a thumb's reach and a laptop gets a real
          canvas. */}
      <div className="h-64 sm:h-80 overflow-hidden rounded-lg border border-neutral-700">
        <Map
          points={points}
          fitBounds={bounds}
          onPointClick={(id) => router.push(`/events/${id}`)}
          embedded
        />
      </div>
    </Card>
  );
}
