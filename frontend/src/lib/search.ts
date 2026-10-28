import type { Account } from "@/components/ui/AccountPicker";
import { apiFetch } from "./api";
import type { components } from "./api-types";
import type {
  SearchHit,
  SearchHitType,
  SearchOrganizationHit,
  SearchResponse,
  SearchUserHit,
} from "@/types";

/** `GET /search`: one ranked list. Debouncing is the caller's job; the endpoint short-circuits
 *  empty queries. `types` picks the hit types (every type when empty), `show` narrows the events
 *  to those statuses, and the other filters follow the rule `docs/api.md` states. With an empty
 *  `q` and any filter the backend browses the filtered view (the profile's "Show more").
 *  `cursor` is a response's `cursor`, sent with the options that minted it. */
export function search(
  opts: { q: string; types?: SearchHitType[]; limit?: number; cursor?: string } & EventFilterParams,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: opts.q, limit: String(opts.limit ?? 20) });
  appendSearchTypes(params, opts.types ?? []);
  if (opts.cursor) params.set("cursor", opts.cursor);
  appendEventFilterParams(params, opts);
  return apiFetch<SearchResponse>(`/search?${params.toString()}`);
}

/** The Show chips that name a type other than events, after the status chips, with their labels. */
export const SEARCH_KIND_OPTIONS: ReadonlyArray<[SearchHitType, string]> = [
  ["site", "Sites"],
  ["collection", "Collections"],
  ["user", "Analysts"],
  ["organization", "Organizations"],
];

/** The filter sections each kind answers, the rest leaving it out of the list. Mirrors backend
 *  `services/search._TYPE_FILTERS`; change both. */
export const SEARCH_KIND_SECTIONS: Record<
  Exclude<SearchHitType, "event">,
  ReadonlyArray<"tags" | "author">
> = {
  site: ["author"],
  collection: ["tags", "author"],
  user: [],
  organization: [],
};

/** The hit types a Show pick lists, the map's Show rule: with no chip selected every type (none
 *  sent), otherwise only what the selected chips name, events while a status chip is selected. */
export function searchTypes(statuses: string[], kinds: SearchHitType[]): SearchHitType[] {
  if (statuses.length === 0 && kinds.length === 0) return [];
  return [...(statuses.length > 0 ? (["event"] as const) : []), ...kinds];
}

function appendSearchTypes(params: URLSearchParams, types: SearchHitType[]): void {
  for (const type of types) params.append("type", type);
}

/** The search page's URL for a query, its Show pick and its filters: the `GET /search`
 *  vocabulary, so a profile link and the page read one format. */
export function searchPageParams(
  q: string,
  kinds: SearchHitType[],
  filters: EventFilterParams,
): URLSearchParams {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  appendSearchTypes(params, searchTypes(filters.show ?? [], kinds));
  appendEventFilterParams(params, filters);
  return params;
}

/** The Show pick a URL names: the kinds of its `type` values and the statuses of its `status`
 *  values, both gated to the chips' vocabulary. A `type=event` with no status names every
 *  status. */
export function readShowPick(
  params: { getAll(name: string): string[] },
  statusOptions: ReadonlyArray<string>,
): { statuses: string[]; kinds: SearchHitType[] } {
  const types = params.getAll("type");
  const named = params.getAll("status").filter((s) => statusOptions.includes(s));
  const kinds = SEARCH_KIND_OPTIONS.map(([kind]) => kind).filter((kind) => types.includes(kind));
  const statuses = named.length === 0 && types.includes("event") ? [...statusOptions] : named;
  return { statuses, kinds };
}

/** The approval filter values: `approved`, and the account `approvedBy` names. */
export interface ApprovalFilters {
  approved: boolean;
  approvedBy: Account | null;
}

/** The date fields share the `DateWindows` names, so a surface spreads its windows in. */
export interface EventFilterParams extends Partial<ApprovalFilters> {
  /** The Show filter, sent as `status`. */
  show?: string[];
  conflicts?: string[];
  sourceKinds?: string[];
  levels?: string[];
  tags?: string[];
  mediaTypes?: string[];
  author?: string;
  hasCoords?: boolean;
  eventFrom?: string;
  eventTo?: string;
  addedFrom?: string;
  addedTo?: string;
}

/** The filter set under its wire names, the one mapping the query string and a JSON body
 *  (`SearchMatch.filters`, `lib/collections.ts`) both read. A list is any-match within itself
 *  and AND across lists. An author the `AUTHOR_FILTER_RE` gate refuses is dropped rather than
 *  sent to a 422. */
export function eventFilterFields(
  f: EventFilterParams,
): Record<string, string[] | string | boolean> {
  const fields: Record<string, string[] | string | boolean> = {};
  const lists: Array<[string, string[] | undefined]> = [
    ["status", f.show],
    ["conflict", f.conflicts],
    ["source_kind", f.sourceKinds],
    ["level", f.levels],
    ["tag", f.tags],
    ["media", f.mediaTypes],
  ];
  for (const [key, values] of lists) if (values?.length) fields[key] = values;
  const author = f.author?.trim();
  if (author && AUTHOR_FILTER_RE.test(author)) fields.author = author;
  if (f.hasCoords !== undefined) fields.has_coords = f.hasCoords;
  if (f.approved) fields.approved = true;
  const by = f.approvedBy;
  if (by?.kind === "analyst") fields.approved_by = by.username;
  else if (by) fields.approved_by_org = by.slug;
  if (f.eventFrom) fields.occurred_date_from = f.eventFrom;
  if (f.eventTo) fields.occurred_date_to = f.eventTo;
  if (f.addedFrom) fields.submitted_from = f.addedFrom;
  if (f.addedTo) fields.submitted_to = f.addedTo;
  return fields;
}

export function appendEventFilterParams(params: URLSearchParams, f: EventFilterParams): void {
  for (const [key, value] of Object.entries(eventFilterFields(f))) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, String(value));
  }
}

/** A name the `AUTHOR_FILTER_RE` gate refuses is dropped, so a crafted URL cannot 422 every fetch,
 *  and an organization read from a slug carries the slug as its name. */
export function readEventFilterParams(params: {
  get(name: string): string | null;
  getAll(name: string): string[];
}): Required<Omit<EventFilterParams, "hasCoords" | "approvedBy">> & ApprovalFilters {
  const author = params.get("author") ?? "";
  const username = params.get("approved_by") ?? "";
  const slug = params.get("approved_by_org") ?? "";
  let approvedBy: Account | null = null;
  if (AUTHOR_FILTER_RE.test(username)) approvedBy = { kind: "analyst", username };
  else if (AUTHOR_FILTER_RE.test(slug)) approvedBy = { kind: "organization", slug, name: slug };
  return {
    show: params.getAll("status"),
    conflicts: params.getAll("conflict"),
    sourceKinds: params.getAll("source_kind"),
    levels: params.getAll("level"),
    tags: params.getAll("tag"),
    mediaTypes: params.getAll("media"),
    author: AUTHOR_FILTER_RE.test(author) ? author : "",
    approved: params.get("approved") === "true",
    approvedBy,
    eventFrom: params.get("occurred_date_from") ?? "",
    eventTo: params.get("occurred_date_to") ?? "",
    addedFrom: params.get("submitted_from") ?? "",
    addedTo: params.get("submitted_to") ?? "",
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
 *  (Insights tiles, *Show more* links). `author` is an exact username match
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
