import type { Account } from "@/components/ui/AccountPicker";
import {
  DATE_DIMENSIONS,
  DATE_KEYS,
  DIMENSIONS,
  FILTER_STATUSES,
  SHOW_KINDS,
  hasCoordsFilter,
  locationGuessOf,
  showScope,
  splitShow,
  type DimensionKey,
  type FilterState,
} from "@/components/filters/model";
import { apiFetch } from "./api";
import type { components } from "./api-types";
import type {
  SearchHit,
  SearchHitType,
  SearchOrganizationHit,
  SearchResponse,
  SearchSections,
  SearchUserHit,
} from "@/types";

type SearchOptions = { q: string; types?: SearchHitType[] } & EventFilterParams;

function searchQuery(opts: SearchOptions, extra: Record<string, string>): string {
  const params = new URLSearchParams({ q: opts.q, ...extra });
  appendSearchTypes(params, opts.types ?? []);
  appendEventFilterParams(params, { ...opts, show: splitShow(opts.show ?? []).statuses });
  return params.toString();
}

/** `GET /search`: one ranked list. Debouncing is the caller's job; the endpoint short-circuits
 *  empty queries. `types` picks the hit types (every type when empty), `show` narrows the events
 *  to those statuses, and the other filters follow the rule `docs/api.md` states. With an empty
 *  `q` and any filter the backend browses the filtered view (the profile's "See all").
 *  `cursor` is a response's `cursor`, sent with the options that minted it. */
export function search(
  opts: SearchOptions & { limit?: number; cursor?: string },
): Promise<SearchResponse> {
  const extra: Record<string, string> = { limit: String(opts.limit ?? 20) };
  if (opts.cursor) extra.cursor = opts.cursor;
  return apiFetch<SearchResponse>(`/search?${searchQuery(opts, extra)}`);
}

/** `GET /search/sections`: the top hits of each type, with the options of `search`. A section's
 *  `cursor` continues its type's list through `search`. */
export function searchSections(opts: SearchOptions): Promise<SearchSections> {
  return apiFetch<SearchSections>(`/search/sections?${searchQuery(opts, {})}`);
}

/** The path of `GET /search/dates`: the events `search` would list for the same options, counted
 *  per day on each date axis, each axis ignoring its own window. */
export function searchDatesPath(opts: SearchOptions): string {
  return `/search/dates?${searchQuery(opts, {})}`;
}

/** The hit types a Show pick lists, by the Show field's one rule (`showScope`). Every type shows
 *  while no chip is selected, which `GET /search` reads as no `type` sent. */
export function searchTypes(show: string[]): SearchHitType[] {
  const { statuses, kinds } = splitShow(show);
  const scope = showScope(show);
  if (scope.events && scope.others) return statuses.length > 0 ? ["event", ...kinds] : [];
  return scope.events ? ["event"] : kinds;
}

function appendSearchTypes(params: URLSearchParams, types: SearchHitType[]): void {
  for (const type of types) params.append("type", type);
}

/** The search page's URL for a query and its filters: the `GET /search` vocabulary, so a
 *  profile link and the page read one format. */
export function searchPageParams(q: string, filters: EventFilterParams): URLSearchParams {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const show = filters.show ?? [];
  appendSearchTypes(params, searchTypes(show));
  appendEventFilterParams(params, { ...filters, show: splitShow(show).statuses });
  return params;
}

/** The Show pick a URL names: the statuses of its `status` values and the kinds of its `type`
 *  values, both gated to the chips' vocabulary. A `type=event` with no status names every
 *  status. */
export function readShowPick(params: { getAll(name: string): string[] }): string[] {
  const types = params.getAll("type");
  const named = params.getAll("status").filter((s) => (FILTER_STATUSES as ReadonlyArray<string>).includes(s));
  const statuses = named.length === 0 && types.includes("event") ? [...FILTER_STATUSES] : named;
  return [...statuses, ...SHOW_KINDS.filter((kind) => types.includes(kind))];
}

/** The filter values a request or a URL carries: the panel's state less the feed's Following. */
export type EventFilterParams = Partial<Omit<FilterState, "following">>;

