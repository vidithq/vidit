"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Filter, User } from "lucide-react";

import type { Conflict, MapPoint, Tag } from "@/types";
import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { FilterSection, chipSummary, rangeSummary } from "@/components/ui/FilterSection";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { Dot } from "@/components/ui/Dot";
import { useMapState } from "@/contexts/MapStateContext";
import { TimelineScrubber } from "@/components/map/TimelineScrubber";

interface FilterPanelProps {
  /** Live tag taxonomy driving the capture-source + free chip buckets. */
  tags: Tag[];
  /** Conflicts carried by >=1 live event (`/conflicts?used=true`), driving the
   *  Conflict chip bucket. Server-ordered: ongoing first, then name. */
  conflicts: Conflict[];
  /** Boundary-filtered points (pre-window) — feeds the timeline histograms. */
  points: MapPoint[];
  /** Count of points currently shown (post-window) for the header. */
  pointCount: number;
  /** Points fetch in flight — drives the pulse dot. */
  loading: boolean;
}

// Free-tag bucket grows unbounded; show this many, hide the rest behind
// "Show all". Selected tags past the cut are surfaced regardless so you can
// still see and clear them without expanding.
const TAGS_PREVIEW = 8;

// Fixed media-presence options (Media.media_type values).
const MEDIA_TYPES: ReadonlyArray<[string, string]> = [
  ["image", "Image"],
  ["video", "Video"],
];

/**
 * The map's filter overlay. Sections collapse individually (state summaries in
 * the header), ordered required → optional, broad → specific: Conflict and
 * Capture source (curated, open by default) → Event date → Added →
 * Tags → Author. Filter state lives in MapStateContext so it survives
 * navigation; the panel reads and writes the context directly. Active state
 * also renders as the shared removable-pill row (`ActiveFilterPills`, the
 * same pattern as the search page), visible even while the panel is
 * collapsed.
 */
