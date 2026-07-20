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
  EventFilterSections,
  buildActiveFilterPills,
  type EventFilterPatch,
  type EventFilterValues,
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
  /** Points fetch in flight — drives the pulse dot. */
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
    selectedStatuses,
    setSelectedStatuses,
    selectedConflicts,
    setSelectedConflicts,
    selectedCaptureSources,
    setSelectedCaptureSources,
    selectedTags,
    setSelectedTags,
    selectedMediaTypes,
    setSelectedMediaTypes,
    trustedOnly,
    setTrustedOnly,
    hideDemo,
    setHideDemo,
    eventStart,
    setEventStart,
    eventEnd,
    setEventEnd,
    eventPlaying,
    setEventPlaying,
    submittedStart,
    setSubmittedStart,
    submittedEnd,
    setSubmittedEnd,
    submittedPlaying,
    setSubmittedPlaying,
    authorFilter,
    setAuthorFilter,
    filtersOpen,
    setFiltersOpen,
  } = useMapState();

  // Adapter: the context keeps one state atom per filter (they predate the
  // shared panel); the shared component speaks one values object + patches.
  const values: EventFilterValues = {
    statuses: selectedStatuses,
    conflicts: selectedConflicts,
    captureSources: selectedCaptureSources,
    tags: selectedTags,
    mediaTypes: selectedMediaTypes,
    author: authorFilter,
    trustedOnly,
  };
  const onPatch: EventFilterPatch = (patch) => {
    if (patch.statuses !== undefined) setSelectedStatuses(patch.statuses);
    if (patch.conflicts !== undefined) setSelectedConflicts(patch.conflicts);
    if (patch.captureSources !== undefined) setSelectedCaptureSources(patch.captureSources);
    if (patch.tags !== undefined) setSelectedTags(patch.tags);
    if (patch.mediaTypes !== undefined) setSelectedMediaTypes(patch.mediaTypes);
    if (patch.author !== undefined) setAuthorFilter(patch.author);
    if (patch.trustedOnly !== undefined) setTrustedOnly(patch.trustedOnly);
  };

  const clearFilters = () => {
    onPatch({
      statuses: [],
      conflicts: [],
      captureSources: [],
      tags: [],
      mediaTypes: [],
      author: "",
      trustedOnly: false,
    });
    setHideDemo(false);
    setEventStart("");
    setEventEnd("");
    setEventPlaying(false);
    setSubmittedStart("");
    setSubmittedEnd("");
    setSubmittedPlaying(false);
  };

  const eventActive = !!(eventStart || eventEnd);
  const submittedActive = !!(submittedStart || submittedEnd);

  // The scrubbers histogram the same set the status chips leave on the map:
  // feeding them raw points would count bars no scrub can reveal while a
  // chip is active. Same helper as the map canvas, so the two can't drift.
  const statusFilteredPoints = useMemo(
    () => filterPointsByStatus(points, selectedStatuses),
    [points, selectedStatuses]
  );

  // The shared pill entries plus the map's two window + demo entries.
  const activeFilters: ActiveFilter[] = [
    ...buildActiveFilterPills(values, onPatch),
    ...(eventActive
      ? [
          {
            key: "event-window",
            label: `Event: ${rangeSummary(eventStart, eventEnd)}`,
            onRemove: () => {
              setEventStart("");
              setEventEnd("");
              setEventPlaying(false);
            },
          },
        ]
      : []),
    ...(submittedActive
      ? [
          {
            key: "submitted-window",
            label: `Added: ${rangeSummary(submittedStart, submittedEnd)}`,
            onRemove: () => {
              setSubmittedStart("");
              setSubmittedEnd("");
              setSubmittedPlaying(false);
            },
          },
        ]
      : []),
    ...(hideDemo
      ? [{ key: "hide-demo", label: "Demo hidden", onRemove: () => setHideDemo(false) }]
      : []),
  ];
  // The author narrows the view without carrying a pill (its chip lives in
  // the Author section), so the badge counts it on top of the pill entries:
  // a filtered map must never read as unfiltered.
  const activeFilterCount = activeFilters.length + (values.author.trim() ? 1 : 0);
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
            values={values}
            onPatch={onPatch}
            dateSections={[
              {
                title: "Event date",
                concept: "event_date",
                summary: rangeSummary(eventStart, eventEnd),
                active: eventActive,
                children: (
                  <TimelineScrubber
                    points={statusFilteredPoints}
                    dateIndex={3}
                    label="Event date"
                    start={eventStart}
                    setStart={setEventStart}
                    end={eventEnd}
                    setEnd={setEventEnd}
                    playing={eventPlaying}
                    setPlaying={setEventPlaying}
                  />
                ),
              },
              {
                title: "Added",
                concept: "added",
                summary: rangeSummary(submittedStart, submittedEnd),
                active: submittedActive,
                children: (
                  <TimelineScrubber
                    points={statusFilteredPoints}
                    dateIndex={4}
                    label="Added"
                    start={submittedStart}
                    setStart={setSubmittedStart}
                    end={submittedEnd}
                    setEnd={setSubmittedEnd}
                    playing={submittedPlaying}
                    setPlaying={setSubmittedPlaying}
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