const LIST_PARAMS: ReadonlyArray<[keyof EventFilterParams & string, DimensionKey]> = [
  ["show", "show"],
  ["conflicts", "conflict"],
  ["sourceKinds", "sourceKind"],
  ["levels", "level"],
  ["tags", "tags"],
  ["mediaTypes", "media"],
];

/** The filter set under its wire names (`DIMENSIONS`), the one mapping the query string and a
 *  JSON body (`SearchMatch.filters`, `lib/collections.ts`) both read. A list is any-match within
 *  itself and AND across lists. An author the `AUTHOR_FILTER_RE` gate refuses is dropped rather
 *  than sent to a 422. */
export function eventFilterFields(
  f: EventFilterParams,
): Record<string, string[] | string | boolean> {
  const fields: Record<string, string[] | string | boolean> = {};
  for (const [field, key] of LIST_PARAMS) {
    const values = f[field] as string[] | undefined;
    if (values?.length) fields[DIMENSIONS[key].param] = values;
  }
  const author = f.author?.trim();
  if (author && AUTHOR_FILTER_RE.test(author)) fields[DIMENSIONS.author.param] = author;
  const hasCoords = hasCoordsFilter(f.locationGuess ?? []);
  if (hasCoords !== undefined) fields[DIMENSIONS.locationGuess.param] = hasCoords;
  if (f.approved) fields[DIMENSIONS.approved.param] = true;
  const by = f.approvedBy;
  if (by?.kind === "analyst") fields[DIMENSIONS.approvedBy.param] = by.username;
  else if (by) fields.approved_by_org = by.slug;
  for (const key of DATE_KEYS) {
    const { from, to, params } = DATE_DIMENSIONS[key];
    if (f[from]) fields[params[0]] = f[from];
    if (f[to]) fields[params[1]] = f[to];
  }
  return fields;
}

export function appendEventFilterParams(params: URLSearchParams, f: EventFilterParams): void {
  for (const [key, value] of Object.entries(eventFilterFields(f))) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, String(value));
  }
}

/** The filter values a URL names, `show` holding its statuses. A name the `AUTHOR_FILTER_RE`
 *  gate refuses is dropped, so a crafted URL cannot 422 every fetch, and an organization read
 *  from a slug carries the slug as its name. */
export function readEventFilterParams(params: {
  get(name: string): string | null;
  getAll(name: string): string[];
}): Required<EventFilterParams> {
  const author = params.get(DIMENSIONS.author.param) ?? "";
  const username = params.get(DIMENSIONS.approvedBy.param) ?? "";
  const slug = params.get("approved_by_org") ?? "";
  let approvedBy: Account | null = null;
  if (AUTHOR_FILTER_RE.test(username)) approvedBy = { kind: "analyst", username };
  else if (AUTHOR_FILTER_RE.test(slug)) approvedBy = { kind: "organization", slug, name: slug };
  const list = (key: DimensionKey) => params.getAll(DIMENSIONS[key].param);
  const date = (name: string) => params.get(name) ?? "";
  return {
    show: list("show"),
    conflicts: list("conflict"),
    sourceKinds: list("sourceKind"),
    levels: list("level"),
    tags: list("tags"),
    mediaTypes: list("media"),
    locationGuess: locationGuessOf(params.get(DIMENSIONS.locationGuess.param)),
    author: AUTHOR_FILTER_RE.test(author) ? author : "",
    approved: params.get(DIMENSIONS.approved.param) === "true",
    approvedBy,
    eventFrom: date(DATE_DIMENSIONS.eventDate.params[0]),
    eventTo: date(DATE_DIMENSIONS.eventDate.params[1]),
    addedFrom: date(DATE_DIMENSIONS.added.params[0]),
    addedTo: date(DATE_DIMENSIONS.added.params[1]),
  };
}

// Per group: the picker shows a short list, the rest is a longer query away.
const APPROVER_SUGGESTIONS = 5;

/** Analysts and organizations for the Approved by filter, through the `user` and `organization`
 *  types of `GET /search`, a short list of each. */
