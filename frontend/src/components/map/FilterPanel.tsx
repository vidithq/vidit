"use client";

import { ChevronDown, ChevronUp, Filter } from "lucide-react";

import type { Tag } from "@/types";
import {
  FILTER_CHIP_ACTIVE,
  FILTER_CHIP_INACTIVE,
} from "@/components/ui/styles";
import { useMapState } from "@/contexts/MapStateContext";

interface FilterPanelProps {
  /** Live tag taxonomy driving the chip buckets. */
  tags: Tag[];
  /** Current point count shown in the header. */
  pointCount: number;
  /** Points fetch in flight — drives the pulse dot. */
  loading: boolean;
}

/**
 * The map's collapsible filter overlay. Filter state lives in
 * MapStateContext so it survives navigation away and back; the panel
 * reads and writes the context directly.
 */
export function FilterPanel({ tags, pointCount, loading }: FilterPanelProps) {
  const {
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

  // Chip toggle: add to the bucket if absent, remove if present. The
  // bucket-specific setter is captured at the call site.
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
    <div className="absolute top-4 left-[72px] z-1000 w-60">
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
            {pointCount.toLocaleString()}
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

      {filtersOpen && (
        <div className="mt-1 bg-neutral-900 rounded-lg border border-neutral-700 p-3 space-y-3">
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

          <div>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
              Event date
            </span>
            <div className="flex gap-1.5 mt-1">
              <input
                type="date"
                value={eventDateFrom}
                onChange={(e) => setEventDateFrom(e.target.value)}
                className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded-sm text-[11px] text-neutral-300 focus:outline-hidden focus:border-orange-500"
              />
              <input
                type="date"
                value={eventDateTo}
                onChange={(e) => setEventDateTo(e.target.value)}
                className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded-sm text-[11px] text-neutral-300 focus:outline-hidden focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
              Submitted
            </span>
            <div className="flex gap-1.5 mt-1">
              <input
                type="date"
                value={submittedFrom}
                onChange={(e) => setSubmittedFrom(e.target.value)}
                className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded-sm text-[11px] text-neutral-300 focus:outline-hidden focus:border-orange-500"
              />
              <input
                type="date"
                value={submittedTo}
                onChange={(e) => setSubmittedTo(e.target.value)}
                className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-800 border border-neutral-700 rounded-sm text-[11px] text-neutral-300 focus:outline-hidden focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
              Author
            </span>
            <input
              type="text"
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              placeholder="Username..."
              className="w-full mt-1 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded-sm text-[11px] text-neutral-300 placeholder-neutral-500 focus:outline-hidden focus:border-orange-500"
            />
          </div>

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
  );
}
