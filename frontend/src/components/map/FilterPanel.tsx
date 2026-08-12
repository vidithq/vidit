"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";

import { filterPointsByStatus } from "@/types";
import type { Conflict, MapPoint, Tag } from "@/types";
import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { rangeSummary } from "@/components/ui/FilterSection";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { Dot } from "@/components/ui/Dot";
import {
  EMPTY_DATE_WINDOWS,
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

interface FilterPanelProps {
  /** Live tag taxonomy driving the capture-source + free chip buckets. */
  tags: Tag[];
  /** Conflicts carried by >=1 live event (`/conflicts?used=true`), driving the
   *  Conflict chip bucket. Server-ordered: ongoing first, then name. */
  conflicts: Conflict[];
  /** Boundary-filtered points, pre-window. The histograms read them through
   *  the status pick (below) so they only count points a scrub can reveal;
   *  the hide-demo gate reads them raw so an active filter can't strand the
   *  toggle. */
  points: MapPoint[];
  /** Count of points currently shown (post-window) for the header. */
  pointCount: number;
  /** Points fetch in flight, driving the pulse dot. */
  loading: boolean;
}

/**
 * The map's filter overlay: the header button, the shared removable-pill row
 * (`ActiveFilterPills`, visible even while the panel is collapsed), and the
 * shared section stack (`EventFilterSections`, the same panel the search page
 * renders). Map-specific: the two timeline scrubbers as the date sections
 * (fed by the points histogram; the windows filter client-side) and the
 * hide-demo toggle (gated on demo rows being on the map). Filter state lives
 * in MapStateContext so it survives navigation.
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
    hideDemo,
    setHideDemo,
    filtersOpen,
    setFiltersOpen,
  } = useMapState();

  const onPatch: EventFilterPatch = (patch) =>
    setFilters((v) => ({ ...v, ...patch }));

  const clearEventWindow = () => {
    setDateWindows((d) => ({ ...d, eventFrom: "", eventTo: "" }));
    setEventPlaying(false);
  };
  const clearAddedWindow = () => {
    setDateWindows((d) => ({ ...d, addedFrom: "", addedTo: "" }));
    setAddedPlaying(false);
  };

  const clearFilters = () => {
    setFilters(EMPTY_EVENT_FILTERS);
    setDateWindows(EMPTY_DATE_WINDOWS);
    setEventPlaying(false);
    setAddedPlaying(false);
    setHideDemo(false);
  };

  // The scrubbers histogram the same set the status chips leave on the map:
  // feeding them raw points would count bars no scrub can reveal while a
  // chip is active. Same helper as the map canvas, so the two can't drift.
  const statusFilteredPoints = useMemo(
    () => filterPointsByStatus(points, filters.statuses),
    [points, filters.statuses]
  );

  // The shared value + window pill entries plus the map's own demo entry.
  const activeFilters: ActiveFilter[] = [
    ...buildActiveFilterPills(filters, onPatch),
    ...buildDateWindowPills(dateWindows, clearEventWindow, clearAddedWindow),
    ...(hideDemo
      ? [{ key: "hide-demo", label: "Demo hidden", onRemove: () => setHideDemo(false) }]
      : []),
  ];
  // The author narrows the view without carrying a pill (its chip lives in
  // the Author section), so the badge counts it on top of the pill entries:
  // a filtered map must never read as unfiltered.
  const activeFilterCount = activeFilters.length + (filters.author.trim() ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="absolute top-4 left-[72px] z-1000 w-72">
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
        // Solid strip: the pills' accent surface is translucent, and bare over
        // the canvas the map labels bled through the row. Only when there are
        // pill entries: an author-only filter shows in its section, not here.
        <div className="mt-1 bg-neutral-900 rounded-lg border border-neutral-700 px-2.5 py-2">
          <ActiveFilterPills filters={activeFilters} onClearAll={clearFilters} />
        </div>
      )}

      {filtersOpen && (
        <div className="mt-1">
          <EventFilterSections
            tags={tags}
            conflicts={conflicts}
            values={filters}
            onPatch={onPatch}
            dateSections={[
              {
                title: "Event date",
                concept: "event_date",
                summary: rangeSummary(dateWindows.eventFrom, dateWindows.eventTo),
                active: eventWindowActive(dateWindows),
                children: (
                  <TimelineScrubber
                    points={statusFilteredPoints}
                    dateIndex={3}
                    label="Event date"
                    start={dateWindows.eventFrom}
                    setStart={(v) => setDateWindows((d) => ({ ...d, eventFrom: v }))}
                    end={dateWindows.eventTo}
                    setEnd={(v) => setDateWindows((d) => ({ ...d, eventTo: v }))}
                    playing={eventPlaying}
                    setPlaying={setEventPlaying}
                  />
                ),
              },
              {
                title: "Added",
                concept: "added",
                summary: rangeSummary(dateWindows.addedFrom, dateWindows.addedTo),
                active: addedWindowActive(dateWindows),
                children: (
                  <TimelineScrubber
                    points={statusFilteredPoints}
                    dateIndex={4}
                    label="Added"
                    start={dateWindows.addedFrom}
                    setStart={(v) => setDateWindows((d) => ({ ...d, addedFrom: v }))}
                    end={dateWindows.addedTo}
                    setEnd={(v) => setDateWindows((d) => ({ ...d, addedTo: v }))}
                    playing={addedPlaying}
                    setPlaying={setAddedPlaying}
                  />
                ),
              },
            ]}
            extraToggles={
              /* Offered only when a demo row is actually on the map (the
                 payload flags them), like `?used=true` narrows the conflict
                 list: a toggle that can't change anything is noise. Kept
                 while active even though the filtered payload then carries
                 no demo rows, else it couldn't be switched off. */
              (hideDemo || points.some((p) => p[6] === 1)) && (
                <ToggleRow
                  label="Hide demo data"
                  on={hideDemo}
                  onToggle={() => setHideDemo((v) => !v)}
                />
              )
            }
          />
        </div>
      )}
    </div>
  );
}
