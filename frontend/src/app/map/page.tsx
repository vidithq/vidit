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
  // State that must survive navigation lives in MapStateContext; local
  // useState below is for cheaply re-fetched data (points, tags, detail).
  // The page reads only filter values (for the points URL); the setters
  // live with FilterPanel, which shares the same context.
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
  // Which selectedId we've already fetched, so the re-hydration effect
  // doesn't loop on persistent errors (404, network drop): a swallowed
  // catch would otherwise keep re-triggering it as deps change.
  const hydratedIdRef = useRef<string | null>(null);

  const fetchPoints = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    // Append each chip independently. The backend applies OR within a
    // bucket and AND across buckets (`routers/geolocations.py::_apply_filters`).
    selectedConflicts.forEach((c) => params.append("conflict", c));
    selectedCaptureSources.forEach((s) => params.append("capture_source", s));
    selectedTags.forEach((t) => params.append("tag", t));
    if (eventDateFrom) params.set("event_date_from", eventDateFrom);
    if (eventDateTo) params.set("event_date_to", eventDateTo);
    if (submittedFrom) params.set("submitted_from", submittedFrom);
    if (submittedTo) params.set("submitted_to", submittedTo);
    // Strip chars outside the backend whitelist (`[A-Za-z0-9_-]{1,50}`) so
    // a stray `%` or space doesn't trip the LIKE-injection guard's 422.
    // Drop the param entirely if nothing's left (an empty value also 422s).
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

  // Re-hydrate the detail panel after a navigation round-trip: context
  // has selectedId but local detail is empty. Guarded by hydratedIdRef so
  // a persistently failing id doesn't loop.
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

      <FilterPanel tags={tags} pointCount={points.length} loading={loading} />

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
