"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { filterPointsByStatus } from "@/types";
import type { MapPoint, EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { appendEventFilterParams } from "@/lib/search";
import {
  VIEWPORT_DEBOUNCE_MS,
  boundsContain,
  padBounds,
  toBboxParam,
  type MapBounds,
} from "@/lib/viewport";
import { DetailSidePanel } from "@/components/map/DetailSidePanel";
import { FilterPanel } from "@/components/map/FilterPanel";
import { SitePanel, SitePreview } from "@/components/map/SitePanel";
import { useMapState } from "@/contexts/MapStateContext";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { toMapSite } from "@/components/sites/useSitesInView";
import {
  sitePath,
  sitesAsOf,
  sitesPath,
  todayUtc,
  zoneEmphasis,
  type Site,
  type SiteListItem,
} from "@/lib/sites";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });
const SiteLayers = dynamic(
  () => import("@/components/map/SiteLayers").then((m) => m.SiteLayers),
  { ssr: false },
);

export default function HomePage() {
  // Navigation-surviving state lives in MapStateContext; the page reads only filter values (setters live with FilterPanel).
  const {
    viewState,
    setViewState,
    selectedId,
    setSelectedId,
    filters,
    dateWindows,
    sitesShown,
    selectedSiteId,
    setSelectedSiteId,
  } = useMapState();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  // The `?bbox=` loaded; `/events/points` serves one viewport, so nothing fetches until the first bounds.
  const [bbox, setBbox] = useState<string | null>(null);
  // The padded region those points cover; a viewport inside it needs no request.
  const coveredRef = useRef<MapBounds | null>(null);
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { tags, conflicts } = useFilterVocabulary();
  // Keyed on the selection in context, so returning to the map re-reads it.
  const detail = useApiResource<EventDetail>(
    selectedId ? `/events/${selectedId}` : null,
  );
  const siteDetail = useApiResource<Site>(
    sitesShown && selectedSiteId ? sitePath(selectedSiteId) : null,
  );
  const [sites, setSites] = useState<SiteListItem[]>([]);
  // The zone a site shows is the one valid at the end of the event date window.
  const asOf = sitesAsOf(dateWindows.eventTo, todayUtc());
  const abortRef = useRef<AbortController | null>(null);

  const fetchPoints = useCallback(() => {
    if (!bbox) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    // Required: the endpoint 422s without it, and the viewport bounds the payload.
    params.set("bbox", bbox);
    appendEventFilterParams(params, {
      conflicts: filters.conflicts,
      sourceKinds: filters.sourceKinds,
      levels: filters.levels,
      tags: filters.tags,
      mediaTypes: filters.mediaTypes,
      author: filters.author,
      approved: filters.approved,
      approvedBy: filters.approvedBy,
    });

    setLoading(true);
    apiFetch<MapPoint[]>(`/events/points?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(setPoints)
      .catch(() => {
        // Coverage is claimed at request time: drop the claim on a real failure so the next move-end retries. Skip when superseded.
        if (abortRef.current === controller) coveredRef.current = null;
      })
      .finally(() => {
        // A superseded request must not clear the spinner its replacement raised.
        if (abortRef.current === controller) setLoading(false);
      });
    // Per-bucket deps: status and date windows are client-side, so a status chip must not refetch.
  }, [
    bbox,
    filters.conflicts,
    filters.sourceKinds,
    filters.levels,
    filters.tags,
    filters.mediaTypes,
    filters.author,
    filters.approved,
    filters.approvedBy,
  ]);

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  // Debounced so scrubbing the event date window settles into one request per resting date.
  useDebouncedEffect(
    () => {
      if (!sitesShown || !bbox) return;
      const controller = new AbortController();
      apiFetch<SiteListItem[]>(sitesPath(bbox, asOf), { signal: controller.signal })
        .then(setSites)
        .catch(() => {});
      return () => controller.abort();
    },
    [sitesShown, bbox, asOf],
    VIEWPORT_DEBOUNCE_MS,
  );

  const mapSites = useMemo(
    () =>
      sitesShown
        ? sites.map((site) => ({
            ...toMapSite(site),
            emphasis: zoneEmphasis(site),
          }))
        : [],
    [sites, sitesShown],
  );

  const renderSitePreview = useCallback(
    (id: string) => {
      const site = sites.find((s) => s.id === id);
      return site ? <SitePreview site={site} /> : null;
    },
    [sites],
  );

  // One panel at a time: a pin closes the site panel, a site closes the event panel.
  const selectEvent = useCallback(
    (id: string | null) => {
      setSelectedSiteId(null);
      setSelectedId(id);
    },
    [setSelectedId, setSelectedSiteId],
  );
  const selectSite = useCallback(
    (id: string) => {
      setSelectedId(null);
      setSelectedSiteId(id);
    },
    [setSelectedId, setSelectedSiteId],
  );

  // Debounced so a drag or wheel zoom settles into one request; a containment check drops pans that need no new points.
  const handleBoundsChange = useCallback((next: MapBounds) => {
    const apply = () => {
      const covered = coveredRef.current;
      if (covered && boundsContain(covered, next)) return;
      const padded = padBounds(next);
      coveredRef.current = padded;
      setBbox(toBboxParam(padded));
    };
    if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
    // The first viewport is the initial load: no debounce.
    if (coveredRef.current === null) {
      apply();
      return;
    }
    boundsTimerRef.current = setTimeout(() => {
      boundsTimerRef.current = null;
      apply();
    }, VIEWPORT_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
    },
    []
  );

  // Status chips and both timeline windows filter client-side (`POINT_DETECTED_FLAG`, event and added dates): any-of status, empty = all.
  const visiblePoints = useMemo(() => {
    const statusFiltered = filterPointsByStatus(points, filters.statuses);
    const { eventFrom, eventTo, addedFrom, addedTo } = dateWindows;
    if (!eventFrom && !eventTo && !addedFrom && !addedTo) return statusFiltered;
    const lo = (iso: string) => (iso ? Date.parse(`${iso}T00:00:00Z`) : -Infinity);
    const hi = (iso: string) => (iso ? Date.parse(`${iso}T23:59:59Z`) : Infinity);
    const evLo = lo(eventFrom);
    const evHi = hi(eventTo);
    const subLo = lo(addedFrom);
    const subHi = hi(addedTo);
    return statusFiltered.filter((p) => {
      // A missing or unparseable date (occurred_date is optional) is unconstrained, like the histogram, so the point is not dropped.
      const ev = p[3] ? Date.parse(`${p[3]}T00:00:00Z`) : NaN;
      const sub = p[4] ? Date.parse(`${p[4]}T00:00:00Z`) : NaN;
      const evOk = Number.isNaN(ev) || (ev >= evLo && ev <= evHi);
      const subOk = Number.isNaN(sub) || (sub >= subLo && sub <= subHi);
      return evOk && subOk;
    });
  }, [points, filters.statuses, dateWindows]);

  return (
    <div className="h-dvh w-screen relative overflow-hidden bg-neutral-950">
      <Map
        points={visiblePoints}
        selectedId={selectedId}
        onPointClick={selectEvent}
        className="map-fullscreen"
        center={{ lat: viewState.latitude, lng: viewState.longitude }}
        zoom={viewState.zoom}
        onViewChange={setViewState}
        onBoundsChange={handleBoundsChange}
      >
        {sitesShown && (
          <SiteLayers
            sites={mapSites}
            selectedId={selectedSiteId}
            onSelect={selectSite}
            renderPreview={renderSitePreview}
          />
        )}
      </Map>

      <FilterPanel
        tags={tags}
        conflicts={conflicts}
        points={points}
        pointCount={visiblePoints.length}
        loading={loading}
      />

      {/* One side panel slot: the event or the site selected, both on `MapSidePanel`. */}
      {selectedId ? (
        <DetailSidePanel
          // Keyed by event so per-event state (report form, optimistic flags) starts clean.
          key={selectedId}
          resource={detail}
          onClose={() => setSelectedId(null)}
        />
      ) : sitesShown && selectedSiteId ? (
        <SitePanel resource={siteDetail} onClose={() => setSelectedSiteId(null)} />
      ) : null}
    </div>
  );
}
