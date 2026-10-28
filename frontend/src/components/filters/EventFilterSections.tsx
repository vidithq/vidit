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
import { FieldLabel } from "@/components/ui/FieldLabel";
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
 * feed: one component owns the row order, so a vocabulary change lands on all four. The rows: the
 * surface's `lead` rows, a "Status, conflict, tags" row ("Show, conflict, tags" with a `layer`), a
 * Dates row of the surface's `dateSections`, Location guess, a Source row of Source kind, Level and
 * Media, and a People row of Author and Approvals. Sections that share a row show as fields under one collapsible header; a
 * row left with one section shows it as its own row. Surfaces differ in `lead`, `layer`,
 * `dateSections` and `sections`, the subset they offer (the search page's Collections group is
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

/** The default set. `location_guess` is opt-in: only `GET /events` serves it. */
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

/** One filter: its own row, or one field of a merged row. A surface passes its own (the date
 * controls, the lead rows) in the same shape. */
interface InjectedSection {
  title: string;
  concept?: Concept;
  summary: string;
  active: boolean;
  children: ReactNode;
}

/** A map layer offered as one more chip after the status chips: on shows the layer, and `note`
 * shows under the chips while it is on. With a layer, the field reads "Show" instead of "Status". */
interface FilterLayer {
  label: string;
  on: boolean;
  onToggle: () => void;
  note?: ReactNode;
}

const LAYER_CHIP = "layer";

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
  lead = [],
  layer,
  dateSections = [],
  sections = ALL_FILTER_SECTIONS,
}: {
  /** Live tag taxonomy the tag field searches. */
  tags: Tag[];
  /** Conflicts carried by >=1 live event (`/conflicts?used=true`). */
  conflicts: Conflict[];
  values: EventFilterValues;
  onPatch: EventFilterPatch;
  /** Surface-specific rows above the shared ones (the feed's Kind). */
  lead?: InjectedSection[];
  /** A layer chip after the status chips (the map's Sites). */
  layer?: FilterLayer;
  /** The surface's date windows, merged into the Event group's Dates row. */
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

  const toggleIn = (key: keyof EventFilterValues, name: string) => {
    const bucket = values[key] as string[];
    onPatch({
      [key]: bucket.includes(name) ? bucket.filter((n) => n !== name) : [...bucket, name],
    });
  };

  const sortedTags = [...tags].sort((a: Tag, b: Tag) => a.name.localeCompare(b.name));
  const when = (offered: boolean, section: InjectedSection) => (offered ? [section] : []);

  const allRows: FilterRow[] = [
    ...lead.map((s) => ({ key: s.title, fields: [s] })),
    {
      key: "event",
      fields: [
        ...when(offers("status"), {
          title: layer ? "Show" : "Status",
          concept: "status",
          summary: chipSummary([
            ...values.statuses.map(statusLabel),
            ...(layer?.on ? [layer.label] : []),
          ]),
          active: values.statuses.length > 0 || !!layer?.on,
          children: (
            <>
              <ChipBucket
                options={[
                  ...STATUS_FILTER_OPTIONS.map(([value, label]) => ({ id: value, name: value, label })),
                  ...(layer ? [{ id: LAYER_CHIP, name: LAYER_CHIP, label: layer.label }] : []),
                ]}
                selected={[...values.statuses, ...(layer?.on ? [LAYER_CHIP] : [])]}
                onToggle={(n) => (n === LAYER_CHIP ? layer?.onToggle() : toggleIn("statuses", n))}
              />
              {layer?.on && layer.note}
            </>
          ),
        }),
        ...when(offers("conflict") && conflicts.length > 0, {
          title: "Conflict",
          concept: "conflict",
          summary: chipSummary(values.conflicts),
          active: values.conflicts.length > 0,
          children: (
            <ConflictChips
              filter
              conflicts={conflicts}
              selected={values.conflicts}
              setSelected={(next) => onPatch({ conflicts: next })}
            />
          ),
        }),
        ...when(offers("tags") && tags.length > 0, {
          title: "Tags",
          summary: chipSummary(values.tags),
          active: values.tags.length > 0,
          children: (
            <TagChips
              filter
              tags={sortedTags}
              selected={values.tags}
              setSelected={(next) => onPatch({ tags: next })}
            />
          ),
        }),
      ],
    },
    { key: "dates", title: "Dates", fields: dateSections },
    {
      key: "location",
      fields: when(offers("location_guess"), {
        title: "Location guess",
        summary: chipSummary(values.locationGuess.map(locationGuessLabel)),
        active: values.locationGuess.length > 0,
        children: (
          <ChipBucket
            options={LOCATION_GUESS_OPTIONS.map(([value, label]) => ({ id: value, name: value, label }))}
            selected={values.locationGuess}
            onToggle={(n) => toggleIn("locationGuess", n)}
          />
        ),
      }),
    },
    {
      key: "source",
      title: "Source",
      fields: [
        ...when(offers("source_kind"), {
          title: "Source kind",
          concept: "source_kind",
          summary: chipSummary(values.sourceKinds.map(sourceKindLabel)),
          active: values.sourceKinds.length > 0,
          children: (
            <ChipBucket
              options={SOURCE_KIND_OPTIONS}
              selected={values.sourceKinds}
              onToggle={(n) => toggleIn("sourceKinds", n)}
            />
          ),
        }),
        ...when(offers("level"), {
          title: "Level",
          concept: "source_level",
          summary: chipSummary(values.levels.map(levelLabel)),
          active: values.levels.length > 0,
          children: (
            <ChipBucket options={LEVEL_OPTIONS} selected={values.levels} onToggle={(n) => toggleIn("levels", n)} />
          ),
        }),
        ...when(offers("media"), {
          title: "Media",
          summary: chipSummary(values.mediaTypes.map(capitalize)),
          active: values.mediaTypes.length > 0,
          children: (
            <ChipBucket
              options={MEDIA_TYPES.map(([value, label]) => ({ id: value, name: value, label }))}
              selected={values.mediaTypes}
              onToggle={(n) => toggleIn("mediaTypes", n)}
            />
          ),
        }),
      ],
    },
    {
      key: "people",
      title: "People",
      fields: [
        ...when(offers("author"), {
          title: "Author",
          summary: author || "Any",
          active: !!author,
          children: (
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
          ),
        }),
        ...when(offers("approval"), {
          title: "Approvals",
          concept: "approval_filter",
          summary: values.approvedBy
            ? accountName(values.approvedBy)
            : values.approved
              ? "Approved"
              : "Any",
          active: values.approved || !!values.approvedBy,
          children: (
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
          ),
        }),
      ],
    },
  ];
  const rows = allRows.filter((r) => r.fields.length > 0);

  // Open state lives here, keyed by row, so a re-render never resets it and a scope change that
  // renames a merged row keeps it. Every row starts collapsed except one holding an active value,
  // so the reader sees what is applied.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.fields.some((f) => f.active)]))
  );
  const toggleRow = (key: string) => setOpenRows((o) => ({ ...o, [key]: !o[key] }));

  const renderRow = (row: FilterRow) => {
    const [only] = row.fields;
    const merged = row.fields.length > 1;
    const active = row.fields.filter((f) => f.active);
    return (
      <FilterSection
        key={row.key}
        title={merged ? rowTitle(row) : only.title}
        concept={merged ? undefined : only.concept}
        summary={merged ? active.map((f) => f.summary).join(", ") || "Any" : only.summary}
        active={active.length > 0}
        open={!!openRows[row.key]}
        onToggle={() => toggleRow(row.key)}
      >
        {merged ? (
          <div className="space-y-3">
            {row.fields.map((f) => (
              <div key={f.title} className="space-y-1.5">
                <FieldLabel label={f.title} concept={f.concept} />
                {f.children}
              </div>
            ))}
          </div>
        ) : (
          only.children
        )}
      </FilterSection>
    );
  };

  return <div className={`${CARD_FRAME} px-3`}>{rows.map(renderRow)}</div>;
}

/** One collapsible row: a lone section, or several that share it under a field label each. */
interface FilterRow {
  /** Stable across scopes, so the open state holds while the row's members change. */
  key: string;
  /** A merged row's name; without one, the row lists its members ("Conflict, tags"). */
  title?: string;
  fields: InjectedSection[];
}

const rowTitle = (row: FilterRow) =>
  row.title ?? row.fields.map((f, i) => (i ? f.title.toLowerCase() : f.title)).join(", ");
