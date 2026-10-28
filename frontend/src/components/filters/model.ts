import type { Conflict, DayCount, SearchHitType, Tag } from "@/types";
import { EVENT_STATUS_META } from "@/components/event/StatusBadge";
import type { ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { accountName, type Account } from "@/components/ui/AccountPicker";
import { conflictLabel, sortConflicts } from "@/lib/conflicts";
import type { Concept } from "@/lib/fieldHelp";
import { searchTypeLabel } from "@/lib/items";
import { showFieldScope } from "@/lib/showField";
import {
  LEVEL_LABELS,
  SOURCE_KIND_LABELS,
  SOURCE_KINDS,
  SOURCE_LEVELS,
} from "@/lib/sources";

/** The surfaces that list events behind the filter panel. */
export type Surface = "map" | "search" | "feed" | "requests";

/** One surface's whole filter state. `show` holds the statuses and the other kinds the surface
 *  lists (`site`, `collection`, `user`, `organization`); an empty `show` shows everything. An
 *  empty date edge is open. */
export interface FilterState {
  show: string[];
  conflicts: string[];
  tags: string[];
  sourceKinds: string[];
  levels: string[];
  mediaTypes: string[];
  locationGuess: string[];
  following: boolean;
  author: string;
  approved: boolean;
  approvedBy: Account | null;
  eventFrom: string;
  eventTo: string;
  addedFrom: string;
  addedTo: string;
}

export const EMPTY_FILTERS: FilterState = {
  show: [],
  conflicts: [],
  tags: [],
  sourceKinds: [],
  levels: [],
  mediaTypes: [],
  locationGuess: [],
  following: false,
  author: "",
  approved: false,
  approvedBy: null,
  eventFrom: "",
  eventTo: "",
  addedFrom: "",
  addedTo: "",
};

export type FilterPatch = (patch: Partial<FilterState>) => void;

/** The statuses the Show field offers, in the backend vocabulary's order. Mirrors backend
 *  `event_filters.STATUSES` minus `closed`; change both. */
export const FILTER_STATUSES = [
  "requested",
  "detected",
  "geolocated",
] as const;

/** The `media` values (`Media.kind`). Mirrors backend `event_filters.MEDIA_TYPES`; change both. */
const MEDIA_TYPES = [
  "image",
  "video",
] as const;

export type DimensionKey =
  | "show"
  | "conflict"
  | "tags"
  | "sourceKind"
  | "level"
  | "media"
  | "locationGuess"
  | "following"
  | "author"
  | "approved"
  | "approvedBy";

type ListField =
  | "show"
  | "conflicts"
  | "tags"
  | "sourceKinds"
  | "levels"
  | "mediaTypes"
  | "locationGuess";

/** How a dimension is edited: a list of options, a switch, or the account picker. */
export type Control =
  | { kind: "options"; field: ListField }
  | { kind: "switch"; field: "following" | "approved"; label: string }
  | { kind: "account"; field: "author" | "approvedBy" };

export interface DimensionSpec {
  name: string;
  concept?: Concept;
  control: Control;
  /** The query parameter that carries it, in the page URL and in the API. */
  param: string;
  surfaces: ReadonlyArray<Surface>;
}

const ALL: ReadonlyArray<Surface> = ["map", "search", "feed", "requests"];

/** Every dimension the panel offers, its control, the surfaces whose data can serve it, and its
 *  parameter. Show goes out as `kind` on `GET /feed`; Following goes out as `scope=all` when off. */
export const DIMENSIONS: Record<DimensionKey, DimensionSpec> = {
  show: {
    name: "Show",
    concept: "status",
    control: { kind: "options", field: "show" },
    param: "status",
    surfaces: ["map", "search", "feed"],
  },
  conflict: {
    name: "Conflict",
    concept: "conflict",
    control: { kind: "options", field: "conflicts" },
    param: "conflict",
    surfaces: ALL,
  },
  tags: {
    name: "Tags",
    control: { kind: "options", field: "tags" },
    param: "tag",
    surfaces: ALL,
  },
  sourceKind: {
    name: "Source kind",
    concept: "source_kind",
    control: { kind: "options", field: "sourceKinds" },
    param: "source_kind",
    surfaces: ALL,
  },
  level: {
    name: "Level",
    concept: "source_level",
    control: { kind: "options", field: "levels" },
    param: "level",
    surfaces: ALL,
  },
  media: {
    name: "Media",
    control: { kind: "options", field: "mediaTypes" },
    param: "media",
    surfaces: ALL,
  },
  locationGuess: {
    name: "Location guess",
    control: { kind: "options", field: "locationGuess" },
    param: "has_coords",
    surfaces: ["search", "feed", "requests"],
  },
  following: {
    name: "Following",
    control: { kind: "switch", field: "following", label: "Following" },
    param: "scope",
    surfaces: ["feed"],
  },
  author: {
    name: "Author",
    control: { kind: "account", field: "author" },
    param: "author",
    surfaces: ALL,
  },
  approved: {
    name: "Approved only",
    concept: "approval_filter",
    control: { kind: "switch", field: "approved", label: "Approved only" },
    param: "approved",
    surfaces: ["map", "search", "feed"],
  },
  approvedBy: {
    name: "Approved by",
    concept: "approval_filter",
    control: { kind: "account", field: "approvedBy" },
    param: "approved_by",
    surfaces: ["map", "search", "feed"],
  },
};

/** The panel's headings, in order, each with its dimensions in order. */
export const FILTER_GROUPS: ReadonlyArray<{ title: string; dimensions: DimensionKey[] }> = [
  { title: "What", dimensions: ["show", "conflict", "tags"] },
  { title: "Source", dimensions: ["sourceKind", "level", "media"] },
  { title: "Where", dimensions: ["locationGuess"] },
  { title: "Who", dimensions: ["following", "author", "approved", "approvedBy"] },
];

export type DateKey = "eventDate" | "added";

/** The two date timelines, which head the panel on every surface. `axis` names the histogram of
 *  `GET /search/dates` and `GET /feed/dates`. */
export const DATE_DIMENSIONS: Record<
  DateKey,
  {
    name: string;
    concept: Concept;
    from: "eventFrom" | "addedFrom";
    to: "eventTo" | "addedTo";
    params: [string, string];
    axis: "occurred_date" | "submitted";
  }
> = {
  eventDate: {
    name: "Event date",
    concept: "occurred_date",
    from: "eventFrom",
    to: "eventTo",
    params: ["occurred_date_from", "occurred_date_to"],
    axis: "occurred_date",
  },
  added: {
    name: "Added",
    concept: "added",
    from: "addedFrom",
    to: "addedTo",
    params: ["submitted_from", "submitted_to"],
    axis: "submitted",
  },
};

export const DATE_KEYS: ReadonlyArray<DateKey> = ["eventDate", "added"];

/** The heading over the two timelines, which lead the panel. */
export const DATES_HEADING = "When";

/** The kinds other than events a Show field can list. */
export const SHOW_KINDS: ReadonlyArray<Exclude<SearchHitType, "event">> = [
  "site",
  "collection",
  "user",
  "organization",
];

/** What each surface's Show field offers: the map draws no request and the feed no kind other
 *  than events. */
const SHOW_BY_SURFACE: Record<Surface, ReadonlyArray<string>> = {
  map: ["detected", "geolocated", "site"],
  search: [...FILTER_STATUSES, ...SHOW_KINDS],
  feed: FILTER_STATUSES,
  requests: [],
};

/** The dimensions each kind other than events answers, the rest leaving it out of the list.
 *  Mirrors backend `services/search._TYPE_FILTERS`; change both. */
export const KIND_DIMENSIONS: Record<
  Exclude<SearchHitType, "event">,
  ReadonlyArray<DimensionKey>
> = {
  site: ["author"],
  collection: ["tags", "author"],
  user: [],
  organization: [],
};

const isStatus = (value: string) => (FILTER_STATUSES as ReadonlyArray<string>).includes(value);

/** The statuses and the other kinds a Show pick holds. */
export function splitShow(show: string[]): {
  statuses: string[];
  kinds: Exclude<SearchHitType, "event">[];
} {
  return {
    statuses: show.filter(isStatus),
    kinds: SHOW_KINDS.filter((kind) => show.includes(kind)),
  };
}

/** Whether a Show pick lists events and whether it lists the other kinds, by the Show rule. */
export function showScope(show: string[]): { events: boolean; others: boolean } {
  const { statuses, kinds } = splitShow(show);
  return showFieldScope(statuses, kinds.length > 0);
}

/** The dimensions a surface offers for a Show pick, in panel order. On search a pick that lists
 *  no event offers only Show and what its kinds answer. */
export function offeredDimensions(surface: Surface, show: string[]): DimensionKey[] {
  const all = FILTER_GROUPS.flatMap((g) => g.dimensions).filter((key) =>
    DIMENSIONS[key].surfaces.includes(surface),
  );
  if (surface !== "search" || showScope(show).events) return all;
  const answered = new Set<DimensionKey>([
    "show",
    ...splitShow(show).kinds.flatMap((kind) => KIND_DIMENSIONS[kind]),
  ]);
  return all.filter((key) => answered.has(key));
}

/** Whether the timelines apply: every surface, and search while its pick lists events. */
export const datesOffered = (surface: Surface, show: string[]): boolean =>
  surface !== "search" || showScope(show).events;

/** The state with the values a surface no longer offers dropped, so no hidden filter narrows. */
export function scopeState(surface: Surface, state: FilterState): FilterState {
  const offered = new Set(offeredDimensions(surface, state.show));
  const next = { ...state };
  for (const key of Object.keys(DIMENSIONS) as DimensionKey[]) {
    if (offered.has(key)) continue;
    const { control } = DIMENSIONS[key];
    if (control.kind === "options") next[control.field] = [];
    else if (control.kind === "switch") next[control.field] = EMPTY_FILTERS[control.field];
    else if (control.field === "author") next.author = "";
    else next.approvedBy = null;
  }
  if (!datesOffered(surface, state.show)) {
    Object.assign(next, { eventFrom: "", eventTo: "", addedFrom: "", addedTo: "" });
  }
  return next;
}

export interface Option {
  value: string;
  label: string;
}

const LOCATION_GUESS_OPTIONS: Option[] = [
  { value: "guessed", label: "With a guess" },
  { value: "blind", label: "No guess" },
];

const MEDIA_LABELS: Record<(typeof MEDIA_TYPES)[number], string> = {
  image: "Image",
  video: "Video",
};

function showLabel(value: string): string {
  if (isStatus(value)) return EVENT_STATUS_META[value as (typeof FILTER_STATUSES)[number]].label;
  const kind = SHOW_KINDS.find((k) => k === value);
  return kind ? searchTypeLabel(kind) : value;
}

export interface Vocabulary {
  tags: Tag[];
  conflicts: Conflict[];
}

/** The options of a list dimension on a surface, in display order. */
export function dimensionOptions(
  key: DimensionKey,
  surface: Surface,
  vocabulary: Vocabulary,
): Option[] {
  switch (key) {
    case "show":
      return SHOW_BY_SURFACE[surface].map((value) => ({ value, label: showLabel(value) }));
    case "conflict":
      return sortConflicts(vocabulary.conflicts).map((c) => ({ value: c.name, label: conflictLabel(c) }));
    case "tags":
      return [...vocabulary.tags]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ value: t.name, label: t.name }));
    case "sourceKind":
      return SOURCE_KINDS.map((value) => ({ value, label: SOURCE_KIND_LABELS[value] }));
    case "level":
      return SOURCE_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value] }));
    case "media":
      return MEDIA_TYPES.map((value) => ({ value, label: MEDIA_LABELS[value] }));
    case "locationGuess":
      return LOCATION_GUESS_OPTIONS;
    default:
      return [];
  }
}

