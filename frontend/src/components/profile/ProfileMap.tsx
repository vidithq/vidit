"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { filterPointsByStatus, type MapPoint } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AUTHOR_FILTER_RE } from "@/lib/search";
import { WORLD_BBOX, hasFiniteCoords, pointsBounds } from "@/components/map/bounds";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

// Same dynamic import as the map page and the event detail page: MapLibre
// touches `window` at module scope, so it never server-renders.
const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * The analyst's own geolocations on a map, framed on their work.
 *
 * One fetch of `/events/points?author=…`, the author filter the map page
 * already uses, with an explicit world `bbox` so the request asks for the
 * whole body of work rather than a viewport slice. The camera is fitted to
 * the returned points (`fitBounds` on the shared `<Map>`), so a profile
 * opens on the region the analyst covers instead of a default camera.
 *
 * Only published work is mapped. The endpoint also serves `detected` rows
 * (machine drafts nobody has vouched for) and demo rows, neither of which is
 * portfolio evidence, and counting them here contradicted the Submitted tile
 * above. Demo rows are dropped by the endpoint's own `hide_demo`; the status
 * narrowing has no server-side parameter, so it runs on the payload through
 * the shared `filterPointsByStatus`.
 *
 * Renders nothing until the points arrive and nothing at all for an analyst
 * with no located events (a requests-only profile gets no empty world map);
 * a failed fetch hides the section rather than blocking the profile, matching
 * `ProfileInsights`.
 */
export function ProfileMap({ username }: { username: string }) {
  const router = useRouter();
  // The charset gate the map page applies before committing an author value:
  // an ineligible one 422s server-side. A null path skips the fetch entirely
  // (`useApiResource`), so an ineligible handle makes no request.
  const path = AUTHOR_FILTER_RE.test(username)
    ? `/events/points?author=${encodeURIComponent(username)}` +
      `&hide_demo=true&bbox=${WORLD_BBOX}`
    : null;
  const { data } = useApiResource<MapPoint[]>(path);
  // One subset drives the camera and the count, so the two can never report
  // different maps.
  const points = useMemo(
    () => filterPointsByStatus(data ?? [], ["geolocated"]).filter(hasFiniteCoords),
    [data]
  );
  const bounds = useMemo(() => pointsBounds(points), [points]);

  if (!bounds) return null;

  return (
    <Card as="section">
      <div className="flex items-center justify-between gap-3">
        <SectionEyebrow title="Coverage" margin="none" />
        <span className="text-xs text-neutral-500">
          {points.length} on the map
        </span>
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
        />
      </div>
    </Card>
  );
}
