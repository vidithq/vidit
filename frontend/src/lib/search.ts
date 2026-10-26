import type { Account } from "@/components/ui/AccountPicker";
import { apiFetch } from "./api";
import type { components } from "./api-types";
import type {
  SearchResponse,
  SearchType,
} from "@/types";

/** `GET /search`. Debouncing is the caller's job; the endpoint short-circuits empty queries. The
 *  event filters scope the two event groups and empty the users group. With an empty `q` and any
 *  filter the backend browses the filtered view (the profile's "Show more"). `cursor` is a
 *  response's `geolocations_cursor`, sent with `type: "geolocation"` and the options that
 *  minted it. */
export function search(
  opts: { q: string; type?: SearchType; limit?: number; cursor?: string } & EventFilterParams,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: opts.q,
    type: opts.type ?? "all",
    limit: String(opts.limit ?? 20),
  });
  if (opts.cursor) params.set("cursor", opts.cursor);
  appendEventFilterParams(params, opts);
  return apiFetch<SearchResponse>(`/search?${params.toString()}`);
}

/** The approval filter values: `approved`, and the account `approvedBy` names. */
export interface ApprovalFilters {
  approved: boolean;
  approvedBy: Account | null;
}

/** The date fields share the `DateWindows` names, so a surface spreads its windows in. */
export interface EventFilterParams extends Partial<ApprovalFilters> {
  statuses?: string[];
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

/** A list is any-match within itself and AND across lists. An author the `AUTHOR_FILTER_RE` gate
 *  refuses is dropped rather than sent to a 422. */
export function appendEventFilterParams(params: URLSearchParams, f: EventFilterParams): void {
  f.statuses?.forEach((v) => params.append("status", v));
  f.conflicts?.forEach((v) => params.append("conflict", v));
  f.sourceKinds?.forEach((v) => params.append("source_kind", v));
  f.levels?.forEach((v) => params.append("level", v));
  f.tags?.forEach((v) => params.append("tag", v));
  f.mediaTypes?.forEach((v) => params.append("media", v));
  const author = f.author?.trim();
  if (author && AUTHOR_FILTER_RE.test(author)) params.set("author", author);
  if (f.hasCoords !== undefined) params.set("has_coords", String(f.hasCoords));
  if (f.approved) params.set("approved", "true");
  const by = f.approvedBy;
  if (by?.kind === "analyst") params.set("approved_by", by.username);
  else if (by) params.set("approved_by_org", by.slug);
  if (f.eventFrom) params.set("occurred_date_from", f.eventFrom);
  if (f.eventTo) params.set("occurred_date_to", f.eventTo);
  if (f.addedFrom) params.set("submitted_from", f.addedFrom);
  if (f.addedTo) params.set("submitted_to", f.addedTo);
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
    statuses: params.getAll("status"),
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
 *  groups of `GET /search`. */
export async function suggestApprovers(q: string): Promise<Account[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const [users, organizations] = await Promise.all([
    search({ q: trimmed, type: "user", limit: APPROVER_SUGGESTIONS }),
    search({ q: trimmed, type: "organization", limit: APPROVER_SUGGESTIONS }),
  ]);
  return [
    ...users.users.map((u): Account => ({
      kind: "analyst",
      username: u.username,
      avatar_url: u.avatar_url,
    })),
    ...organizations.organizations.map((o): Account => ({
      kind: "organization",
      slug: o.slug,
      name: o.name,
      avatar_url: o.avatar_url,
    })),
  ];
}

/** A `/search` URL scoped to one analyst: the profile's one entry into the filtered catalogue
 *  (Insights tiles, *Show more* links). `author` is an exact username match
 *  (`services/event_filters.apply_author_filter`). `type` defaults to the event groups since
 *  every filter is an event predicate; `collection` scopes to the analyst's shelf, the other
 *  group `author` narrows. `filters` takes the search page's URL vocabulary, one value per key. */
export function profileSearchHref(
  username: string,
  filters: Record<string, string> = {},
  type: SearchType = "event",
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