export function FilterPanel({ tags, conflicts, points, pointCount, loading }: FilterPanelProps) {
  const {
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

  const [showAllTags, setShowAllTags] = useState(false);
  // Accordion open-state lives here (not per-section) so a re-render never
  // resets which sections are expanded. Curated buckets open by default.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Conflict: true,
    "Capture source": true,
  });
  const toggleSection = (title: string) =>
    setOpenSections((s) => ({ ...s, [title]: !s[title] }));

  const clearFilters = () => {
    setSelectedConflicts([]);
    setSelectedCaptureSources([]);
    setSelectedTags([]);
    setSelectedMediaTypes([]);
    setTrustedOnly(false);
    setHideDemo(false);
    setEventStart("");
    setEventEnd("");
    setEventPlaying(false);
    setSubmittedStart("");
    setSubmittedEnd("");
    setSubmittedPlaying(false);
    setAuthorFilter("");
  };

  // Chip toggle: add to the bucket if absent, remove if present.
  const toggleInBucket = (
    name: string,
    set: (v: string[] | ((prev: string[]) => string[])) => void,
  ) => set((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const removeFromBucket = (
    name: string,
    set: (v: string[] | ((prev: string[]) => string[])) => void,
  ) => set((prev) => prev.filter((n) => n !== name));

  const eventActive = !!(eventStart || eventEnd);
  const submittedActive = !!(submittedStart || submittedEnd);
  const authorActive = !!authorFilter.trim();

  // The shared removable-pill row: one entry per active filter, each date
  // window one entry (matching how the count treats them).
  const activeFilters: ActiveFilter[] = [
    ...selectedConflicts.map((n) => ({
      key: `conflict:${n}`,
      label: n,
      onRemove: () => removeFromBucket(n, setSelectedConflicts),
    })),
    ...selectedCaptureSources.map((n) => ({
      key: `capture:${n}`,
      label: n,
      onRemove: () => removeFromBucket(n, setSelectedCaptureSources),
    })),
    ...selectedTags.map((n) => ({
      key: `tag:${n}`,
      label: n,
      onRemove: () => removeFromBucket(n, setSelectedTags),
    })),
    ...selectedMediaTypes.map((n) => ({
      key: `media:${n}`,
      label: n[0].toUpperCase() + n.slice(1),
      onRemove: () => removeFromBucket(n, setSelectedMediaTypes),
    })),
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
    ...(authorActive
      ? [
          {
            key: "author",
            label: `by @${authorFilter.trim()}`,
            icon: <User size={11} />,
            onRemove: () => setAuthorFilter(""),
          },
        ]
      : []),
    ...(trustedOnly
      ? [{ key: "trusted", label: "Trusted only", onRemove: () => setTrustedOnly(false) }]
      : []),
    ...(hideDemo
      ? [{ key: "hide-demo", label: "Demo hidden", onRemove: () => setHideDemo(false) }]
      : []),
  ];

  const hasActiveFilters = activeFilters.length > 0;

  // Alphabetical so the free-tag "top N" preview is stable across loads.
  const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name);
  const captureSourceTags = tags.filter((t) => t.category === "capture_source").sort(byName);
  const freeTags = tags.filter((t) => t.category === "free").sort(byName);

  const visibleFreeTags = showAllTags
    ? freeTags
    : [
        ...freeTags.slice(0, TAGS_PREVIEW),
        ...freeTags.slice(TAGS_PREVIEW).filter((t) => selectedTags.includes(t.name)),
      ];

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
              {activeFilters.length}
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

      {hasActiveFilters && (
        <div className="mt-1.5">
          <ActiveFilterPills filters={activeFilters} onClearAll={clearFilters} />
        </div>
      )}

      {filtersOpen && (
        <div className="mt-1 bg-neutral-900 rounded-lg border border-neutral-700 px-3">
          {conflicts.length > 0 && (
            <FilterSection
              title="Conflict"
              concept="conflict"
              summary={chipSummary(selectedConflicts)}
              active={selectedConflicts.length > 0}
              open={!!openSections["Conflict"]}
              onToggle={() => toggleSection("Conflict")}
            >
              <ChipBucket
                options={conflicts}
                selected={selectedConflicts}
                onToggle={(n) => toggleInBucket(n, setSelectedConflicts)}
              />
            </FilterSection>
          )}

          {captureSourceTags.length > 0 && (
            <FilterSection
              title="Capture source"
              concept="capture_source"
              summary={chipSummary(selectedCaptureSources)}
              active={selectedCaptureSources.length > 0}
              open={!!openSections["Capture source"]}
              onToggle={() => toggleSection("Capture source")}
            >
              <ChipBucket
                options={captureSourceTags}
                selected={selectedCaptureSources}
                onToggle={(n) => toggleInBucket(n, setSelectedCaptureSources)}
              />
            </FilterSection>
          )}

          <FilterSection
            title="Source media"
            concept="source_media"
            summary={chipSummary(
              selectedMediaTypes.map((m) => m[0].toUpperCase() + m.slice(1)),
            )}
            active={selectedMediaTypes.length > 0}
            open={!!openSections["Source media"]}
            onToggle={() => toggleSection("Source media")}
          >
            <ChipBucket
              options={MEDIA_TYPES.map(([value, label]) => ({ id: value, name: value, label }))}
              selected={selectedMediaTypes}
              onToggle={(n) => toggleInBucket(n, setSelectedMediaTypes)}
            />
          </FilterSection>

          <FilterSection
            title="Event date"
            concept="event_date"
            summary={rangeSummary(eventStart, eventEnd)}
            active={eventActive}
            open={!!openSections["Event date"]}
            onToggle={() => toggleSection("Event date")}
          >
            <TimelineScrubber
              points={points}
              dateIndex={3}
              label="Event date"
              start={eventStart}
              setStart={setEventStart}
              end={eventEnd}
              setEnd={setEventEnd}
              playing={eventPlaying}
              setPlaying={setEventPlaying}
            />
          </FilterSection>

          <FilterSection
            title="Added"
            concept="added"
            summary={rangeSummary(submittedStart, submittedEnd)}
            active={submittedActive}
            open={!!openSections["Added"]}
            onToggle={() => toggleSection("Added")}
          >
            <TimelineScrubber
              points={points}
              dateIndex={4}
              label="Added"
              start={submittedStart}
              setStart={setSubmittedStart}
              end={submittedEnd}
              setEnd={setSubmittedEnd}
              playing={submittedPlaying}
              setPlaying={setSubmittedPlaying}
            />
          </FilterSection>

          {freeTags.length > 0 && (
            <FilterSection
              title="Tags"
              summary={chipSummary(selectedTags)}
              active={selectedTags.length > 0}
              open={!!openSections["Tags"]}
              onToggle={() => toggleSection("Tags")}
            >
              <ChipBucket
                options={visibleFreeTags}
                selected={selectedTags}
                onToggle={(n) => toggleInBucket(n, setSelectedTags)}
              />
              {freeTags.length > TAGS_PREVIEW && (
                <button
                  onClick={() => setShowAllTags((s) => !s)}
                  className="mt-2 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  {showAllTags ? "Show less" : `Show all ${freeTags.length}`}
                </button>
              )}
            </FilterSection>
          )}

          <FilterSection
            title="Author"
            summary={authorFilter.trim() || "Any"}
            active={authorActive}
            open={!!openSections["Author"]}
            onToggle={() => toggleSection("Author")}
          >
            <input
              type="text"
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              placeholder="Username..."
              aria-label="Author username"
              className="w-full px-2 py-1 bg-neutral-800 border border-neutral-700 rounded-sm text-[11px] text-neutral-300 placeholder-neutral-500 focus:outline-hidden focus:border-orange-500"
            />
          </FilterSection>

          <ToggleRow
            label="Trusted analysts only"
            on={trustedOnly}
            onToggle={() => setTrustedOnly((v) => !v)}
          />
          {/* Offered only when a demo row is actually on the map (the payload
              flags them), like `?used=true` narrows the conflict list: a
              toggle that can't change anything is noise. `points` is the
              server-filtered payload, so another active filter that excludes
              every demo row also hides the toggle; deliberate, the panel
              offers what the current view can show. Kept while active even
              though the filtered payload then carries no demo rows, else it
              couldn't be switched off. */}
          {(hideDemo || points.some((p) => p[6] === 1)) && (
            <ToggleRow
              label="Hide demo data"
              on={hideDemo}
              onToggle={() => setHideDemo((v) => !v)}
            />
          )}
        </div>
      )}
    </div>
  );
}
