"use client";

import { useMemo } from "react";

import { filterPointsByStatus, type MapPoint } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AUTHOR_FILTER_RE } from "@/lib/search";
import { hasFiniteCoords } from "@/components/map/bounds";
import { CoverageMap } from "@/components/map/CoverageMap";
import { WORLD_BOUNDS, toBboxParam } from "@/lib/viewport";

/**
 * The analyst's own geolocations on a map, framed on their work.
 *
 * One fetch of `/events/points?author=…`, the author filter the map page
 * already uses, with an explicit world `bbox` so the request asks for the
 * whole body of work rather than a viewport slice. The card itself is the
 * shared `<CoverageMap>`, which a collection page opens with too, so the two
 * maps cannot drift into two boxes.
 *
 * Both live statuses are mapped: `geolocated` submissions and the `detected`
 * machine detections behind them, which the shared `<Map>` already paints in its
 * own shade from the point tuple's `detected` flag, so the two read apart on a
 * profile exactly as they do on `/map`.
 *
 * The count beside the heading splits on the same statuses, under the status
 * names the Insights card below uses (`Geolocated`, `Detected`), so a reader
 * can't find two numbers on one page claiming to count the same thing. Its
 * `geolocated` leg is the `Geolocated` tile's figure on the Insights card,
 * which is why the split is spelled out rather than totalled: an unsplit count
 * here would print a number larger than that tile with nothing on the page to
 * explain the gap.
 *
 * Renders nothing until the points arrive and nothing at all for an analyst
 * with no located events (a requests-only profile gets no empty world map);
 * a failed fetch hides the section rather than blocking the profile, matching
 * `ProfileInsights`.
 */
export function ProfileMap({ username }: { username: string }) {
  // The charset gate the map page applies before committing an author value:
  // an ineligible one 422s server-side. A null path skips the fetch entirely
  // (`useApiResource`), so an ineligible handle makes no request.
  const path = AUTHOR_FILTER_RE.test(username)
    ? `/events/points?author=${encodeURIComponent(username)}` +
      `&bbox=${toBboxParam(WORLD_BOUNDS)}`
    : null;
  const { data } = useApiResource<MapPoint[]>(path);
  // One set drives the camera and the counts, so the two can never report
  // different maps.
  const points = useMemo(() => (data ?? []).filter(hasFiniteCoords), [data]);
  const detectedCount = useMemo(
    () => filterPointsByStatus(points, ["detected"]).length,
    [points]
  );

  const geolocatedCount = points.length - detectedCount;
  const counts = [`${geolocatedCount} geolocated`];
  if (detectedCount > 0) counts.push(`${detectedCount} detected`);

  return <CoverageMap points={points} caption={`${counts.join(", ")} on the map`} />;
}
