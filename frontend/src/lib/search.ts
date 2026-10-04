import { apiFetch } from "./api";
import type {
  SearchResponse,
  SearchType,
} from "@/types";

/** `GET /search`. Debouncing is the caller's job; the endpoint short-circuits empty queries. */
export function search(opts: {
  q: string;
  type?: SearchType;
  limit?: number;
  /** The standard event filter set (as /events and /events/points); scopes the two event
   *  groups and empties the users group. With an empty `q` and any filter the backend browses
   *  the filtered view (the profile's "Show more"). */
  author?: string;
  status?: string[];
  conflict?: string[];
  captureSource?: string[];
  tag?: string[];
  media?: string[];
  eventDateFrom?: string;
  eventDateTo?: string;
  submittedFrom?: string;
  submittedTo?: string;
}): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: opts.q,
    type: opts.type ?? "all",
    limit: String(opts.limit ?? 20),
  });
  if (opts.author) params.set("author", opts.author);
  opts.status?.forEach((n) => params.append("status", n));
  opts.conflict?.forEach((n) => params.append("conflict", n));
  opts.captureSource?.forEach((n) => params.append("capture_source", n));
  opts.tag?.forEach((n) => params.append("tag", n));
  opts.media?.forEach((n) => params.append("media", n));
  if (opts.eventDateFrom) params.set("event_date_from", opts.eventDateFrom);
  if (opts.eventDateTo) params.set("event_date_to", opts.eventDateTo);
  if (opts.submittedFrom) params.set("submitted_from", opts.submittedFrom);
  if (opts.submittedTo) params.set("submitted_to", opts.submittedTo);
  return apiFetch<SearchResponse>(`/search?${params.toString()}`);
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

/** Username typeahead for the exact-match author filter: `GET /search/authors` (prefix
 *  matches first). */
export async function suggestAuthors(q: string): Promise<string[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({ q: trimmed });
  const res = await apiFetch<{ authors: string[] }>(`/search/authors?${params.toString()}`);
  return res.authors;
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
