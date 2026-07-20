"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { Conflict, MapPoint, EventDetail, Tag } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { AUTHOR_FILTER_RE } from "@/lib/search";
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
    selectedStatuses,
    selectedConflicts,
    selectedCaptureSources,
    selectedTags,
    selectedMediaTypes,
    trustedOnly,
    hideDemo,
    eventStart,
    eventEnd,
    submittedStart,
    submittedEnd,
    authorFilter,
  } = useMapState();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: tagsData } = useApiResource<Tag[]>("/tags");
  const tags = tagsData ?? [];
  // Only conflicts carried by >=1 live event: the filter offers what the map
  // can actually show, not the whole ~800-row referential.
  const { data: conflictsData } = useApiResource<Conflict[]>("/conflicts?used=true");
  const conflicts = conflictsData ?? [];
  const [detail, setDetail] = useState<EventDetail | null>(null);
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
    // bucket and AND across buckets (`routers/events::_apply_filters`).
    selectedConflicts.forEach((c) => params.append("conflict", c));
    selectedCaptureSources.forEach((s) => params.append("capture_source", s));
    selectedTags.forEach((t) => params.append("tag", t));
    selectedMediaTypes.forEach((m) => params.append("media", m));
    if (trustedOnly) params.set("trusted_only", "true");
    if (hideDemo) params.set("hide_demo", "true");
    // The commit-style Author section only applies gated values, but the
    // context could carry a stale one; the shared gate (same source as the
    // section's commit) keeps an ineligible value from 422ing the fetch.
    const cleanAuthor = authorFilter.trim();
    if (AUTHOR_FILTER_RE.test(cleanAuthor)) params.set("author", cleanAuthor);

    setLoading(true);
    apiFetch<MapPoint[]>(`/events/points?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(setPoints)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [
    selectedConflicts,
    selectedCaptureSources,
    selectedTags,
    selectedMediaTypes,
    trustedOnly,
    hideDemo,
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
      apiFetch<EventDetail>(`/events/${id}`)
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
      apiFetch<EventDetail>(`/events/${selectedId}`)
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

  // Apply the status chips and both timeline windows client-side: each point
  // carries its detected flag (point[5]) and its event and added dates, so
  // chip clicks, scrubbing and playback filter the in-memory set instantly
  // with no /points refetch. A point must match the status pick (any-of,
  // empty = all) and fall inside both windows.
  const visiblePoints = useMemo(() => {
    const statusFiltered =
      selectedStatuses.length === 0
        ? points
        : points.filter((p) =>
            selectedStatuses.includes(p[5] === 1 ? "detected" : "geolocated")
          );
    if (!eventStart && !eventEnd && !submittedStart && !submittedEnd) return statusFiltered;
    const lo = (iso: string) => (iso ? Date.parse(`${iso}T00:00:00Z`) : -Infinity);
    const hi = (iso: string) => (iso ? Date.parse(`${iso}T23:59:59Z`) : Infinity);
    const evLo = lo(eventStart);
    const evHi = hi(eventEnd);
    const subLo = lo(submittedStart);
    const subHi = hi(submittedEnd);
    return statusFiltered.filter((p) => {
      // A missing/unparseable date must not silently drop the point (NaN fails
      // every comparison) — treat that dimension as unconstrained, matching the
      // histogram, which skips undated points rather than hiding them. Both
      // columns are NOT NULL today; this is defensive against future sources.
      const ev = p[3] ? Date.parse(`${p[3]}T00:00:00Z`) : NaN;
      const sub = p[4] ? Date.parse(`${p[4]}T00:00:00Z`) : NaN;
      const evOk = Number.isNaN(ev) || (ev >= evLo && ev <= evHi);
      const subOk = Number.isNaN(sub) || (sub >= subLo && sub <= subHi);
      return evOk && subOk;
    });
  }, [points, selectedStatuses, eventStart, eventEnd, submittedStart, submittedEnd]);

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-neutral-950">
      <Map
        points={visiblePoints}
        selectedId={selectedId}
        onPointClick={handlePointClick}
        className="map-fullscreen"
        center={{ lat: viewState.latitude, lng: viewState.longitude }}
        zoom={viewState.zoom}
        onViewChange={setViewState}
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
          detail={detail}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