/** The `has_coords` value of a Location guess pick: unset when none or both are picked, since
 *  either way every row matches. */
export function hasCoordsFilter(locationGuess: ReadonlyArray<string>): boolean | undefined {
  if (locationGuess.length !== 1) return undefined;
  return locationGuess[0] === "guessed";
}

/** The Location guess pick a `has_coords` value names. */
export const locationGuessOf = (hasCoords: string | null): string[] =>
  hasCoords === "true" ? ["guessed"] : hasCoords === "false" ? ["blind"] : [];

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** A date window in words: "From 1 Jan 2024", "Until 1 Jan 2025" or "1 Jan 2024 to 1 Jan 2025". */
export function rangeSummary(from: string, to: string): string {
  if (from && to) return `${fmtDay(from)} to ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  return `Until ${fmtDay(to)}`;
}

/** The value a dimension holds, as removable pills: one per picked option in the options' order,
 *  one for a switch that is on (its label alone) and one for an account. */
export function dimensionPills(
  key: DimensionKey,
  surface: Surface,
  state: FilterState,
  vocabulary: Vocabulary,
  onPatch: FilterPatch,
): ActiveFilter[] {
  const { name, control } = DIMENSIONS[key];
  if (control.kind === "options") {
    const options = dimensionOptions(key, surface, vocabulary);
    const values = state[control.field];
    const rank = (value: string) => {
      const at = options.findIndex((o) => o.value === value);
      return at === -1 ? options.length : at;
    };
    return [...values].sort((a, b) => rank(a) - rank(b)).map((value) => ({
      key: `${key}:${value}`,
      filter: name,
      label: options.find((o) => o.value === value)?.label ?? value,
      onRemove: () => onPatch({ [control.field]: values.filter((v) => v !== value) }),
    }));
  }
  if (control.kind === "switch") {
    return state[control.field]
      ? [{ key, label: control.label, onRemove: () => onPatch({ [control.field]: false }) }]
      : [];
  }
  if (control.field === "author") {
    const author = state.author.trim();
    return author
      ? [{ key, filter: name, label: author, onRemove: () => onPatch({ author: "" }) }]
      : [];
  }
  return state.approvedBy
    ? [{ key, filter: name, label: accountName(state.approvedBy), onRemove: () => onPatch({ approvedBy: null }) }]
    : [];
}

/** A date window as a removable pill, or none while the window is open at both edges. */
export function datePill(key: DateKey, state: FilterState, onPatch: FilterPatch): ActiveFilter[] {
  const { name, from, to } = DATE_DIMENSIONS[key];
  if (!state[from] && !state[to]) return [];
  return [
    {
      key,
      filter: name,
      label: rangeSummary(state[from], state[to]),
      onRemove: () => onPatch({ [from]: "", [to]: "" }),
    },
  ];
}

/** Every active filter a surface offers as a removable pill: the dates first, then the
 *  dimensions in panel order. */
export function activePills(
  surface: Surface,
  state: FilterState,
  vocabulary: Vocabulary,
  onPatch: FilterPatch,
): ActiveFilter[] {
  return [
    ...(datesOffered(surface, state.show) ? DATE_KEYS.flatMap((k) => datePill(k, state, onPatch)) : []),
    ...offeredDimensions(surface, state.show).flatMap((k) =>
      dimensionPills(k, surface, state, vocabulary, onPatch),
    ),
  ];
}

/** Whether any filter a surface offers narrows the view. */
export function anyActive(surface: Surface, state: FilterState): boolean {
  return activePills(surface, state, { tags: [], conflicts: [] }, () => {}).length > 0;
}

/** True when an ISO day sits in the window; an unknown day or an open edge never excludes. */
export function inWindow(day: string | null, from: string, to: string): boolean {
  return !day || ((!from || day >= from) && (!to || day <= to));
}

/** The rows per day of a list of ISO days, ascending; an unknown day is left out. */
export function dayCounts(days: ReadonlyArray<string | null>): DayCount[] {
  const counts = new Map<string, number>();
  for (const day of days) if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, count]) => ({ date, count }));
}
