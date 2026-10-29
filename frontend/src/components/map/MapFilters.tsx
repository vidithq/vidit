"use client";

import { useCallback, useMemo } from "react";

import type { MapPoint } from "@/types";
import { CARD_FRAME } from "@/components/ui/Card";
import { FilterCard, FilterSheetBar, type FilterPanelProps } from "@/components/filters/FilterPanel";
import { EMPTY_FILTERS, dayCounts, inWindow, type FilterPatch } from "@/components/filters/model";
import type { Vocabulary } from "@/components/filters/labels";
import { useMapState } from "@/contexts/MapStateContext";
import { cn } from "@/lib/cn";

/**
 * The map's filter panel, bound to `MapStateContext`. From `lg` up it is the `<FilterCard>`
 * floating over the map, closed until the viewer opens it. Below `lg` it is the
 * phone's filter bar over the map, whose button opens the panel in a sheet. The timelines count
 * the points in memory, so a scrub or playback never refetches.
 */
export function MapFilters({
  vocabulary,
  points,
  loading,
}: {
  vocabulary: Vocabulary;
  /** The points the Show field leaves, before the date windows. */
  points: MapPoint[];
  loading: boolean;
}) {
  const {
    filters,
    setFilters,
    eventPlaying,
    setEventPlaying,
    addedPlaying,
    setAddedPlaying,
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

  return (
    <>
      <FilterCard
        {...props}
        loading={loading}
        className="absolute top-4 left-[72px] z-1000 w-72 safe-mt safe-ml max-lg:hidden"
        // Stops above the map's bottom-left controls (zoom, locate, basemap) and scrolls the rest.
        bodyClassName="max-h-[calc(100dvh-11rem)] overflow-y-auto"
      />
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
