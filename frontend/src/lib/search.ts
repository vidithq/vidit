import { apiFetch } from "./api";
import type {
  SearchResponse,
  SearchType,
} from "@/types";

/**
 * Hit ``GET /search``. Caller-side debouncing is the user's
 * responsibility — the page-level wrapper handles it via a 300ms
 * useEffect timer. The endpoint short-circuits empty queries server-
 * side so an over-eager debounce isn't a correctness issue, just an
 * efficiency one.
 */
export function search(opts: {
  q: string;
  type?: SearchType;
  limit?: number;
}): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: opts.q,
    type: opts.type ?? "all",
    limit: String(opts.limit ?? 20),
  });
  return apiFetch<SearchResponse>(`/search?${params.toString()}`);
}

/**
 * Split a sentinel-wrapped highlight string into alternating text +
 * mark segments. The backend (``services/search.py``) wraps matched
 * fragments inside ``ts_headline`` output with STX / ETX bytes
 * (U+0002 / U+0003) — control bytes that never appear in legitimate
 * user-typed text. The backend also strips these bytes from the source
 * document before ``ts_headline`` runs (belt-and-suspenders), so the
 * response is well-formed regardless of what's on disk. An earlier rev
 * used the ASCII string ``[[HL]]`` / ``[[/HL]]``, which a user could
 * plant in their own bio or title to corrupt the highlight string's
 * even/odd parity for everyone reading their content.
 *
 * The backend guarantees well-formed pairs, so the even-index/odd-index
 * split is safe — no need for a stateful parser. Used by the search
 * page to render ``title_highlight``, ``username_highlight``,
 * ``bio_highlight`` with ``<mark>`` around matched fragments without
 * ever passing HTML across the API boundary (XSS-safe by construction).
 */
export function splitHighlights(s: string): Array<{
  text: string;
  highlighted: boolean;
}> {
  // Split on either sentinel byte — STX flips the parity to
  // "highlighted", ETX flips it back. Empty segments (consecutive
  // sentinels) are kept so the odd/even-index parity holds.
  const parts = s.split(/[]/);
  return parts.map((text, i) => ({ text, highlighted: i % 2 === 1 }));
}
