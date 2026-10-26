"use client";

import { useId, useState, type ReactNode } from "react";

import {
  AUTHOR_FILTER_RE,
  suggestApprovers,
  suggestAuthors,
  type ApprovalFilters,
} from "@/lib/search";

import type { Conflict, Tag } from "@/types";
import { CARD_FRAME } from "@/components/ui/Card";
import { EVENT_STATUS_META } from "@/components/event/StatusBadge";
import type { ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { AccountPicker, accountName, analystAccount } from "@/components/ui/AccountPicker";
import {
  FilterSection,
  chipSummary,
  rangeSummary,
} from "@/components/ui/FilterSection";
import { ConflictChips, TagChips } from "@/components/ui/TagPicker";
import type { Concept } from "@/lib/fieldHelp";
import {
  LEVEL_LABELS,
  SOURCE_KIND_LABELS,
  SOURCE_KINDS,
  SOURCE_LEVELS,
  type SourceKind,
  type SourceLevel,
} from "@/lib/sources";

/**
 * The event filter panel, shared by the map overlay, the search page, the Requests board and the
 * feed: one component owns the section list (the surface's lead sections, Status, Conflict, Source
 * kind, Level, Media, Location guess, the surface's date sections, Tags, Author, Approvals), so a vocabulary
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
  sourceKinds: string[];
  levels: string[];
  tags: string[];
  mediaTypes: string[];
  /** `LOCATION_GUESS_OPTIONS` values; read through `hasCoordsFilter`. */
  locationGuess: string[];
  author: string;
}

