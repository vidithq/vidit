"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { AUTHOR_FILTER_RE, suggestAuthors } from "@/lib/search";

import type { Conflict, Tag } from "@/types";
import type { ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { Input } from "@/components/ui/Input";
import {
  FilterSection,
  chipSummary,
  rangeSummary,
} from "@/components/ui/FilterSection";
import { Pill } from "@/components/ui/Pill";
import type { Concept } from "@/lib/fieldHelp";

/**
 * THE event filter panel, shared by the map overlay and the search page: one
 * component owns the section list (Status → Conflict → Capture source →
 * Source media → the surface's date sections → Tags → Author), so a change to the
 * filter vocabulary lands on both surfaces at once. The surfaces differ only
 * in their date controls (the map's timeline scrubbers vs the search page's
 * date inputs), injected as data via `dateSections`, and in surface-only
 * toggles appended via `extraToggles` (the map's hide-demo).
 *
 * State stays surface-owned (the map's context survives navigation, the
 * search page syncs the URL): this component receives one `values` object and
 * emits patches. `buildActiveFilterPills` derives the matching removable-pill
 * entries from the same shape so the two renderings can't drift either.
 */

/** The common event filter values (the server vocabulary minus the
 *  surface-specific date windows). */
export interface EventFilterValues {
  statuses: string[];
  conflicts: string[];
  captureSources: string[];
  tags: string[];
  mediaTypes: string[];
  author: string;
}

export const EMPTY_EVENT_FILTERS: EventFilterValues = {
  statuses: [],
  conflicts: [],
  captureSources: [],
  tags: [],
  mediaTypes: [],
  author: "",
};

export type EventFilterPatch = (patch: Partial<EventFilterValues>) => void;

/** The two date windows both event surfaces carry, whatever control drives them
 *  (the map's timeline scrubbers, the search page's date inputs). Empty string
 *  = open at that edge. */
export interface DateWindows {
  eventFrom: string;
  eventTo: string;
  addedFrom: string;
  addedTo: string;
}

export const EMPTY_DATE_WINDOWS: DateWindows = {
  eventFrom: "",
  eventTo: "",
  addedFrom: "",
  addedTo: "",
};

export const eventWindowActive = (w: DateWindows) => !!(w.eventFrom || w.eventTo);
export const addedWindowActive = (w: DateWindows) => !!(w.addedFrom || w.addedTo);

/** A surface-specific section (the date controls) rendered inside the shared
 *  accordion at its canonical position. */
export interface InjectedSection {
  title: string;
  concept?: Concept;
  summary: string;
  active: boolean;
  children: ReactNode;
}

// Author typeahead debounce: long enough not to fetch usernames per keystroke,
// short enough that the list is up by the time you stop typing.
const AUTHOR_SUGGEST_DEBOUNCE_MS = 250;

// Free-tag bucket grows unbounded; show this many, hide the rest behind
// "Show all". Selected tags past the cut are surfaced regardless so you can
// still see and clear them without expanding.
const TAGS_PREVIEW = 8;

// Fixed media-presence options (Media.media_type values).
const MEDIA_TYPES: ReadonlyArray<[string, string]> = [
  ["image", "Image"],
  ["video", "Video"],
];

/** The lifecycle statuses this panel offers (Event.status values). Only the
 *  two the served views can actually contain: the map and the search event
 *  groups show geolocated + detected rows; requested lives in the requests
 *  view and closed rows carry their own surfaces, so offering either here
 *  would be a chip that can only empty the result. Hand-kept mirror of the
 *  backend status vocabulary (`event_filters.STATUSES`, see AGENTS.md), the
 *  subset the filtered read views serve. Exported so the search page can
 *  gate crafted-URL values to the same vocabulary. */
export const STATUS_FILTER_OPTIONS: ReadonlyArray<[string, string]> = [
  ["geolocated", "Geolocated"],
  ["detected", "Detected"],
];

// Value → chip label, so the pill row and the section summary reuse the
// options' labels instead of re-deriving them from the raw value.
const STATUS_FILTER_LABELS: Record<string, string> = Object.fromEntries(STATUS_FILTER_OPTIONS);
const statusLabel = (value: string) => STATUS_FILTER_LABELS[value] ?? value;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The removable-pill entries for the common filter values; the surfaces
 *  append their date-window entries to the same array. The author is NOT a
 *  pill: its committed chip already lives inside the Author section, and a
 *  second "by @x" above it was pure duplication. Surfaces that show an
 *  active-filter total count it on top of these entries. */
export function buildActiveFilterPills(
  values: EventFilterValues,
  onPatch: EventFilterPatch
): ActiveFilter[] {
  const drop = (key: keyof EventFilterValues, name: string) =>
    onPatch({ [key]: (values[key] as string[]).filter((n) => n !== name) });
  return [
    ...values.statuses.map((n) => ({
      key: `status:${n}`,
      label: statusLabel(n),
      onRemove: () => drop("statuses", n),
    })),
    ...values.conflicts.map((n) => ({
      key: `conflict:${n}`,
      label: n,
      onRemove: () => drop("conflicts", n),
    })),
    ...values.captureSources.map((n) => ({
      key: `capture:${n}`,
      label: n,
      onRemove: () => drop("captureSources", n),
    })),
    ...values.tags.map((n) => ({
      key: `tag:${n}`,
      label: n,
      onRemove: () => drop("tags", n),
    })),
    ...values.mediaTypes.map((n) => ({
      key: `media:${n}`,
      label: capitalize(n),
      onRemove: () => drop("mediaTypes", n),
    })),
  ];
}

/** The removable-pill entries for the two date windows, appended after the
 *  value pills above. The clear callbacks are per window rather than a patch,
 *  because a surface may have more to reset than the dates (the map also stops
 *  that window's playback). */
export function buildDateWindowPills(
  windows: DateWindows,
  onClearEvent: () => void,
  onClearAdded: () => void
): ActiveFilter[] {
  return [
    ...(eventWindowActive(windows)
      ? [
          {
            key: "event-window",
            label: `Event: ${rangeSummary(windows.eventFrom, windows.eventTo)}`,
            onRemove: onClearEvent,
          },
        ]
      : []),
    ...(addedWindowActive(windows)
      ? [
          {
            key: "added-window",
            label: `Added: ${rangeSummary(windows.addedFrom, windows.addedTo)}`,
            onRemove: onClearAdded,
          },
        ]
      : []),
  ];
}

/** True when anything in the shared vocabulary narrows the view. The author
 *  counts even though it carries no pill (its chip lives in the Author
 *  section), so a filtered surface can never read as unfiltered. Surface-only
 *  toggles (the map's hide-demo) are the surface's to add on top. */
export function hasAnyFilter(
  values: EventFilterValues,
  windows: DateWindows
): boolean {
  return (
    values.statuses.length > 0 ||
    values.conflicts.length > 0 ||
    values.captureSources.length > 0 ||
    values.tags.length > 0 ||
    values.mediaTypes.length > 0 ||
    !!values.author.trim() ||
    eventWindowActive(windows) ||
    addedWindowActive(windows)
  );
}

export function EventFilterSections({
  tags,
  conflicts,
  values,
  onPatch,
  dateSections = [],
  extraToggles,
  showStatus = true,
}: {
  /** Live tag taxonomy driving the capture-source + free chip buckets. */
  tags: Tag[];
  /** Conflicts carried by >=1 live event (`/conflicts?used=true`). */
  conflicts: Conflict[];
  values: EventFilterValues;
  onPatch: EventFilterPatch;
  dateSections?: InjectedSection[];
  /** Surface-only toggle rows appended after Author (the map's hide-demo). */
  extraToggles?: ReactNode;
  /** Whether to render the Status section. Default on; a surface scoped to a
   *  view where neither offered status can match (the search page's legacy
   *  request scope) hides it rather than offering chips that can only empty
   *  the result. */
  showStatus?: boolean;
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  // The author input is commit-style, like picking a tag chip: typing stays
  // local and fetches real usernames to pick from (the filter itself is an
  // exact match server-side, so a fragment must become a handle), and the
  // committed value renders as a removable chip below. Live-filtering per
  // keystroke refetched the surface on every letter and flashed partial
  // "by @a" pills.
  const [authorDraft, setAuthorDraft] = useState("");
  const [authorSuggestions, setAuthorSuggestions] = useState<string[]>([]);
  const commitAuthor = (name: string) => {
    const v = name.trim();
    // Same gate as the server's ?author= pattern: an ineligible draft (space,
    // @, too long) is silently not committed instead of 422ing the surface.
    if (!AUTHOR_FILTER_RE.test(v)) return;
    onPatch({ author: v });
    setAuthorDraft("");
    setAuthorSuggestions([]);
  };

  // Debounced typeahead over live usernames. An ineligible draft (under two
  // characters, or carrying something the ?author= gate rejects) can't be
  // queried, so it clears the list instead of 422ing; that clear is immediate,
  // only the fetch waits out the debounce.
  const authorQuery = authorDraft.trim();
  const canSuggest = authorQuery.length >= 2 && AUTHOR_FILTER_RE.test(authorQuery);
  useEffect(() => {
    if (!canSuggest) setAuthorSuggestions([]);
  }, [canSuggest, authorQuery]);
  useDebouncedEffect(
    () => {
      if (!canSuggest) return;
      let cancelled = false;
      suggestAuthors(authorQuery)
        .then((authors) => {
          if (!cancelled) setAuthorSuggestions(authors);
        })
        .catch(() => {
          if (!cancelled) setAuthorSuggestions([]);
        });
      return () => {
        cancelled = true;
      };
    },
    [authorQuery, canSuggest],
    AUTHOR_SUGGEST_DEBOUNCE_MS,
  );
  // Accordion open-state lives here (not per-section) so a re-render never
  // resets which sections are expanded. Curated buckets open by default.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Conflict: true,
    "Capture source": true,
  });
  const toggleSection = (title: string) =>
    setOpenSections((s) => ({ ...s, [title]: !s[title] }));

  const toggleIn = (key: keyof EventFilterValues, name: string) => {
    const bucket = values[key] as string[];
    onPatch({
      [key]: bucket.includes(name) ? bucket.filter((n) => n !== name) : [...bucket, name],
    });
  };

  // Alphabetical so the free-tag "top N" preview is stable across loads.
  const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name);
  const captureSourceTags = tags.filter((t) => t.category === "capture_source").sort(byName);
  const freeTags = tags.filter((t) => t.category === "free").sort(byName);

  const visibleFreeTags = showAllTags
    ? freeTags
    : [
        ...freeTags.slice(0, TAGS_PREVIEW),
        ...freeTags.slice(TAGS_PREVIEW).filter((t) => values.tags.includes(t.name)),
      ];

  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-700 px-3">
      {showStatus && (
        <FilterSection
          title="Status"
          concept="status"
          summary={chipSummary(values.statuses.map(statusLabel))}
          active={values.statuses.length > 0}
          open={!!openSections["Status"]}
          onToggle={() => toggleSection("Status")}
        >
          <ChipBucket
            options={STATUS_FILTER_OPTIONS.map(([value, label]) => ({
              id: value,
              name: value,
              label,
            }))}
            selected={values.statuses}
            onToggle={(n) => toggleIn("statuses", n)}
          />
        </FilterSection>
      )}

      {conflicts.length > 0 && (
        <FilterSection
          title="Conflict"
          concept="conflict"
          summary={chipSummary(values.conflicts)}
          active={values.conflicts.length > 0}
          open={!!openSections["Conflict"]}
          onToggle={() => toggleSection("Conflict")}
        >
          <ChipBucket
            options={conflicts}
            selected={values.conflicts}
            onToggle={(n) => toggleIn("conflicts", n)}
          />
        </FilterSection>
      )}

      {captureSourceTags.length > 0 && (
        <FilterSection
          title="Capture source"
          concept="capture_source"
          summary={chipSummary(values.captureSources)}
          active={values.captureSources.length > 0}
          open={!!openSections["Capture source"]}
          onToggle={() => toggleSection("Capture source")}
        >
          <ChipBucket
            options={captureSourceTags}
            selected={values.captureSources}
            onToggle={(n) => toggleIn("captureSources", n)}
          />
        </FilterSection>
      )}

      <FilterSection
        title="Source media"
        concept="source_media"
        summary={chipSummary(values.mediaTypes.map(capitalize))}
        active={values.mediaTypes.length > 0}
        open={!!openSections["Source media"]}
        onToggle={() => toggleSection("Source media")}
      >
        <ChipBucket
          options={MEDIA_TYPES.map(([value, label]) => ({ id: value, name: value, label }))}
          selected={values.mediaTypes}
          onToggle={(n) => toggleIn("mediaTypes", n)}
        />
      </FilterSection>

      {dateSections.map((section) => (
        <FilterSection
          key={section.title}
          title={section.title}
          concept={section.concept}
          summary={section.summary}
          active={section.active}
          open={!!openSections[section.title]}
          onToggle={() => toggleSection(section.title)}
        >
          {section.children}
        </FilterSection>
      ))}

      {freeTags.length > 0 && (
        <FilterSection
          title="Tags"
          summary={chipSummary(values.tags)}
          active={values.tags.length > 0}
          open={!!openSections["Tags"]}
          onToggle={() => toggleSection("Tags")}
        >
          <ChipBucket
            options={visibleFreeTags}
            selected={values.tags}
            onToggle={(n) => toggleIn("tags", n)}
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
        summary={values.author.trim() || "Any"}
        active={!!values.author.trim()}
        open={!!openSections["Author"]}
        onToggle={() => toggleSection("Author")}
      >
        <div className="space-y-2">
          {values.author.trim() && (
            <div className="flex flex-wrap gap-1.5">
              <Pill
                tone="accent"
                title="Remove the author filter"
                onClick={() => onPatch({ author: "" })}
              >
                @{values.author.trim()}
              </Pill>
            </div>
          )}
          <Input
            type="text"
            value={authorDraft}
            onChange={(e) => setAuthorDraft(e.target.value)}
            // Enter commits the top suggestion (a real handle) when one is
            // up, else the raw draft. No blur commit: clicking away
            // mid-typing must not apply a partial username, the
            // accidental-filter behavior the commit style exists to prevent.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitAuthor(authorSuggestions[0] ?? authorDraft);
              }
            }}
            placeholder="Type a username…"
            aria-label="Author username"
            className="bg-neutral-800 text-[11px]"
          />
          {authorSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {authorSuggestions.map((name) => (
                <Pill key={name} onClick={() => commitAuthor(name)}>
                  @{name}
                </Pill>
              ))}
            </div>
          )}
        </div>
      </FilterSection>

      {extraToggles}
    </div>
  );
}
