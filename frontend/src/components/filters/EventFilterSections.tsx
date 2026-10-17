"use client";

import { useId, useState, type ReactNode } from "react";

import {
  AUTHOR_FILTER_RE,
  suggestApprovers,
  suggestAuthors,
  type ApprovalFilters,
} from "@/lib/search";

import type { Conflict, Tag } from "@/types";
import type { ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { TAP_STEP } from "@/components/ui/Button";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { AccountPicker, accountName, analystAccount } from "@/components/ui/AccountPicker";
import {
  FilterSection,
  chipSummary,
  rangeSummary,
} from "@/components/ui/FilterSection";
import { Pill } from "@/components/ui/Pill";
import type { Concept } from "@/lib/fieldHelp";

/**
 * The event filter panel, shared by the map overlay, the search page, the Requests board and the
 * feed: one component owns the section list (the surface's lead sections, Status, Conflict, Capture
 * source, Source media, Location guess, the surface's date sections, Tags, Author, Approvals), so a vocabulary
 * change lands on all four. Surfaces differ in their injected sections (`leadSections`,
 * `dateSections`) and in `sections`, the subset they offer (the search page's Collections group is
 * narrowed by `author` alone, and only the board offers Location guess).
 *
 * State stays surface-owned: this component takes one `values` object and emits patches.
 * `buildActiveFilterPills` derives the matching pill entries from the same shape so the
 * renderings can't drift.
 */

/** The common event filter values (the server vocabulary minus the surface-specific date windows). */
export interface EventFilterValues extends ApprovalFilters {
  statuses: string[];
  conflicts: string[];
  captureSources: string[];
  tags: string[];
  mediaTypes: string[];
  /** `LOCATION_GUESS_OPTIONS` values; read through `hasCoordsFilter`. */
  locationGuess: string[];
  author: string;
}

export const EMPTY_EVENT_FILTERS: EventFilterValues = {
  statuses: [],
  conflicts: [],
  captureSources: [],
  tags: [],
  mediaTypes: [],
  locationGuess: [],
  author: "",
  approved: false,
  approvedBy: null,
};

export type EventFilterPatch = (patch: Partial<EventFilterValues>) => void;

/** The panel's own sections, so a surface can offer a subset. Date sections are dropped by passing no `dateSections`. */
export type EventFilterSectionName =
  | "status"
  | "conflict"
  | "capture_source"
  | "source_media"
  | "location_guess"
  | "tags"
  | "author"
  | "approval";

/** The default stack in render order. `location_guess` is opt-in: only `GET /events` serves it. */
export const ALL_FILTER_SECTIONS: ReadonlyArray<EventFilterSectionName> = [
  "status",
  "conflict",
  "capture_source",
  "source_media",
  "tags",
  "author",
  "approval",
];

/** The two date windows both surfaces carry, whatever drives them. Empty string = open at that edge. */
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

/** A surface-specific section (the date controls) rendered in the accordion at its canonical position. */
export interface InjectedSection {
  title: string;
  concept?: Concept;
  summary: string;
  active: boolean;
  children: ReactNode;
}

// The free-tag bucket is unbounded: show this many, the rest behind "Show all". Selected tags past
// the cut always show.
const TAGS_PREVIEW = 8;

// Location-guess options: a request carrying a guessed point, or a blind one.
const LOCATION_GUESS_OPTIONS: ReadonlyArray<[string, string]> = [
  ["guessed", "With a guess"],
  ["blind", "No guess"],
];
const LOCATION_GUESS_LABELS: Record<string, string> = Object.fromEntries(LOCATION_GUESS_OPTIONS);
const locationGuessLabel = (value: string) => LOCATION_GUESS_LABELS[value] ?? value;

/** The `has_coords` value for the picked location-guess chips: undefined when none or both are
 * picked, since either way every row matches. */
export function hasCoordsFilter(locationGuess: string[]): boolean | undefined {
  if (locationGuess.length !== 1) return undefined;
  return locationGuess[0] === "guessed";
}

// Fixed media-presence options (Media.media_type values).
const MEDIA_TYPES: ReadonlyArray<[string, string]> = [
  ["image", "Image"],
  ["video", "Video"],
];

/** The lifecycle statuses this panel offers (Event.status values), in the backend vocabulary's
 * order. Hand-kept mirror of `event_filters.STATUSES` (see AGENTS.md): every status but `closed`,
 * whose retracted rows carry their own surfaces and which the chip could only empty. A search
 * reaches requested rows (the profile's open-requests block links into them). Exported so the
 * search page can gate crafted-URL values to the same vocabulary. */
export const STATUS_FILTER_OPTIONS: ReadonlyArray<[string, string]> = [
  ["requested", "Requested"],
  ["detected", "Detected"],
  ["geolocated", "Geolocated"],
];

// Value to chip label, shared by the pill row and the section summary.
const STATUS_FILTER_LABELS: Record<string, string> = Object.fromEntries(STATUS_FILTER_OPTIONS);
const statusLabel = (value: string) => STATUS_FILTER_LABELS[value] ?? value;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const APPROVED_ONLY = "approved";

/** The removable-pill entries for the common values; surfaces append their date-window entries.
 * The author is not a pill: its chip lives in the Author section. Surfaces count it on top of
 * these entries. */
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
    ...values.locationGuess.map((n) => ({
      key: `location:${n}`,
      label: locationGuessLabel(n),
      onRemove: () => drop("locationGuess", n),
    })),
    ...(values.approved
      ? [{ key: "approved", label: "Approved", onRemove: () => onPatch({ approved: false }) }]
      : []),
    ...(values.approvedBy
      ? [
          {
            key: "approved-by",
            label: `Approved by ${accountName(values.approvedBy)}`,
            onRemove: () => onPatch({ approvedBy: null }),
          },
        ]
      : []),
  ];
}

