"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { POINT_DETECTED_FLAG, type MapPoint, type EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { readError, type ReadableError } from "@/lib/errors";
import { appendEventFilterParams } from "@/lib/search";
import {
  VIEWPORT_DEBOUNCE_MS,
  boundsContain,
  padBounds,
  toBboxParam,
  type MapBounds,
} from "@/lib/viewport";
import { DetailSidePanel } from "@/components/map/DetailSidePanel";
import { MapFilters } from "@/components/map/MapFilters";
import { inWindow, showScope, splitShow, type FilterState } from "@/components/filters/model";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SitePanel, SitePreview } from "@/components/map/SitePanel";
import { useMapState } from "@/contexts/MapStateContext";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import {
  sitePath,
  sitesAsOf,
  sitesPath,
  todayUtc,
  type Site,
  type SiteListItem,
} from "@/lib/sites";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });
const SiteLayers = dynamic(
  () => import("@/components/map/SiteLayers").then((m) => m.SiteLayers),
  { ssr: false },
);

/** The `/events/points` filters of a filter state: every filter but the Show pick and the date
 *  windows, which apply in memory. */
function pointsQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  appendEventFilterParams(params, {
    ...filters,
    show: [],
    eventFrom: "",
    eventTo: "",
    addedFrom: "",
    addedTo: "",
  });
  return params.toString();
}

/** The points of the picked statuses (every status when none is picked): the client counterpart
 *  of `?status=`. `/events/points` serves live `geolocated` and `detected` rows only. */
function pointsOfStatuses(points: MapPoint[], statuses: string[]): MapPoint[] {
  if (statuses.length === 0) return points;
  return points.filter((p) =>
    statuses.includes(p[POINT_DETECTED_FLAG] === 1 ? "detected" : "geolocated"),
  );
}

export default function HomePage() {
  // Navigation-surviving state lives in MapStateContext; the page reads only filter values (setters live with MapFilters).
  const {
    viewState,
    setViewState,
    selectedId,
    setSelectedId,
    filters,
    selectedSiteId,
    setSelectedSiteId,
  } = useMapState();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  // The last points read failed: an empty map must not read as a map with nothing on it.
  const [pointsError, setPointsError] = useState<ReadableError | null>(null);
  // The `?bbox=` loaded; `/events/points` serves one viewport, so nothing fetches until the first bounds.
  const [bbox, setBbox] = useState<string | null>(null);
  // The padded region those points cover; a viewport inside it needs no request.
  const coveredRef = useRef<MapBounds | null>(null);
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = showScope(filters.show);
  const sitesShown = shown.others;
  // Keyed on the selection in context, so returning to the map re-reads it.
  const detail = useApiResource<EventDetail>(
    selectedId ? `/events/${selectedId}` : null,
  );
  const siteDetail = useApiResource<Site>(
    sitesShown && selectedSiteId ? sitePath(selectedSiteId) : null,
  );
  const [sites, setSites] = useState<SiteListItem[]>([]);
  // The zone a site shows is the one valid at the end of the event date window.
  const asOf = sitesAsOf(filters.eventTo, todayUtc());
  const abortRef = useRef<AbortController | null>(null);
  // Keyed on the serialized filters: the Show pick and the date windows apply in memory, so
  // changing them must not refetch.
  const serverFilters = pointsQuery(filters);

  const fetchPoints = useCallback(() => {
    if (!bbox) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams(serverFilters);
    // Required: the endpoint 422s without it, and the viewport bounds the payload.
    params.set("bbox", bbox);

    setLoading(true);
    apiFetch<MapPoint[]>(`/events/points?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((next) => {
        setPoints(next);
        setPointsError(null);
      })
      .catch((err: unknown) => {
        // Coverage is claimed at request time: drop the claim on a real failure so the next move-end retries. Skip when superseded.
        if (abortRef.current !== controller) return;
        coveredRef.current = null;
        setPointsError(readError(err));
      })
      .finally(() => {
        // A superseded request must not clear the spinner its replacement raised.
        if (abortRef.current === controller) setLoading(false);
      });
  }, [bbox, serverFilters]);

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

  const mapSites = useMemo(() => (sitesShown ? sites : []), [sites, sitesShown]);

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

  // The Show field and both timeline windows filter client-side (`POINT_DETECTED_FLAG`, event and
  // added dates); a point with no event date is never dropped by its window.
  const statusFiltered = useMemo(
    () => (shown.events ? pointsOfStatuses(points, splitShow(filters.show).statuses) : []),
    [points, filters.show, shown.events],
  );
  const { eventFrom, eventTo, addedFrom, addedTo } = filters;
  const visiblePoints = useMemo(
    () =>
      statusFiltered.filter(
        (p) => inWindow(p[3], eventFrom, eventTo) && inWindow(p[4], addedFrom, addedTo),
      ),
    [statusFiltered, eventFrom, eventTo, addedFrom, addedTo],
  );

  return (
    <div className="h-dvh w-screen relative overflow-hidden bg-neutral-950">
      <Map
        points={visiblePoints}
        selectedId={selectedId}
        onPointClick={selectEvent}
        sites={mapSites}
        selectedSiteId={selectedSiteId}
        className="map-fullscreen"
        center={{ lat: viewState.latitude, lng: viewState.longitude }}
        zoom={viewState.zoom}
        onViewChange={setViewState}
        onBoundsChange={handleBoundsChange}
        goToControl
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

      <MapFilters
        points={statusFiltered}
        count={visiblePoints.length + mapSites.length}
        loading={loading}
      />

      {pointsError && (
        <div className="absolute inset-x-4 bottom-24 z-1000 mx-auto max-w-sm shadow-lg sm:bottom-8">
          <ErrorNotice error={pointsError} onRetry={fetchPoints} />
        </div>
      )}

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