export const EMPTY_EVENT_FILTERS: EventFilterValues = {
  statuses: [],
  conflicts: [],
  sourceKinds: [],
  levels: [],
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
  | "source_kind"
  | "level"
  | "media"
  | "location_guess"
  | "tags"
  | "author"
  | "approval";

/** The default stack in render order. `location_guess` is opt-in: only `GET /events` serves it. */
export const ALL_FILTER_SECTIONS: ReadonlyArray<EventFilterSectionName> = [
  "status",
  "conflict",
  "source_kind",
  "level",
  "media",
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
interface InjectedSection {
  title: string;
  concept?: Concept;
  summary: string;
  active: boolean;
  children: ReactNode;
}

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

// The source kind and level chips, in the generated vocabulary's order.
const SOURCE_KIND_OPTIONS = SOURCE_KINDS.map((value) => ({
  id: value,
  name: value,
  label: SOURCE_KIND_LABELS[value],
}));
const LEVEL_OPTIONS = SOURCE_LEVELS.map((value) => ({ id: value, name: value, label: LEVEL_LABELS[value] }));
const sourceKindLabel = (value: string) => SOURCE_KIND_LABELS[value as SourceKind] ?? value;
const levelLabel = (value: string) => LEVEL_LABELS[value as SourceLevel] ?? value;

// Fixed media-presence options (Media.kind values).
const MEDIA_TYPES: ReadonlyArray<[string, string]> = [
  ["image", "Image"],
  ["video", "Video"],
];

/** The lifecycle statuses this panel offers (Event.status values), in the backend vocabulary's
 * order. Hand-kept mirror of `event_filters.STATUSES` (see AGENTS.md): every status but `closed`,
 * whose retracted rows carry their own surfaces and which the chip could only empty. A search
 * reaches requested rows (the profile's open-requests block links into them). */
const FILTER_STATUSES = [
  "requested",
  "detected",
  "geolocated",
] as const;

/** The status filter's options, each labelled like the status badge (`EVENT_STATUS_META`).
 *  Exported so the search page can gate crafted-URL values to the same vocabulary. */
export const STATUS_FILTER_OPTIONS: ReadonlyArray<[string, string]> = FILTER_STATUSES.map(
  (status) => [status, EVENT_STATUS_META[status].label],
);

// Value to chip label, shared by the pill row and the section summary.
const STATUS_FILTER_LABELS: Record<string, string> = Object.fromEntries(STATUS_FILTER_OPTIONS);
const statusLabel = (value: string) => STATUS_FILTER_LABELS[value] ?? value;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const APPROVED_ONLY = "approved";

/** The removable-pill entries for the common values, one per value; surfaces append their
 * date-window entries. */
/** The key of the author pill `buildActiveFilterPills` emits. The filter rail leaves that pill
 *  out: the Author section already names the analyst, in its summary and its picker. */
export const AUTHOR_PILL_KEY = "author";

export function buildActiveFilterPills(
  values: EventFilterValues,
  onPatch: EventFilterPatch
): ActiveFilter[] {
  const drop = (key: keyof EventFilterValues, name: string) =>
    onPatch({ [key]: (values[key] as string[]).filter((n) => n !== name) });
  const author = values.author.trim();
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
    ...values.sourceKinds.map((n) => ({
      key: `source_kind:${n}`,
      label: sourceKindLabel(n),
      onRemove: () => drop("sourceKinds", n),
    })),
    ...values.levels.map((n) => ({
      key: `level:${n}`,
      label: levelLabel(n),
      onRemove: () => drop("levels", n),
    })),
    ...values.tags.map((n) => ({
      key: `tag:${n}`,
      label: n,
      onRemove: () => drop("tags", n),
    })),
    ...(author
      ? [{ key: AUTHOR_PILL_KEY, label: `By ${author}`, onRemove: () => onPatch({ author: "" }) }]
      : []),
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

/** How many filters in the shared vocabulary narrow the view: one per pill. */
export function countActiveFilters(
  values: EventFilterValues,
  windows: DateWindows
): number {
  return (
    values.statuses.length +
    values.conflicts.length +
    values.sourceKinds.length +
    values.levels.length +
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
  /** Live tag taxonomy the tag field searches. */
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
    "Source kind": values.sourceKinds.length > 0,
    Level: values.levels.length > 0,
    Media: values.mediaTypes.length > 0,
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

  const sortedTags = [...tags].sort((a: Tag, b: Tag) => a.name.localeCompare(b.name));

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
    <div className={`${CARD_FRAME} px-3`}>
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
          <ConflictChips
            filter
            conflicts={conflicts}
            selected={values.conflicts}
            setSelected={(next) => onPatch({ conflicts: next })}
          />
        </FilterSection>
      )}

      {offers("source_kind") && (
        <FilterSection
          title="Source kind"
          concept="source_kind"
          summary={chipSummary(values.sourceKinds.map(sourceKindLabel))}
          active={isActive["Source kind"]}
          open={!!openSections["Source kind"]}
          onToggle={() => toggleSection("Source kind")}
        >
          <ChipBucket
            options={SOURCE_KIND_OPTIONS}
            selected={values.sourceKinds}
            onToggle={(n) => toggleIn("sourceKinds", n)}
          />
        </FilterSection>
      )}

      {offers("level") && (
        <FilterSection
          title="Level"
          concept="source_level"
          summary={chipSummary(values.levels.map(levelLabel))}
          active={isActive.Level}
          open={!!openSections["Level"]}
          onToggle={() => toggleSection("Level")}
        >
          <ChipBucket
            options={LEVEL_OPTIONS}
            selected={values.levels}
            onToggle={(n) => toggleIn("levels", n)}
          />
        </FilterSection>
      )}

      {offers("media") && (
        <FilterSection
          title="Media"
          summary={chipSummary(values.mediaTypes.map(capitalize))}
          active={isActive.Media}
          open={!!openSections["Media"]}
          onToggle={() => toggleSection("Media")}
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

      {offers("tags") && tags.length > 0 && (
        <FilterSection
          title="Tags"
          summary={chipSummary(values.tags)}
          active={isActive.Tags}
          open={!!openSections["Tags"]}
          onToggle={() => toggleSection("Tags")}
        >
          <TagChips
            filter
            tags={sortedTags}
            selected={values.tags}
            setSelected={(next) => onPatch({ tags: next })}
          />
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
            />
          </div>
        </FilterSection>
      )}
    </div>
  );
}