/** Pill entries for the two date windows. Clear callbacks are per window, not a patch, because a
 * surface may reset more than dates (the map also stops that window's playback). */
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

/** How many filters in the shared vocabulary narrow the view: one per pill, plus the author, which
 * counts though it has no pill, so a filtered surface never reads as unfiltered. */
export function countActiveFilters(
  values: EventFilterValues,
  windows: DateWindows
): number {
  return (
    values.statuses.length +
    values.conflicts.length +
    values.captureSources.length +
    values.tags.length +
    values.mediaTypes.length +
    values.locationGuess.length +
    (values.author.trim() ? 1 : 0) +
    (values.approved ? 1 : 0) +
    (values.approvedBy ? 1 : 0) +
    (eventWindowActive(windows) ? 1 : 0) +
    (addedWindowActive(windows) ? 1 : 0)
  );
}

export const hasAnyFilter = (values: EventFilterValues, windows: DateWindows): boolean =>
  countActiveFilters(values, windows) > 0;

export function EventFilterSections({
  tags,
  conflicts,
  values,
  onPatch,
  leadSections = [],
  dateSections = [],
  sections = ALL_FILTER_SECTIONS,
}: {
  /** Live tag taxonomy driving the capture-source + free chip buckets. */
  tags: Tag[];
  /** Conflicts carried by >=1 live event (`/conflicts?used=true`). */
  conflicts: Conflict[];
  values: EventFilterValues;
  onPatch: EventFilterPatch;
  /** Surface-specific sections above the shared stack (the feed's Kind). */
  leadSections?: InjectedSection[];
  dateSections?: InjectedSection[];
  /** Which sections this surface offers (default: all). A surface scoped to a view a section can't
   * narrow leaves it out rather than offer a control that can only empty the result. */
  sections?: ReadonlyArray<EventFilterSectionName>;
}) {
  const offers = (name: EventFilterSectionName) => sections.includes(name);
  const approvedById = useId();
  const [showAllTags, setShowAllTags] = useState(false);
  // The server's author filter is an exact match, so a typed fragment becomes a handle through
  // the typeahead; an ineligible draft is not committed, instead of 422ing.
  const commitAuthor = (name: string) => {
    if (AUTHOR_FILTER_RE.test(name)) onPatch({ author: name });
  };
  const author = values.author.trim();

  // Accordion open-state lives here so a re-render never resets it. Every section starts collapsed
  // except one holding an active value, so the reader sees what is applied.
  const isActive: Record<string, boolean> = {
    Status: values.statuses.length > 0,
    Conflict: values.conflicts.length > 0,
    "Capture source": values.captureSources.length > 0,
    "Source media": values.mediaTypes.length > 0,
    "Location guess": values.locationGuess.length > 0,
    Tags: values.tags.length > 0,
    Author: !!values.author.trim(),
    Approvals: values.approved || !!values.approvedBy,
    ...Object.fromEntries(
      [...leadSections, ...dateSections].map((s) => [s.title, s.active])
    ),
  };
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(isActive);
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

  const renderInjected = (section: InjectedSection) => (
    <FilterSection
      key={section.title}
      title={section.title}
      concept={section.concept}
      summary={section.summary}
      active={isActive[section.title]}
      open={!!openSections[section.title]}
      onToggle={() => toggleSection(section.title)}
    >
      {section.children}
    </FilterSection>
  );

  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-700 px-3">
      {leadSections.map(renderInjected)}

      {offers("status") && (
        <FilterSection
          title="Status"
          concept="status"
          summary={chipSummary(values.statuses.map(statusLabel))}
          active={isActive.Status}
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

      {offers("conflict") && conflicts.length > 0 && (
        <FilterSection
          title="Conflict"
          concept="conflict"
          summary={chipSummary(values.conflicts)}
          active={isActive.Conflict}
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

      {offers("capture_source") && captureSourceTags.length > 0 && (
        <FilterSection
          title="Capture source"
          concept="capture_source"
          summary={chipSummary(values.captureSources)}
          active={isActive["Capture source"]}
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

      {offers("source_media") && (
        <FilterSection
          title="Source media"
          concept="source_media"
          summary={chipSummary(values.mediaTypes.map(capitalize))}
          active={isActive["Source media"]}
          open={!!openSections["Source media"]}
          onToggle={() => toggleSection("Source media")}
        >
          <ChipBucket
            options={MEDIA_TYPES.map(([value, label]) => ({ id: value, name: value, label }))}
            selected={values.mediaTypes}
            onToggle={(n) => toggleIn("mediaTypes", n)}
          />
        </FilterSection>
      )}

      {offers("location_guess") && (
        <FilterSection
          title="Location guess"
          summary={chipSummary(values.locationGuess.map(locationGuessLabel))}
          active={isActive["Location guess"]}
          open={!!openSections["Location guess"]}
          onToggle={() => toggleSection("Location guess")}
        >
          <ChipBucket
            options={LOCATION_GUESS_OPTIONS.map(([value, label]) => ({ id: value, name: value, label }))}
            selected={values.locationGuess}
            onToggle={(n) => toggleIn("locationGuess", n)}
          />
        </FilterSection>
      )}

      {dateSections.map(renderInjected)}

      {offers("tags") && freeTags.length > 0 && (
        <FilterSection
          title="Tags"
          summary={chipSummary(values.tags)}
          active={isActive.Tags}
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
              className={`mt-2 inline-flex items-center ${TAP_STEP} text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors`}
            >
              {showAllTags ? "Show less" : `Show all ${freeTags.length}`}
            </button>
          )}
        </FilterSection>
      )}

      {offers("author") && (
        <FilterSection
          title="Author"
          summary={values.author.trim() || "Any"}
          active={isActive.Author}
          open={!!openSections["Author"]}
          onToggle={() => toggleSection("Author")}
        >
          <AccountPicker
            search={suggestAuthors}
            minQueryLength={2}
            selected={author ? analystAccount({ username: author }) : null}
            onSelect={(account) => commitAuthor(accountName(account))}
            onSubmitText={commitAuthor}
            onClear={() => onPatch({ author: "" })}
            placeholder="Type a username…"
            aria-label="Author username"
            emptyText="No analyst matches"
            className="sm:text-[11px]"
          />
        </FilterSection>
      )}

      {offers("approval") && (
        <FilterSection
          title="Approvals"
          concept="approval_filter"
          summary={
            values.approvedBy
              ? accountName(values.approvedBy)
              : values.approved
                ? "Approved"
                : "Any"
          }
          active={isActive.Approvals}
          open={!!openSections["Approvals"]}
          onToggle={() => toggleSection("Approvals")}
        >
          <div className="space-y-2">
            <ChipBucket
              options={[{ id: APPROVED_ONLY, name: APPROVED_ONLY, label: "Approved only" }]}
              selected={values.approved ? [APPROVED_ONLY] : []}
              onToggle={() => onPatch({ approved: !values.approved })}
            />
            <label htmlFor={approvedById} className={FORM_LABEL}>
              Approved by
            </label>
            <AccountPicker
              id={approvedById}
              search={suggestApprovers}
              minQueryLength={2}
              selected={values.approvedBy}
              onSelect={(account) => onPatch({ approvedBy: account })}
              onSubmitText={(name) => {
                if (AUTHOR_FILTER_RE.test(name)) {
                  onPatch({ approvedBy: analystAccount({ username: name }) });
                }
              }}
              onClear={() => onPatch({ approvedBy: null })}
              placeholder="Type an analyst or organization…"
              emptyText="No analyst or organization matches"
              className="sm:text-[11px]"
            />
          </div>
        </FilterSection>
      )}
    </div>
  );
}
