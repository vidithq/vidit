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
import { useMapState } from "@/contexts/MapStateContext";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function HomePage() {
  // Navigation-surviving state lives in MapStateContext; the page reads only filter values (setters live with FilterPanel).
  const {
    viewState,
    setViewState,
    selectedId,
    setSelectedId,
    filters,
    dateWindows,
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
      captureSources: filters.captureSources,
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
    filters.captureSources,
    filters.tags,
    filters.mediaTypes,
    filters.author,
    filters.approved,
    filters.approvedBy,
  ]);

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

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
      // A missing or unparseable date (event_date is optional) is unconstrained, like the histogram, so the point is not dropped.
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
        onPointClick={setSelectedId}
        className="map-fullscreen"
        center={{ lat: viewState.latitude, lng: viewState.longitude }}
        zoom={viewState.zoom}
        onViewChange={setViewState}
        onBoundsChange={handleBoundsChange}
      />

      <FilterPanel
        tags={tags}
        conflicts={conflicts}
        points={points}
        pointCount={visiblePoints.length}
        loading={loading}
      />

      {selectedId && (
        <DetailSidePanel
          // Keyed by event so per-event state (report form, optimistic flags) starts clean.
          key={selectedId}
          resource={detail}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
