"use client";

import { useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";

import { filterPointsByStatus } from "@/types";
import type { Conflict, MapPoint, Tag } from "@/types";
import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { rangeSummary } from "@/components/ui/FilterSection";
import { Dot } from "@/components/ui/Dot";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { META_LINE } from "@/components/ui/styles";
import { formatDate } from "@/lib/format";
import { sitesAsOf, todayUtc } from "@/lib/sites";
import {
  EMPTY_DATE_WINDOWS,
  FILTER_NAMES,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  addedWindowActive,
  buildActiveFilterPills,
  buildDateWindowPills,
  eventWindowActive,
  type EventFilterPatch,
} from "@/components/filters/EventFilterSections";
import { useMapState } from "@/contexts/MapStateContext";
import { TimelineScrubber } from "@/components/map/TimelineScrubber";

const SITES_LABEL = "Sites";

interface FilterPanelProps {
  /** Live tag taxonomy driving the tag chips. */
  tags: Tag[];
  /** Conflicts carried by at least one live event (`/conflicts?used=true`), server-ordered: ongoing first, then name. */
  conflicts: Conflict[];
  /** Boundary-filtered points, pre-window; the histograms read them through the status pick. */
  points: MapPoint[];
  /** Count of points currently shown (post-window) for the header. */
  pointCount: number;
  /** Points fetch in flight, driving the pulse dot. */
  loading: boolean;
}

/**
 * The map's filter overlay: header button, `ActiveFilterPills`, and the shared
 * `EventFilterSections`, with the sites layer as a chip after the status chips and the two timeline
 * scrubbers as date sections. The sites layer counts as one active filter with its own pill, so the
 * collapsed panel shows it. Filter state lives in MapStateContext so it survives navigation.
 */
export function FilterPanel({ tags, conflicts, points, pointCount, loading }: FilterPanelProps) {
  const {
    filters,
    setFilters,
    dateWindows,
    setDateWindows,
    eventPlaying,
    setEventPlaying,
    addedPlaying,
    setAddedPlaying,
    filtersOpen,
    setFiltersOpen,
    sitesShown,
    setSitesShown,
  } = useMapState();
  const asOf = sitesAsOf(dateWindows.eventTo, todayUtc());

  const onPatch: EventFilterPatch = (patch) =>
    setFilters((v) => ({ ...v, ...patch }));

  // Stable identities: the scrubber's play interval re-subscribes when `setEnd` changes, which would
  // restart the timer on every tick.
  const setEventFrom = useCallback(
    (v: string) => setDateWindows((d) => ({ ...d, eventFrom: v })),
    [setDateWindows]
  );
  const setEventTo = useCallback(
    (v: string) => setDateWindows((d) => ({ ...d, eventTo: v })),
    [setDateWindows]
  );
  const setAddedFrom = useCallback(
    (v: string) => setDateWindows((d) => ({ ...d, addedFrom: v })),
    [setDateWindows]
  );
  const setAddedTo = useCallback(
    (v: string) => setDateWindows((d) => ({ ...d, addedTo: v })),
    [setDateWindows]
  );

  const clearEventWindow = () => {
    setDateWindows((d) => ({ ...d, eventFrom: "", eventTo: "" }));
    setEventPlaying(false);
  };
  const clearAddedWindow = () => {
    setDateWindows((d) => ({ ...d, addedFrom: "", addedTo: "" }));
    setAddedPlaying(false);
  };

  const clearFilters = () => {
    setSitesShown(false);
    setFilters(EMPTY_EVENT_FILTERS);
    setDateWindows(EMPTY_DATE_WINDOWS);
    setEventPlaying(false);
    setAddedPlaying(false);
  };

  // Histogram the same set the status chips leave on the map (same helper as the canvas), so no
  // bar counts points a scrub can't reveal.
  const statusFilteredPoints = useMemo(
    () => filterPointsByStatus(points, filters.show),
    [points, filters.show]
  );

  // buildActiveFilterPills emits the Show pills first; the Sites pill follows them, as its chip
  // follows the status chips.
  const eventPills = buildActiveFilterPills(filters, onPatch);
  const activeFilters: ActiveFilter[] = [
    ...eventPills.slice(0, filters.show.length),
    ...(sitesShown
      ? [
          {
            key: "sites",
            filter: FILTER_NAMES.show,
            label: SITES_LABEL,
            onRemove: () => setSitesShown(false),
          },
        ]
      : []),
    ...eventPills.slice(filters.show.length),
    ...buildDateWindowPills(dateWindows, clearEventWindow, clearAddedWindow),
  ];
  const activeFilterCount = activeFilters.length;
  const hasActiveFilters = activeFilterCount > 0;

  return (
    // Below `sm` the overlay starts right of the chip's open control (`max-sm:left-16` = 64px, clearing
    // its ~55px) and runs as a column down to 72px above the bottom edge, clear of the map's
    // bottom-left row (zoom, locate, basemap, and an attribution that wraps to three lines at
    // 320px), so the section stack takes the leftover height and scrolls (a fixed max-height would
    // ignore the pill strip). The stretched box is transparent to pointers so taps outside the
    // blocks reach the map.
    <div className="absolute top-4 left-[72px] safe-mt safe-mr safe-mb safe-ml z-1000 w-72 max-sm:bottom-18 max-sm:left-16 max-sm:right-4 max-sm:w-auto max-sm:flex max-sm:flex-col max-sm:pointer-events-none">
      <button
        onClick={() => setFiltersOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-neutral-900 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800/80 transition-colors max-sm:shrink-0 max-sm:pointer-events-auto"
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
          <span className="text-xs text-neutral-500">{pointCount.toLocaleString()}</span>
          {loading && <Dot className="animate-pulse" />}
          {filtersOpen ? (
            <ChevronUp size={14} className="text-neutral-500" />
          ) : (
            <ChevronDown size={14} className="text-neutral-500" />
          )}
        </div>
      </button>

      {activeFilters.length > 0 && (
        // Solid strip: the translucent pill surface let map labels bleed through. Only with pill entries
        // (an author-only filter shows in its section).
        <div className="mt-1 bg-neutral-900 rounded-lg border border-neutral-700 px-2.5 py-2 max-sm:shrink-0 max-sm:pointer-events-auto">
          <ActiveFilterPills filters={activeFilters} onClearAll={clearFilters} />
        </div>
      )}

      {filtersOpen && (
        // The one block that shrinks: `min-h-0` lets it go below its content height, and overflow makes
        // cut sections reachable by scroll.
        <div className="mt-1 max-sm:min-h-0 max-sm:overflow-y-auto max-sm:pointer-events-auto">
          <EventFilterSections
            tags={tags}
            conflicts={conflicts}
            values={filters}
            onPatch={onPatch}
            layer={{
              label: SITES_LABEL,
              on: sitesShown,
              onToggle: () => setSitesShown(!sitesShown),
              note: (
                <p className={`${META_LINE} mt-2`}>
                  Zones as of {asOf ? formatDate(asOf) : "today"}
                  <FieldHelp concept="sites_layer" size={12} />
                </p>
              ),
            }}
            dateSections={[
              {
                title: FILTER_NAMES.eventDate,
                concept: "occurred_date",
                summary: rangeSummary(dateWindows.eventFrom, dateWindows.eventTo),
                active: eventWindowActive(dateWindows),
                children: (
                  <TimelineScrubber
                    points={statusFilteredPoints}
                    dateIndex={3}
                    label={FILTER_NAMES.eventDate}
                    start={dateWindows.eventFrom}
                    setStart={setEventFrom}
                    end={dateWindows.eventTo}
                    setEnd={setEventTo}
                    playing={eventPlaying}
                    setPlaying={setEventPlaying}
                  />
                ),
              },
              {
                title: FILTER_NAMES.added,
                concept: "added",
                summary: rangeSummary(dateWindows.addedFrom, dateWindows.addedTo),
                active: addedWindowActive(dateWindows),
                children: (
                  <TimelineScrubber
                    points={statusFilteredPoints}
                    dateIndex={4}
                    label={FILTER_NAMES.added}
                    start={dateWindows.addedFrom}
                    setStart={setAddedFrom}
                    end={dateWindows.addedTo}
                    setEnd={setAddedTo}
                    playing={addedPlaying}
                    setPlaying={setAddedPlaying}
                  />
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
