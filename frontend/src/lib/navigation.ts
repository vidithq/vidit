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
