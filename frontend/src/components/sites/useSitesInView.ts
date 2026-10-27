import { useCallback, useState } from "react";

import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { apiFetch } from "@/lib/api";
import { sitesPath, type SiteListItem } from "@/lib/sites";
import { VIEWPORT_DEBOUNCE_MS, padBounds, toBboxParam, type MapBounds } from "@/lib/viewport";
import type { MapSite } from "@/components/map/SiteLayers";

export function toMapSite(site: Pick<SiteListItem, "id" | "zone" | "centroid">): MapSite {
  return { id: site.id, zone: site.zone, centroid: site.centroid };
}

/** The current zones around a map's viewport, for a map that shows sites as context (the zone
 *  editor). Hand `onBoundsChange` to the map. */
export function useSitesInView(): [MapSite[], (bounds: MapBounds) => void] {
  const [bbox, setBbox] = useState<string | null>(null);
  const [sites, setSites] = useState<MapSite[]>([]);
  const onBoundsChange = useCallback((bounds: MapBounds) => {
    setBbox(toBboxParam(padBounds(bounds)));
  }, []);
  useDebouncedEffect(
    () => {
      if (!bbox) return;
      const controller = new AbortController();
      apiFetch<SiteListItem[]>(sitesPath(bbox, null), { signal: controller.signal })
        .then((rows) => setSites(rows.map(toMapSite)))
        .catch(() => {});
      return () => controller.abort();
    },
    [bbox],
    VIEWPORT_DEBOUNCE_MS,
  );
  return [sites, onBoundsChange];
}
