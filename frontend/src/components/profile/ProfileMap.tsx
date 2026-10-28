"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import type { MapPoint } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AUTHOR_FILTER_RE } from "@/lib/search";
import { hasFiniteCoords, pointsBounds } from "@/components/map/bounds";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { WORLD_BOUNDS, toBboxParam } from "@/lib/viewport";
import { eventHref } from "@/lib/routes";

// Dynamic import as on the map and event pages: MapLibre touches `window` at module scope, so it never server-renders.
const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * The analyst's own geolocations on a map: the profile's Coverage card. One fetch of
 * `/events/points?author=...` with an explicit world `bbox` (the whole body of work, not a
 * viewport slice). The camera fits the returned points (`fitBounds` on the shared `<Map>`), and
 * `embedded` hands the one-finger swipe back to the page.
 *
 * Both live statuses are mapped: `geolocated` submissions and the `detected` machine detections,
 * which `<Map>` paints in its own shade, as on `/map`.
 *
 * No count prints beside the heading: the Insights card's `Geolocated` and `Detected` tiles hold
 * the figures once.
 *
 * Renders nothing until the points arrive, for an analyst with no located event, or after a failed
 * fetch (matching `ProfileInsights`).
 */
export function ProfileMap({ username }: { username: string }) {
  const router = useRouter();
  // The charset gate the map page applies before committing an author value (an ineligible one
  // 422s). A null path skips the fetch (`useApiResource`).
  const path = AUTHOR_FILTER_RE.test(username)
    ? `/events/points?author=${encodeURIComponent(username)}` +
      `&bbox=${toBboxParam(WORLD_BOUNDS)}`
    : null;
  const { data } = useApiResource<MapPoint[]>(path);
  const points = useMemo(() => (data ?? []).filter(hasFiniteCoords), [data]);
  const bounds = useMemo(() => pointsBounds(points), [points]);

  if (!bounds) return null;

  return (
    <Card as="section">
      <SectionEyebrow title="Coverage" margin="none" />

      {/* Same embedded-map shape as the event page: fixed height, rounded corners clipped on the map
          alone. Taller from `sm` up so a phone keeps the map within thumb reach. */}
      <div className="h-64 sm:h-80 overflow-hidden rounded-lg border border-neutral-700">
        <Map
          points={points}
          fitBounds={bounds}
          onPointClick={(id) => router.push(eventHref(id))}
          embedded
        />
      </div>
    </Card>
  );
}
