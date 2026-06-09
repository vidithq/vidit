/**
 * Smart back-navigation helper.
 *
 * Why not just `router.back()`: that calls `window.history.back()`,
 * which happily walks off our origin (e.g. landing the user back on
 * the X.com post they followed in) and does nothing on a fresh tab.
 *
 * Why not `document.referrer`: it only updates on full-page loads.
 * Next.js client-side navigation uses `history.pushState`, which
 * never touches `document.referrer` — so within a long SPA flow,
 * `document.referrer` stays whatever it was at first entry.
 *
 * What we actually do: a small "use client" tracker (mounted in the
 * root providers, see `PathTracker`) stamps the previous same-origin
 * pathname into `sessionStorage` on every route change. `smartBack`
 * routes to that on press; if there's none (fresh tab, direct entry
 * from a shared link), we fall through to a sensible default.
 */
const PREV_PATH_KEY = "vidit:prev-internal-path";

/**
 * Sanitise the `?next=` query param before honouring it as a
 * post-login redirect target.
 *
 * The WHATWG URL parser is the source of truth: parse the raw value
 * against `window.location.origin`, and only honour the result if
 * its `origin` didn't escape. Character-position checks on the raw
 * string are not enough — the URL parser performs transformations
 * that flip a syntactically-relative path into a cross-origin URL:
 *
 * - `https://evil.com/x` — absolute URL, obvious.
 * - `//evil.com/x` — scheme-relative; `new URL('//evil.com', base)`
 *   resolves to `https://evil.com`.
 * - `/\evil.com` — in HTTP-special schemes, the parser normalises
 *   `\` → `/`, so this becomes `//evil.com` and resolves to
 *   `evil.com`. A previous version of this function rejected the
 *   literal backslash at position 1.
 * - `/\tevil.com` (encoded `%2F%09evil.com`) — the parser strips
 *   TAB, LF, CR from URL inputs before parsing, so the value
 *   becomes `/evil.com` which is a benign same-origin path; but
 *   `/\t/evil.com` strips the tab and lands at `//evil.com`. A
 *   character-position check can't see past the stripping; the
 *   origin equality check after parsing does.
 * - `javascript:alert(1)` — special scheme; the URL's `origin` is
 *   `null`, which trivially fails the origin equality check.
 *
 * Returns `pathname + search + hash` (origin stripped) on success
 * so `router.push` treats it as same-origin navigation.
 *
 * SSR safety: `useSearchParams()` returns null during prerender, so
 * `raw` is always null on the server pass and the function returns
 * `/map` before touching `window`. The `typeof window` guard is
 * defence-in-depth.
 */
export function safeNext(raw: string | null): string {
  if (!raw) return "/map";
  if (!raw.startsWith("/")) return "/map";
  if (typeof window === "undefined") return "/map";
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return "/map";
  }
  if (url.origin !== window.location.origin) return "/map";
  return url.pathname + url.search + url.hash;
}

/**
 * Internal: write a same-origin previous pathname into sessionStorage.
 * Called by `PathTracker` on every Next.js route change.
 */
export function setPreviousInternalPath(path: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PREV_PATH_KEY, path);
}

export function smartBack(
  router: { back: () => void; push: (href: string) => void },
  fallback = "/"
): void {
  if (typeof window === "undefined") {
    router.push(fallback);
    return;
  }
  const prev = window.sessionStorage.getItem(PREV_PATH_KEY);
  // `prev !== current` is belt-and-suspenders: a same-page reload would
  // otherwise loop us back to ourselves, which is a worse failure mode
  // than the fallback.
  if (prev && prev !== window.location.pathname) {
    router.push(prev);
    return;
  }
  router.push(fallback);
}
