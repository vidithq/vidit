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
 * feed: one component owns the order, so a vocabulary change lands on all four. It opens on the
 * surface's `lead` fields, then Show, Conflict and Tags, each under its own label and always in
 * view. Collapsible rows follow: Dates of the surface's `dateSections`, Location guess, a Source
 * row of Source kind, Level and Media, and a People row of Author and Approvals. Sections that
 * share a row show as fields under one header; a row left with one section shows it as its own
 * row. Surfaces differ in `lead`, `layer`, `dateSections` and `sections`, the subset they offer
 * (the search page's Collections group is narrowed by `tags` and `author` alone, and only the
 * board offers Location guess).
 *
 * State stays surface-owned: this component takes one `values` object and emits patches.
 * `buildActiveFilterPills` derives the matching pill entries from the same shape so the
 * renderings can't drift.
 */

/** The common event filter values (the server vocabulary minus the surface-specific date windows). */
export interface EventFilterValues extends ApprovalFilters {
  /** The Show filter: the event statuses to list. */
  show: string[];
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
  show: [],
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
  | "show"
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
  "show",
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

/** One field at the head of the panel, always in view under its label. */
interface PanelField {
  title: string;
  concept?: Concept;
  children: ReactNode;
}

/** One filter in a collapsible row: its own row, or one field of a merged row. A surface passes
 * its date controls in the same shape. */
interface InjectedSection extends PanelField {
  summary: string;
  active: boolean;
}

/** A map layer offered as one more Show chip after the status chips (`showFieldScope`). */
interface FilterLayer {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

/** What the Show field leaves on the map. With no chip selected, every event and the layer show;
 * once a chip is selected, only what the selected chips name. */
export function showFieldScope(
  show: string[],
  layerSelected: boolean,
): { events: boolean; layer: boolean } {
  const none = show.length === 0 && !layerSelected;
  return { events: none || show.length > 0, layer: none || layerSelected };
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
const MEDIA_LABELS: Record<string, string> = Object.fromEntries(MEDIA_TYPES);
const mediaLabel = (value: string) => MEDIA_LABELS[value] ?? value;

/** The lifecycle statuses this panel offers (Event.status values), in the backend vocabulary's
 * order. Hand-kept mirror of `event_filters.STATUSES` (see AGENTS.md): every status but `closed`,
 * whose retracted rows carry their own surfaces and which the chip could only empty. A search
 * reaches requested rows (the profile's open-requests block links into them). */
const FILTER_STATUSES = [
  "requested",
  "detected",
  "geolocated",
] as const;

/** The Show filter's options, each labelled like the status badge (`EVENT_STATUS_META`).
 *  Exported so the search page can gate crafted-URL values to the same vocabulary. */
export const SHOW_OPTIONS: ReadonlyArray<[string, string]> = FILTER_STATUSES.map(
  (status) => [status, EVENT_STATUS_META[status].label],
);

// Value to chip label, shared by the pill row and the section summary.
const SHOW_LABELS: Record<string, string> = Object.fromEntries(SHOW_OPTIONS);
const showLabel = (value: string) => SHOW_LABELS[value] ?? value;

const APPROVED_ONLY = "approved";
const APPROVED_ONLY_LABEL = "Approved only";

/** Every filter's name, shared by its field label and its active-filter pill, so a pill says
 *  which filter it removes. */
export const FILTER_NAMES = {
  show: "Show",
  conflict: "Conflict",
  tags: "Tags",
  eventDate: "Event date",
  added: "Added",
  locationGuess: "Location guess",
  sourceKind: "Source kind",
  level: "Level",
  media: "Media",
  author: "Author",
  approvals: "Approvals",
  approvedBy: "Approved by",
} as const;

/** The key of the author pill `buildActiveFilterPills` emits. The filter rail leaves that pill
 *  out: the Author section already names the analyst, in its summary and its picker. */
export const AUTHOR_PILL_KEY = "author";

type ListFilter =
  | "show"
  | "conflicts"
  | "tags"
  | "locationGuess"
  | "sourceKinds"
  | "levels"
  | "mediaTypes";

/** The removable-pill entries for the common values, one per value, each named by its filter and
 *  reading as its chip does; surfaces append their date-window entries. */
export function buildActiveFilterPills(
  values: EventFilterValues,
  onPatch: EventFilterPatch
): ActiveFilter[] {
  const each = (
    key: ListFilter,
    filter: string,
    label: (value: string) => string = (value) => value,
  ): ActiveFilter[] =>
    values[key].map((n) => ({
      key: `${key}:${n}`,
      filter,
      label: label(n),
      onRemove: () => onPatch({ [key]: values[key].filter((v) => v !== n) }),
    }));
  const author = values.author.trim();
  return [
    ...each("show", FILTER_NAMES.show, showLabel),
    ...each("conflicts", FILTER_NAMES.conflict),
    ...each("tags", FILTER_NAMES.tags),
    ...each("locationGuess", FILTER_NAMES.locationGuess, locationGuessLabel),
    ...each("sourceKinds", FILTER_NAMES.sourceKind, sourceKindLabel),
    ...each("levels", FILTER_NAMES.level, levelLabel),
    ...each("mediaTypes", FILTER_NAMES.media, mediaLabel),
    ...(author
      ? [
          {
            key: AUTHOR_PILL_KEY,
            filter: FILTER_NAMES.author,
            label: author,
            onRemove: () => onPatch({ author: "" }),
          },
        ]
      : []),
    ...(values.approved
      ? [
          {
            key: "approved",
            filter: FILTER_NAMES.approvals,
            label: APPROVED_ONLY_LABEL,
            onRemove: () => onPatch({ approved: false }),
          },
        ]
      : []),
    ...(values.approvedBy
      ? [
          {
            key: "approved-by",
            filter: FILTER_NAMES.approvedBy,
            label: accountName(values.approvedBy),
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
            filter: FILTER_NAMES.eventDate,
            label: rangeSummary(windows.eventFrom, windows.eventTo),
            onRemove: onClearEvent,
          },
        ]
      : []),
    ...(addedWindowActive(windows)
      ? [
          {
            key: "added-window",
            filter: FILTER_NAMES.added,
            label: rangeSummary(windows.addedFrom, windows.addedTo),
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
    values.show.length +
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
  /** Surface-specific fields above the shared ones (the feed's scope). */
  lead?: PanelField[];
  /** A layer chip after the status chips (the map's Sites). */
  layer?: FilterLayer;
  /** The surface's date windows, merged into the Dates row. */
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

  const toggleIn = (key: ListFilter, name: string) => {
    const bucket = values[key];
    onPatch({
      [key]: bucket.includes(name) ? bucket.filter((n) => n !== name) : [...bucket, name],
    });
  };

  const sortedTags = [...tags].sort((a: Tag, b: Tag) => a.name.localeCompare(b.name));
  function when(offered: boolean, field: InjectedSection): InjectedSection[];
  function when(offered: boolean, field: PanelField): PanelField[];
  function when(offered: boolean, field: PanelField) {
    return offered ? [field] : [];
  }

  const headFields: PanelField[] = [
    ...lead,
    ...when(offers("show"), {
      title: FILTER_NAMES.show,
      concept: "status",
      children: (
        <ChipBucket
          options={[
            ...SHOW_OPTIONS.map(([value, label]) => ({ id: value, name: value, label })),
            ...(layer ? [{ id: LAYER_CHIP, name: LAYER_CHIP, label: layer.label }] : []),
          ]}
          selected={[...values.show, ...(layer?.selected ? [LAYER_CHIP] : [])]}
          onToggle={(n) => (n === LAYER_CHIP ? layer?.onToggle() : toggleIn("show", n))}
        />
      ),
    }),
    ...when(offers("conflict") && conflicts.length > 0, {
      title: FILTER_NAMES.conflict,
      concept: "conflict",
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
      title: FILTER_NAMES.tags,
      children: (
        <TagChips
          filter
          tags={sortedTags}
          selected={values.tags}
          setSelected={(next) => onPatch({ tags: next })}
        />
      ),
    }),
  ];

  const allRows: FilterRow[] = [
    { key: "dates", title: "Dates", fields: dateSections },
    {
      key: "location",
      title: FILTER_NAMES.locationGuess,
      fields: when(offers("location_guess"), {
        title: FILTER_NAMES.locationGuess,
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
          title: FILTER_NAMES.sourceKind,
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
          title: FILTER_NAMES.level,
          concept: "source_level",
          summary: chipSummary(values.levels.map(levelLabel)),
          active: values.levels.length > 0,
          children: (
            <ChipBucket options={LEVEL_OPTIONS} selected={values.levels} onToggle={(n) => toggleIn("levels", n)} />
          ),
        }),
        ...when(offers("media"), {
          title: FILTER_NAMES.media,
          summary: chipSummary(values.mediaTypes.map(mediaLabel)),
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
          title: FILTER_NAMES.author,
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
          title: FILTER_NAMES.approvals,
          concept: "approval_filter",
          summary: values.approvedBy
            ? accountName(values.approvedBy)
            : values.approved
              ? APPROVED_ONLY_LABEL
              : "Any",
          active: values.approved || !!values.approvedBy,
          children: (
            <div className="space-y-2">
              <ChipBucket
                options={[{ id: APPROVED_ONLY, name: APPROVED_ONLY, label: APPROVED_ONLY_LABEL }]}
                selected={values.approved ? [APPROVED_ONLY] : []}
                onToggle={() => onPatch({ approved: !values.approved })}
              />
              <label htmlFor={approvedById} className={FORM_LABEL}>
                {FILTER_NAMES.approvedBy}
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

  const renderField = (f: PanelField) => (
    <div key={f.title} className="space-y-1.5">
      <FieldLabel label={f.title} concept={f.concept} />
      {f.children}
    </div>
  );

  const renderRow = (row: FilterRow) => {
    const [only] = row.fields;
    const merged = row.fields.length > 1;
    const active = row.fields.filter((f) => f.active);
    return (
      <FilterSection
        key={row.key}
        title={merged ? row.title : only.title}
        concept={merged ? undefined : only.concept}
        summary={merged ? active.map((f) => f.summary).join(", ") || "Any" : only.summary}
        active={active.length > 0}
        open={!!openRows[row.key]}
        onToggle={() => toggleRow(row.key)}
      >
        {merged ? <div className="space-y-3">{row.fields.map(renderField)}</div> : only.children}
      </FilterSection>
    );
  };

  return (
    <div className={`${CARD_FRAME} px-3`}>
      {headFields.length > 0 && (
        <div className="space-y-3 border-b border-neutral-800 py-3 last:border-b-0">
          {headFields.map(renderField)}
        </div>
      )}
      {rows.map(renderRow)}
    </div>
  );
}

/** One collapsible row: a lone section under its own title, or several under the row's title,
 *  each under its field label. */
interface FilterRow {
  /** Stable across scopes, so the open state holds while the row's members change. */
  key: string;
  title: string;
  fields: InjectedSection[];
}
