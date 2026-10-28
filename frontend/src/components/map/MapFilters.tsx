"use client";

import { useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";

import type { MapPoint } from "@/types";
import { ActiveFilterPills } from "@/components/ui/ActiveFilterPills";
import { CARD_FRAME } from "@/components/ui/Card";
import { Dot } from "@/components/ui/Dot";
import { FilterPanel, FilterSheetBar, type FilterPanelProps } from "@/components/filters/FilterPanel";
import { EMPTY_FILTERS, dayCounts, inWindow, type FilterPatch } from "@/components/filters/model";
import { activePills, type Vocabulary } from "@/components/filters/labels";
import { useMapState } from "@/contexts/MapStateContext";
import { cn } from "@/lib/cn";

/**
 * The map's filter panel, bound to `MapStateContext`. From `lg` up it floats under its **Filters**
 * header, showing the active pills while collapsed and the panel while open. Below `lg` it is the
 * phone's filter bar over the map, whose button opens the panel in a sheet. The timelines count
 * the points in memory, so a scrub or playback never refetches.
 */
export function MapFilters({
  vocabulary,
  points,
  pointCount,
  loading,
}: {
  vocabulary: Vocabulary;
  /** The points the Show field leaves, before the date windows. */
  points: MapPoint[];
  /** The points shown, after the windows. */
  pointCount: number;
  loading: boolean;
}) {
  const {
    filters,
    setFilters,
    eventPlaying,
    setEventPlaying,
    addedPlaying,
    setAddedPlaying,
    filtersOpen,
    setFiltersOpen,
  } = useMapState();

  const onPatch: FilterPatch = useCallback(
    (patch) => {
      setFilters((f) => ({ ...f, ...patch }));
      if (patch.eventFrom === "" && patch.eventTo === "") setEventPlaying(false);
      if (patch.addedFrom === "" && patch.addedTo === "") setAddedPlaying(false);
    },
    [setFilters, setEventPlaying, setAddedPlaying],
  );
  const onClear = () => {
    setFilters(EMPTY_FILTERS);
    setEventPlaying(false);
    setAddedPlaying(false);
  };

  const { eventFrom, eventTo, addedFrom, addedTo } = filters;
  const timelines = useMemo(
    () => ({
      eventDate: dayCounts(points.filter((p) => inWindow(p[4], addedFrom, addedTo)).map((p) => p[3])),
      added: dayCounts(points.filter((p) => inWindow(p[3], eventFrom, eventTo)).map((p) => p[4])),
    }),
    [points, eventFrom, eventTo, addedFrom, addedTo],
  );

  const props: FilterPanelProps = {
    surface: "map",
    state: filters,
    onPatch,
    onClear,
    vocabulary,
    timelines,
    playback: {
      eventDate: { playing: eventPlaying, setPlaying: setEventPlaying },
      added: { playing: addedPlaying, setPlaying: setAddedPlaying },
    },
  };
  const pills = activePills("map", filters, vocabulary, onPatch);

  return (
    <>
      <div className="absolute top-4 left-[72px] z-1000 w-72 safe-mt safe-ml max-lg:hidden">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm transition-colors hover:bg-neutral-800/80"
        >
          <span className="flex items-center gap-2">
            <Filter size={14} className={pills.length > 0 ? "text-orange-400" : "text-neutral-400"} />
            <span className="font-medium text-neutral-300">Filters</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{pointCount.toLocaleString()}</span>
            {loading && <Dot className="animate-pulse" />}
            {filtersOpen ? (
              <ChevronUp size={14} className="text-neutral-500" />
            ) : (
              <ChevronDown size={14} className="text-neutral-500" />
            )}
          </span>
        </button>
        {filtersOpen ? (
          // Stops above the map's bottom-left controls (zoom, locate, basemap) and scrolls the rest.
          <div className={cn(CARD_FRAME, "mt-1 max-h-[calc(100dvh-11rem)] overflow-y-auto p-3")}>
            <FilterPanel {...props} />
          </div>
        ) : (
          pills.length > 0 && (
            <div className={cn(CARD_FRAME, "mt-1 px-2.5 py-2")}>
              <ActiveFilterPills filters={pills} onClearAll={onClear} />
            </div>
          )
        )}
      </div>
      <div
        className={cn(
          CARD_FRAME,
          "absolute top-4 right-4 left-16 z-1000 w-fit p-2 safe-mt safe-mr sm:left-[72px] lg:hidden",
        )}
      >
        <FilterSheetBar {...props} />
      </div>
    </>
  );
}
