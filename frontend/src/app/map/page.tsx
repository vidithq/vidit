"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { MapPoint, GeolocationDetail, Tag } from "@/types";
import { apiFetch } from "@/lib/api";
import { Filter, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/format";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { renderProof } from "@/lib/proof";
import SourceLabel from "@/components/ui/SourceLabel";
import TrustBadge from "@/components/profile/TrustBadge";
import ShareButtons from "@/components/geolocation/ShareButtons";
import { FILTER_CHIP_ACTIVE, FILTER_CHIP_INACTIVE, TAG_CHIP } from "@/components/ui/styles";
import { useMapState } from "@/contexts/MapStateContext";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function HomePage() {
  // Persistent state (survives navigation away and back) lives in
  // MapStateContext at the root layout. Local useState below is for things
  // that can be re-fetched cheaply (points, tags, the detail panel body).
  const {
    viewState,
    setViewState,
    selectedId,
    setSelectedId,
    selectedConflicts,
    setSelectedConflicts,
    selectedCaptureSources,
    setSelectedCaptureSources,
    selectedTags,
    setSelectedTags,
    eventDateFrom,
    setEventDateFrom,
    eventDateTo,
    setEventDateTo,
    submittedFrom,
    setSubmittedFrom,
    submittedTo,
    setSubmittedTo,
    authorFilter,
    setAuthorFilter,
    filtersOpen,
    setFiltersOpen,
  } = useMapState();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [detail, setDetail] = useState<GeolocationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks which selectedId we've already issued a fetch for, so the
  // re-hydration effect below doesn't loop on persistent errors (404,
  // network drop). Without this, a swallowed catch + finally would keep
  // re-triggering the effect because deps change but the condition holds.
  const hydratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    apiFetch<Tag[]>("/tags").then(setTags).catch(() => {});
  }, []);

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

  const clearFilters = () => {
    setSelectedConflicts([]);
    setSelectedCaptureSources([]);
    setSelectedTags([]);
    setEventDateFrom("");
    setEventDateTo("");
    setSubmittedFrom("");
    setSubmittedTo("");
    setAuthorFilter("");
  };

  // Toggle helpers for the chip handlers below — clicking a chip adds
  // it to the bucket if absent, removes if present. Same handler on
  // both buckets; the bucket-specific setter is captured at call site.
  const toggleInBucket = (
    name: string,
    set: (v: string[] | ((prev: string[]) => string[])) => void,
  ) => set((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const activeFilterCount =
    selectedConflicts.length +
    selectedCaptureSources.length +
    selectedTags.length +
    [
      eventDateFrom,
      eventDateTo,
      submittedFrom,
      submittedTo,
      authorFilter.trim(),
    ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  const conflictTags = tags.filter((t) => t.category === "conflict");
  const captureSourceTags = tags.filter((t) => t.category === "capture_source");
  const freeTags = tags.filter((t) => t.category === "free");

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
      <div className="absolute top-4 left-[72px] z-[1000] w-60">
        {/* Compact header — always visible */}
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="w-full flex items-center justify-between bg-neutral-900 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-neutral-400" />
            <span className="text-neutral-300 font-medium">Filters</span>
            {hasActiveFilters && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium">
                {activeFilterCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">
              {points.length.toLocaleString()}
            </span>
            {loading && (
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
            )}
            {filtersOpen ? (
              <ChevronUp size={14} className="text-neutral-500" />
            ) : (
              <ChevronDown size={14} className="text-neutral-500" />
            )}
          </div>
        </button>

        {/* Expanded filters */}
        {filtersOpen && (
          <div className="mt-1 bg-neutral-900 rounded-lg border border-neutral-700 p-3 space-y-3">
            {/* Conflict filters */}
            {conflictTags.length > 0 && (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  Conflict
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {conflictTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleInBucket(tag.name, setSelectedConflicts)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                        selectedConflicts.includes(tag.name)
                          ? FILTER_CHIP_ACTIVE
                          : FILTER_CHIP_INACTIVE
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Capture-source filters */}
            {captureSourceTags.length > 0 && (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  Capture source
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {captureSourceTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleInBucket(tag.name, setSelectedCaptureSources)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                        selectedCaptureSources.includes(tag.name)
                          ? FILTER_CHIP_ACTIVE
                          : FILTER_CHIP_INACTIVE
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Free tag filters */}
            {freeTags.length > 0 && (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  Tags
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {freeTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleInBucket(tag.name, setSelectedTags)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                        selectedTags.includes(tag.name)
                          ? FILTER_CHIP_ACTIVE
                          : FILTER_CHIP_INACTIVE
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Event date range */}
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                Event date
              </span>
              <div className="flex gap-1.5 mt-1">
                <input
                  type="date"
                  value={eventDateFrom}
                  onChange={(e) => setEventDateFrom(e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-300 focus:outline-none focus:border-orange-500"
                />
                <input
                  type="date"
                  value={eventDateTo}
                  onChange={(e) => setEventDateTo(e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-300 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Submitted date range */}
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                Submitted
              </span>
              <div className="flex gap-1.5 mt-1">
                <input
                  type="date"
                  value={submittedFrom}
                  onChange={(e) => setSubmittedFrom(e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-300 focus:outline-none focus:border-orange-500"
                />
                <input
                  type="date"
                  value={submittedTo}
                  onChange={(e) => setSubmittedTo(e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-300 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Author filter */}
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                Author
              </span>
              <input
                type="text"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                placeholder="Username..."
                className="w-full mt-1 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-300 placeholder-neutral-500 focus:outline-none focus:border-orange-500"
              />
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="w-full text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors py-1"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right panel — detail overlay. `max-h-[calc(100vh-4.5rem)]` instead
          of a pinned `bottom-14` so the panel shrinks to its content for
          small submissions (no empty grey filler below the last row) but is
          still capped — when content is long, it scrolls within the same
          envelope it had before. 4.5rem = top-4 (1rem) + the 3.5rem clearance
          for the closed-beta pill at the bottom (pill is `bottom-3` + ~28px
          tall + ~6px border, so ~56px keeps the report link off the panel
          even on hover). */}
      {selectedId && (
        <div className="absolute top-4 right-4 max-h-[calc(100vh-4.5rem)] z-[1000] w-96 bg-neutral-900 rounded-lg border border-neutral-700 overflow-y-auto">
          <button
            onClick={closeDetail}
            className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-300 text-lg z-10"
          >
            &times;
          </button>

          {detailLoading || !detail ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-neutral-500 text-sm">Loading...</span>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Title + Author + Report */}
              <div className="pr-6 space-y-2">
                <h2 className="text-lg font-medium text-neutral-100">
                  {detail.title}
                </h2>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-neutral-400 inline-flex items-center gap-1">
                    by{" "}
                    <Link
                      href={`/profile/${detail.author.username}`}
                      className="text-orange-400 hover:underline transition-colors"
                    >
                      {detail.author.username}
                    </Link>
                    <TrustBadge
                      isTrusted={detail.author.is_trusted}
                      trustReason={detail.author.trust_reason}
                      size={12}
                    />
                  </p>
                </div>
              </div>

              {/* Media */}
              <div className="space-y-2">
                {detail.media.length > 0 ? (
                  detail.media.map((m) => (
                    <div
                      key={m.id}
                      className="relative h-40 rounded-lg overflow-hidden border border-neutral-700"
                    >
                      {m.media_type === "image" ? (
                        // Map popup renders at ~380 CSS px wide;
                        // ``thumbnail`` (max-dim 400) is the
                        // intentional fit — picking ``hero`` here
                        // would bleed bandwidth on the most-fetched
                        // surface (every popup open on every map
                        // session).
                        <Image
                          src={displayUrlsFor(m).thumbnail}
                          alt={detail.title}
                          fill
                          sizes="380px"
                          className="object-cover"
                        />
                      ) : (
                        <video
                          src={m.storage_url}
                          controls
                          className="w-full h-40 object-cover"
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-neutral-700 bg-neutral-800 h-40 flex items-center justify-center">
                    <span className="text-xs text-neutral-500">No media available</span>
                  </div>
                )}
              </div>

              {/* Key-value fields */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Event date</span>
                  <span className="text-neutral-200">{formatDate(detail.event_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Coordinates</span>
                  <span className="text-neutral-200 font-mono text-xs">
                    {detail.lat.toFixed(6)}, {detail.lng.toFixed(6)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Source</span>
                  <SourceLabel
                    isDemo={detail.is_demo}
                    url={detail.source_url}
                    variant="link"
                    maxWidthClass="max-w-[200px]"
                    className="ml-4"
                  />
                </div>
                {detail.tags.length > 0 && (
                  <div className="flex justify-between items-start">
                    <span className="text-neutral-500">Tags</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {detail.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className={`text-[10px] px-2 py-0.5 rounded-full ${TAG_CHIP}`}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-500">Submitted</span>
                  <span className="text-neutral-200">
                    {formatDate(detail.created_at)}
                  </span>
                </div>
              </div>

              {/* Proof */}
              <div className="pt-2 border-t border-neutral-800">
                <h3 className="text-xs text-neutral-500 uppercase tracking-wider mb-1.5">
                  Proof
                </h3>
                {detail.proof ? (
                  <div className="text-sm text-neutral-300 leading-relaxed">
                    {renderProof(detail.proof)}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500 italic">
                    No proof provided
                  </p>
                )}
              </div>

              {/* Footer — share affordances on the left, Full-page anchor on
                  the right. Same ShareButtons component as the detail page so
                  the tweet text / clipboard output stay in sync between the
                  two share surfaces. */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-neutral-800">
                <ShareButtons
                  id={detail.id}
                  title={detail.title}
                  author={detail.author.username}
                  eventDate={detail.event_date}
                  lat={detail.lat}
                  lng={detail.lng}
                />
                <Link
                  href={`/geolocations/${detail.id}`}
                  className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors shrink-0"
                >
                  Full page
                  <ExternalLink size={11} />
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
