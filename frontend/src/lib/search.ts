import { apiFetch } from "./api";
import type {
  SearchResponse,
  SearchType,
} from "@/types";

/**
 * Hit ``GET /search``. Debouncing is the caller's job (the page wrapper
 * uses a 300ms useEffect timer). The endpoint short-circuits empty queries
 * server-side, so an over-eager debounce is an efficiency, not correctness, issue.
 */
export function search(opts: {
  q: string;
  type?: SearchType;
  limit?: number;
  /** The standard event filter set (same vocabulary as /events and
   *  /events/points); scopes the two event groups and empties the users
   *  group. With an empty `q` and any active filter the backend browses the
   *  filtered view (the profile's "Show more" entry point). */
  author?: string;
  conflict?: string[];
  captureSource?: string[];
  tag?: string[];
  media?: string[];
  eventDateFrom?: string;
  eventDateTo?: string;
  trustedOnly?: boolean;
}): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: opts.q,
    type: opts.type ?? "all",
    limit: String(opts.limit ?? 20),
  });
  if (opts.author) params.set("author", opts.author);
  opts.conflict?.forEach((n) => params.append("conflict", n));
  opts.captureSource?.forEach((n) => params.append("capture_source", n));
  opts.tag?.forEach((n) => params.append("tag", n));
  opts.media?.forEach((n) => params.append("media", n));
  if (opts.eventDateFrom) params.set("event_date_from", opts.eventDateFrom);
  if (opts.eventDateTo) params.set("event_date_to", opts.eventDateTo);
  if (opts.trustedOnly) params.set("trusted_only", "true");
  return apiFetch<SearchResponse>(`/search?${params.toString()}`);
}

/**
 * Split a sentinel-wrapped highlight string into alternating text + mark
 * segments. The backend (``services/search.py``) wraps matched fragments
 * with STX / ETX bytes (U+0002 / U+0003) — control bytes that never appear
 * in legitimate user text — and strips them from the source document
 * before ``ts_headline`` runs, so the response is well-formed regardless
 * of what's on disk. An earlier rev used ASCII ``[[HL]]`` / ``[[/HL]]``,
 * which a user could plant in their own bio or title to corrupt the
 * even/odd parity for everyone reading their content.
 *
 * Well-formed pairs make the even/odd-index split safe — no stateful
 * parser needed. Renders ``<mark>`` around matched fragments without
 * passing HTML across the API boundary (XSS-safe by construction).
 */
export function splitHighlights(s: string): Array<{
  text: string;
  highlighted: boolean;
}> {
  // Split on either sentinel byte — STX flips parity to "highlighted",
  // ETX flips it back. Empty segments (consecutive sentinels) are kept so
  // the odd/even-index parity holds.
  const parts = s.split(/[]/);
  return parts.map((text, i) => ({ text, highlighted: i % 2 === 1 }));
}
