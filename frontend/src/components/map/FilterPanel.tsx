"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";

import type { Conflict, MapPoint, Tag } from "@/types";
import { Pill } from "@/components/ui/Pill";
import { Switch } from "@/components/ui/Switch";
import { Dot } from "@/components/ui/Dot";
import { FieldHelp } from "@/components/ui/FieldHelp";
import type { Concept } from "@/lib/fieldHelp";
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

/** Collapsed-header summary: "Any", a single value, or "first +N". */
function chipSummary(values: string[]): string {
  if (values.length === 0) return "Any";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

const fmtMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** Compact "start – end" summary from two optional ISO dates ("" = open). */
function rangeSummary(from: string, to: string): string {
  if (!from && !to) return "Any";
  return `${from ? fmtMonth(from) : "…"} – ${to ? fmtMonth(to) : "…"}`;
}

/**
 * One collapsible filter section. Open/closed state is owned by the parent
 * (controlled via `open` + `onToggle`) so a panel re-render — e.g. toggling
 * "show all tags" — never resets which sections are expanded. While collapsed
 * the header shows a one-line state summary (orange when active); heavy
 * controls (the timelines) only mount when open.
 */
function FilterSection({
  title,
  concept,
  summary,
  active,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** Shared `?` concept for this filter (same registry as the forms / detail
   *  page). Omit for filter-only controls with no domain concept. */
  concept?: Concept;
  summary: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  // The header is a row, not one button: the `?` is its own button (a button
  // can't nest inside another), so the title + the summary/chevron each toggle
  // the section while the `?` opens its tooltip independently.
  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <div className="w-full flex items-center justify-between py-2.5 group">
        <span className="flex items-center gap-1 min-w-0">
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors"
          >
            {title}
          </button>
          {concept && <FieldHelp concept={concept} size={12} />}
        </span>
        <button
          onClick={onToggle}
          aria-label={`Toggle ${title}`}
          className="flex items-center gap-1.5 min-w-0"
        >
          {!open && (
            <span
              className={`text-[11px] truncate max-w-[150px] ${
                active ? "text-orange-400" : "text-neutral-600"
              }`}
            >
              {summary}
            </span>
          )}
          {open ? (
            <ChevronUp size={13} className="text-neutral-500 shrink-0" />
          ) : (
            <ChevronDown size={13} className="text-neutral-500 shrink-0" />
          )}
        </button>
      </div>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

/** A compact on/off row for a boolean filter. The whole row is the switch
 *  (role + click live here), so the `<Switch>` renders as its visual span. */
function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2.5 border-b border-neutral-800 last:border-b-0 group"
    >
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors">
        {label}
      </span>
      <Switch as="span" size="sm" on={on} />
    </button>
  );
}

/**
 * The map's filter overlay. Sections collapse individually (state summaries in
 * the header), ordered required → optional, broad → specific: Conflict and
 * Capture source (curated, open by default) → Event date → Added →
 * Tags → Author. Filter state lives in MapStateContext so it survives
 * navigation; the panel reads and writes the context directly.
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

  const eventActive = !!(eventStart || eventEnd);
  const submittedActive = !!(submittedStart || submittedEnd);
  const authorActive = !!authorFilter.trim();

  const activeFilterCount =
    selectedConflicts.length +
    selectedCaptureSources.length +
    selectedTags.length +
    selectedMediaTypes.length +
    (trustedOnly ? 1 : 0) +
    (hideDemo ? 1 : 0) +
    // Each timeline window counts as one active filter.
    (eventActive ? 1 : 0) +
    (submittedActive ? 1 : 0) +
    (authorActive ? 1 : 0);

  const hasActiveFilters = activeFilterCount > 0;

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

  const renderChips = (
    bucket: { id: string; name: string }[],
    selected: string[],
    setter: (v: string[] | ((prev: string[]) => string[])) => void,
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {bucket.map((tag) => (
        <Pill
          key={tag.id}
          tone={selected.includes(tag.name) ? "accent" : "neutral"}
          onClick={() => toggleInBucket(tag.name, setter)}
        >
          {tag.name}
        </Pill>
      ))}
    </div>
  );

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
              {renderChips(conflicts, selectedConflicts, setSelectedConflicts)}
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
              {renderChips(captureSourceTags, selectedCaptureSources, setSelectedCaptureSources)}
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
            <div className="flex flex-wrap gap-1.5">
              {MEDIA_TYPES.map(([value, lbl]) => (
                <Pill
                  key={value}
                  tone={selectedMediaTypes.includes(value) ? "accent" : "neutral"}
                  onClick={() => toggleInBucket(value, setSelectedMediaTypes)}
                >
                  {lbl}
                </Pill>
              ))}
            </div>
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
              {renderChips(visibleFreeTags, selectedTags, setSelectedTags)}
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

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="w-full text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors py-2"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
