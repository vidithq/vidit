import type { DayCount, SearchHitType } from "@/types";
import type { Account } from "@/lib/accounts";
import type { Concept } from "@/lib/fieldHelp";
import { showFieldScope } from "@/lib/showField";

// The filter vocabulary, its rules and its parameters. `labels.ts` names the values and builds the
// pills; this module imports no label so `lib/search` can read it without an import cycle.

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
export const MEDIA_TYPES = [
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

/** How a dimension is edited: a list of options, a switch, or the account picker. A `search`
 *  list takes its search field on its line; the others open a chip editor. */
export type Control =
  | { kind: "options"; field: ListField; search?: true }
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
 *  parameter. Show goes out as `kind` on `GET /feed`; Following goes out as `scope=all` when off.
 *  The surfaces mirror backend `routers/_filters.event_filters`; change both. */
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
    control: { kind: "options", field: "conflicts", search: true },
    param: "conflict",
    surfaces: ALL,
  },
  tags: {
    name: "Tags",
    control: { kind: "options", field: "tags", search: true },
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

export interface FilterGroup {
  title: string;
  dimensions: DimensionKey[];
  /** The group holds the two date timelines. */
  dates?: true;
}

/** The panel's headings, in order, each with its dimensions in order. */
export const FILTER_GROUPS: ReadonlyArray<FilterGroup> = [
  { title: "What", dimensions: ["show", "conflict", "tags"] },
  { title: "When", dimensions: [], dates: true },
  { title: "Source", dimensions: ["sourceKind", "level", "media"] },
  { title: "Where", dimensions: ["locationGuess"] },
  { title: "Who", dimensions: ["following", "author", "approved", "approvedBy"] },
];

export type DateKey = "eventDate" | "added";

/** The two date timelines, under the When heading on every surface. `axis` names the histogram of
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

/** The kinds other than events a Show field can list. */
export const SHOW_KINDS: ReadonlyArray<Exclude<SearchHitType, "event">> = [
  "site",
  "collection",
  "user",
  "organization",
];

/** What each surface's Show field offers: the map draws no request and the feed no kind other
 *  than events. */
export const SHOW_BY_SURFACE: Record<Surface, ReadonlyArray<string>> = {
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

export const isStatus = (value: string) => (FILTER_STATUSES as ReadonlyArray<string>).includes(value);

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

/** The `has_coords` value of a Location guess pick: unset when none or both are picked, since
 *  either way every row matches. */
export function hasCoordsFilter(locationGuess: ReadonlyArray<string>): boolean | undefined {
  if (locationGuess.length !== 1) return undefined;
  return locationGuess[0] === "guessed";
}

/** The Location guess pick a `has_coords` value names. */
export const locationGuessOf = (hasCoords: string | null): string[] =>
  hasCoords === "true" ? ["guessed"] : hasCoords === "false" ? ["blind"] : [];

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

/** Whether a dimension holds a value. */
function dimensionActive(key: DimensionKey, state: FilterState): boolean {
  const { control } = DIMENSIONS[key];
  if (control.kind === "options") return state[control.field].length > 0;
  if (control.kind === "switch") return state[control.field];
  return control.field === "author" ? state.author.trim() !== "" : state.approvedBy !== null;
}

/** Whether a date window is closed at either edge. */
const dateActive = (key: DateKey, state: FilterState): boolean =>
  !!(state[DATE_DIMENSIONS[key].from] || state[DATE_DIMENSIONS[key].to]);

/** Whether any filter a surface offers narrows the view. */
export function anyActive(surface: Surface, state: FilterState): boolean {
  return (
    (datesOffered(surface, state.show) && DATE_KEYS.some((key) => dateActive(key, state))) ||
    offeredDimensions(surface, state.show).some((key) => dimensionActive(key, state))
  );
}
