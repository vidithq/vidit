/** Reading the backend's cursor pagination on the client side.
 *
 *  Every list endpoint caps its response at 100 rows and hands the next page
 *  over in a `Link: <url>; rel="next"` header. The client keeps the cursor
 *  value rather than the URL: paths are built by the callers' own query
 *  builders (`eventListPath`), and the header's absolute URL carries the API
 *  origin, which the browser client must not hard-code into a request.
 */

/** The `cursor` value out of a `Link: rel="next"` header, or `null`.
 *
 *  `null` for a missing header (the last page), a header with no `next`
 *  relation, or a URL carrying no `cursor`: all three mean "nothing more to
 *  ask for", so the caller stops.
 */
export function nextCursor(header: string | null): string | null {
  // One match over the whole header, not a split on `,`: a comma is legal
  // inside a URL and the next-page URL carries the whole query the page was
  // minted under, so a filter like `bbox=-90,-180,90,180` would be cut into
  // fragments that match nothing. `<[^>]+>` cannot straddle two links (a URL
  // holds no `>`), and the trailing lookahead keeps `rel="nextpage"` out.
  const match = header?.match(/<([^>]+)>\s*;\s*rel="?next"?(?=\s*(?:[,;]|$))/);
  if (!match) return null;
  try {
    return new URL(match[1]).searchParams.get("cursor");
  } catch {
    // A header we cannot parse is not a page we can reach.
    return null;
  }
}
