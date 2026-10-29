import type { Conflict, Tag } from "@/types";
import { EVENT_STATUS_META } from "@/components/event/StatusBadge";
import type { ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { accountName } from "@/lib/accounts";
import type { Option } from "@/components/ui/OptionSearch";
import { conflictLabel, sortConflicts } from "@/lib/conflicts";
import { searchTypeLabel } from "@/lib/items";
import {
  LEVEL_LABELS,
  SOURCE_KIND_LABELS,
  SOURCE_KINDS,
  SOURCE_LEVELS,
} from "@/lib/sources";
import {
  DATE_DIMENSIONS,
  DATE_KEYS,
  DIMENSIONS,
  FILTER_GROUPS,
  FILTER_STATUSES,
  MEDIA_TYPES,
  SHOW_BY_SURFACE,
  SHOW_KINDS,
  datesOffered,
  isStatus,
  offeredDimensions,
  type DateKey,
  type DimensionKey,
  type FilterGroup,
  type FilterPatch,
  type FilterState,
  type Surface,
} from "./model";

// The words of the filter model: each value's label, and the removable pill of each active filter.

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

/** A group's active filters a surface offers, as removable pills in panel order. */
export function groupPills(
  group: FilterGroup,
  surface: Surface,
  state: FilterState,
  vocabulary: Vocabulary,
  onPatch: FilterPatch,
): ActiveFilter[] {
  const offered = offeredDimensions(surface, state.show);
  return [
    ...(group.dates && datesOffered(surface, state.show)
      ? DATE_KEYS.flatMap((k) => datePill(k, state, onPatch))
      : []),
    ...group.dimensions
      .filter((k) => offered.includes(k))
      .flatMap((k) => dimensionPills(k, surface, state, vocabulary, onPatch)),
  ];
}

/** Every active filter a surface offers as a removable pill, in panel order. */
export function activePills(
  surface: Surface,
  state: FilterState,
  vocabulary: Vocabulary,
  onPatch: FilterPatch,
): ActiveFilter[] {
  return FILTER_GROUPS.flatMap((g) => groupPills(g, surface, state, vocabulary, onPatch));
}
