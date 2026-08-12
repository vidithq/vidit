"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { filterPointsByStatus } from "@/types";
import type { Conflict, MapPoint, EventDetail, Tag } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { AUTHOR_FILTER_RE } from "@/lib/search";
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
    filters,
    dateWindows,
    hideDemo,
  } = useMapState();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  // The `?bbox=` currently loaded. `/events/points` serves one viewport, so
  // there is nothing to fetch until the map reports its first bounds.
  const [bbox, setBbox] = useState<string | null>(null);
  // The padded region those points cover. A viewport still inside it needs no
  // request, which is what keeps small pans free.
  const coveredRef = useRef<MapBounds | null>(null);
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!bbox) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    // Required: the endpoint 422s without it, and the viewport is what bounds
    // the payload instead of the catalog's size.
    params.set("bbox", bbox);
    // Append each chip independently. The backend applies OR within a
    // bucket and AND across buckets (`routers/events::_apply_filters`).
    filters.conflicts.forEach((c) => params.append("conflict", c));
    filters.captureSources.forEach((s) => params.append("capture_source", s));
    filters.tags.forEach((t) => params.append("tag", t));
    filters.mediaTypes.forEach((m) => params.append("media", m));
    if (hideDemo) params.set("hide_demo", "true");
    // The commit-style Author section only applies gated values, but the
    // context could carry a stale one; the shared gate (same source as the
    // section's commit) keeps an ineligible value from 422ing the fetch.
    const cleanAuthor = filters.author.trim();
    if (AUTHOR_FILTER_RE.test(cleanAuthor)) params.set("author", cleanAuthor);

    setLoading(true);
    apiFetch<MapPoint[]>(`/events/points?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(setPoints)
      .catch(() => {
        // Coverage is claimed at request time, so a real failure (429, 5xx,
        // offline) would otherwise leave the region marked as loaded and the
        // map showing the previous region's pins forever. Dropping the claim
        // makes the next move-end retry. Same abort guard as the spinner: a
        // superseded request must not wipe the coverage its replacement set.
        if (abortRef.current === controller) coveredRef.current = null;
      })
      .finally(() => {
        // A superseded request must not clear the spinner the one that
        // replaced it just raised: panning aborts often enough for that to
        // read as a finished load while points are still coming.
        if (abortRef.current === controller) setLoading(false);
      });
    // Per-bucket deps, not the whole `filters` object: the status pick and the
    // date windows are applied client-side, so a status chip must not fire a
    // refetch. A patch keeps the untouched buckets' array identities, so these
    // only change when a server-side bucket actually does.
  }, [
    bbox,
    filters.conflicts,
    filters.captureSources,
    filters.tags,
    filters.mediaTypes,
    filters.author,
    hideDemo,
  ]);

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  // Every move-end (and the map's first paint) offers a viewport. Debounced,
  // so a drag across several regions or a wheel zoom settles into one
  // request; then a containment check against the padded region already
  // loaded drops the pans that need no new points at all.
  const handleBoundsChange = useCallback((next: MapBounds) => {
    const apply = () => {
      const covered = coveredRef.current;
      if (covered && boundsContain(covered, next)) return;
      const padded = padBounds(next);
      coveredRef.current = padded;
      setBbox(toBboxParam(padded));
    };
    if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
    // The first viewport is the page's initial load, not a camera move:
    // waiting out the debounce there would only leave the map empty for
    // as long.
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
  // carries its detected flag (`POINT_DETECTED_FLAG`) and its event and added
  // dates, so chip clicks, scrubbing and playback filter the in-memory set
  // instantly with no /points refetch. A point must match the status pick
  // (any-of, empty = all) and fall inside both windows.
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
      // A missing/unparseable date must not silently drop the point (NaN fails
      // every comparison): treat that dimension as unconstrained, matching the
      // histogram, which skips undated points rather than hiding them.
      // event_date is optional, so null is a live case, not just a safeguard.
      const ev = p[3] ? Date.parse(`${p[3]}T00:00:00Z`) : NaN;
      const sub = p[4] ? Date.parse(`${p[4]}T00:00:00Z`) : NaN;
      const evOk = Number.isNaN(ev) || (ev >= evLo && ev <= evHi);
      const subOk = Number.isNaN(sub) || (sub >= subLo && sub <= subHi);
      return evOk && subOk;
    });
  }, [points, filters.statuses, dateWindows]);

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
          detail={detail}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