export async function suggestApprovers(q: string): Promise<Account[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const [users, organizations] = await Promise.all([
    search({ q: trimmed, types: ["user"], limit: APPROVER_SUGGESTIONS }),
    search({ q: trimmed, types: ["organization"], limit: APPROVER_SUGGESTIONS }),
  ]);
  return [
    ...hitsOf(users.hits, "user").map((u): Account => ({
      kind: "analyst",
      username: u.username,
      avatar_url: u.avatar_url,
    })),
    ...hitsOf(organizations.hits, "organization").map((o): Account => ({
      kind: "organization",
      slug: o.slug,
      name: o.name,
      avatar_url: o.avatar_url,
    })),
  ];
}

/** The hits of one type, typed as such. */
export function hitsOf<T extends SearchHitType>(
  hits: SearchHit[],
  type: T,
): Extract<SearchHit, { type: T }>[] {
  return hits.filter((hit): hit is Extract<SearchHit, { type: T }> => hit.type === type);
}

/** A `/search` URL scoped to one analyst: the profile's one entry into the filtered catalogue
 *  (Insights tiles, *See all* links). `author` is an exact username match
 *  (`services/event_filters.apply_author_filter`). `type` defaults to the analyst's events;
 *  `collection` lists the analyst's shelf, which `author` narrows to the collections they own.
 *  `filters` takes the search page's URL vocabulary, one value per key. */
export function profileSearchHref(
  username: string,
  filters: Record<string, string> = {},
  type: SearchHitType = "event",
): string {
  const params = new URLSearchParams({ type, author: username });
  for (const [key, value] of Object.entries(filters)) params.set(key, value);
  return `/search?${params.toString()}`;
}

/** Mirrors `AUTHOR_FILTER_PATTERN` (`services/event_filters.py`); change both. Anything else
 *  would 422. */
export const AUTHOR_FILTER_RE = /^[A-Za-z0-9_-]{1,50}$/;

/** Username typeahead for the exact-match author filter and the co-geolocator invite:
 *  `GET /search/authors` (prefix matches first). A query the `?author=` gate refuses suggests
 *  nothing instead of a 422. */
export async function suggestAuthors(q: string): Promise<Account[]> {
  const trimmed = q.trim();
  if (!AUTHOR_FILTER_RE.test(trimmed)) return [];
  const params = new URLSearchParams({ q: trimmed });
  const res = await apiFetch<components["schemas"]["AuthorSuggestions"]>(`/search/authors?${params.toString()}`);
  return res.authors.map((username) => ({ kind: "analyst", username }));
}

/** The analyst or organization a query names exactly, among a response's hits: a username
 *  (case and a leading `@` ignored), or an organization's slug or name (case ignored). An analyst
 *  wins over an organization of the same name. */
export function exactProfile(
  q: string,
  hits: SearchHit[],
):
  | { kind: "analyst"; hit: SearchUserHit }
  | { kind: "organization"; hit: SearchOrganizationHit }
  | null {
  const named = q.trim().replace(/^@/, "").toLowerCase();
  if (!named) return null;
  const analyst = hitsOf(hits, "user").find((u) => u.username.toLowerCase() === named);
  if (analyst) return { kind: "analyst", hit: analyst };
  const organization = hitsOf(hits, "organization").find(
    (o) => o.slug === named || o.name.toLowerCase() === named,
  );
  return organization ? { kind: "organization", hit: organization } : null;
}

/** Split a sentinel-wrapped highlight string into alternating text and mark segments. The
 *  backend (`services/search.py`) wraps matches in STX / ETX (U+0002 / U+0003), control bytes
 *  absent from user text, and strips them from the source first, so a user can't plant
 *  markers to corrupt parity. Well-formed pairs make the even/odd split safe, and no HTML
 *  crosses the API boundary (XSS-safe). */
export function splitHighlights(s: string): Array<{
  text: string;
  highlighted: boolean;
}> {
  // STX flips parity to highlighted, ETX flips it back. Empty segments are kept so parity holds.
  const parts = s.split(/[]/);
  return parts.map((text, i) => ({ text, highlighted: i % 2 === 1 }));
}
