/** Reading the backend's cursor pagination. List endpoints cap at 100 rows and send the next
 *  page in a `Link: <url>; rel="next"` header. The client keeps the cursor, not the URL:
 *  callers build paths with their own query builders, and the header's absolute URL carries
 *  the API origin. */

/** The `cursor` value of a `Link: rel="next"` header, or `null` (no header, no `next`
 *  relation, or no `cursor`): the caller stops. */
export function nextCursor(header: string | null): string | null {
  // One match over the whole header, not a split on `,`: commas are legal in URLs
  // (`bbox=-90,-180,90,180`). `<[^>]+>` can't straddle two links and the lookahead keeps
  // `rel="nextpage"` out.
  const match = header?.match(/<([^>]+)>\s*;\s*rel="?next"?(?=\s*(?:[,;]|$))/);
  if (!match) return null;
  try {
    return new URL(match[1]).searchParams.get("cursor");
  } catch {
    return null;
  }
}
