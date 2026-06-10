"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef } from "react";
import type { MapPoint, GeolocationDetail, Tag } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { DetailSidePanel } from "@/components/map/DetailSidePanel";
import { FilterPanel } from "@/components/map/FilterPanel";
import { useMapState } from "@/contexts/MapStateContext";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function HomePage() {
  // Persistent state (survives navigation away and back) lives in
  // MapStateContext at the root layout. Local useState below is for things
  // that can be re-fetched cheaply (points, tags, the detail panel body).
  // The page only reads the filter *values* (for the points URL); the
  // setters live with FilterPanel, which consumes the same context.
  const {
    viewState,
    setViewState,
    selectedId,
    setSelectedId,
    selectedConflicts,
    selectedCaptureSources,
    selectedTags,
    eventDateFrom,
    eventDateTo,
    submittedFrom,
    submittedTo,
    authorFilter,
  } = useMapState();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: tagsData } = useApiResource<Tag[]>("/tags");
  const tags = tagsData ?? [];
  const [detail, setDetail] = useState<GeolocationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks which selectedId we've already issued a fetch for, so the
  // re-hydration effect below doesn't loop on persistent errors (404,
  // network drop). Without this, a swallowed catch + finally would keep
  // re-triggering the effect because deps change but the condition holds.
  const hydratedIdRef = useRef<string | null>(null);

  const fetchPoints = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    // Both buckets append independently so the URL carries every chip
    // the analyst lit up. The backend applies OR within a bucket and
    // AND across buckets (see `routers/geolocations.py::_apply_filters`).
    selectedConflicts.forEach((c) => params.append("conflict", c));
    selectedCaptureSources.forEach((s) => params.append("capture_source", s));
    selectedTags.forEach((t) => params.append("tag", t));
    if (eventDateFrom) params.set("event_date_from", eventDateFrom);
    if (eventDateTo) params.set("event_date_to", eventDateTo);
    if (submittedFrom) params.set("submitted_from", submittedFrom);
    if (submittedTo) params.set("submitted_to", submittedTo);
    // Strip any character outside the backend's whitelist
    // (`[A-Za-z0-9_-]{1,50}`) so a stray `%` or space — common in
    // free-typed filter input — doesn't trip the 422 that
    // `routers/geolocations.py` raises on the LIKE-injection guard.
    // If everything was filtered out, drop the param entirely instead
    // of sending an empty value (which would also 422).
    const cleanAuthor = authorFilter.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
    if (cleanAuthor) params.set("author", cleanAuthor);

    setLoading(true);
    apiFetch<MapPoint[]>(`/geolocations/points?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(setPoints)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [
    selectedConflicts,
    selectedCaptureSources,
    selectedTags,
    eventDateFrom,
    eventDateTo,
    submittedFrom,
    submittedTo,
    authorFilter,
  ]);

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  const handlePointClick = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDetailLoading(true);
      hydratedIdRef.current = id;
      apiFetch<GeolocationDetail>(`/geolocations/${id}`)
        .then(setDetail)
        .catch(() => {})
        .finally(() => setDetailLoading(false));
    },
    [setSelectedId]
  );

  // Re-hydrate the detail panel after a navigation round-trip: if the
  // context has selectedId but local detail is empty, fetch it again.
  // Guarded by hydratedIdRef so a persistently failing id doesn't loop.
  useEffect(() => {
    if (
      selectedId &&
      !detail &&
      !detailLoading &&
      hydratedIdRef.current !== selectedId
    ) {
      hydratedIdRef.current = selectedId;
      setDetailLoading(true);
      apiFetch<GeolocationDetail>(`/geolocations/${selectedId}`)
        .then(setDetail)
        .catch(() => {})
        .finally(() => setDetailLoading(false));
    }
  }, [selectedId, detail, detailLoading]);

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    hydratedIdRef.current = null;
  };

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#0a0a0a]">
      <Map
        points={points}
        selectedId={selectedId}
        onPointClick={handlePointClick}
        className="map-fullscreen"
        center={{ lat: viewState.latitude, lng: viewState.longitude }}
        zoom={viewState.zoom}
        onViewChange={setViewState}
      />

      {/* Left panel — filters */}
      <FilterPanel tags={tags} pointCount={points.length} loading={loading} />

      {/* Right panel — detail overlay */}
      {selectedId && (
        <DetailSidePanel
          detail={detail}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
