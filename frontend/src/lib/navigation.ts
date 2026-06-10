/**
 * Smart back-navigation helper.
 *
 * Not `router.back()`: it calls `window.history.back()`, which walks off
 * our origin (e.g. back to the X.com post) and is a no-op on a fresh tab.
 * Not `document.referrer`: it only updates on full-page loads, and Next.js
 * client nav uses `history.pushState`, which never touches it — so in a
 * long SPA flow it stays whatever it was at first entry.
 *
 * Instead, `PathTracker` (mounted in the root providers) stamps the
 * previous same-origin pathname into `sessionStorage` on every route
 * change. `smartBack` routes to that, falling through to a default when
 * there's none (fresh tab, direct entry from a shared link).
 */
const PREV_PATH_KEY = "vidit:prev-internal-path";

/**
 * Sanitise the `?next=` query param before honouring it as a post-login
 * redirect target.
 *
 * The WHATWG URL parser is the source of truth: parse against
 * `window.location.origin`, honour only if `origin` didn't escape.
 * Character-position checks on the raw string aren't enough — the parser
 * transforms syntactically-relative paths into cross-origin URLs:
 *
 * - `https://evil.com/x` — absolute, obvious.
 * - `//evil.com/x` — scheme-relative; resolves to `https://evil.com`.
 * - `/\evil.com` — in HTTP-special schemes the parser normalises `\` → `/`,
 *   so this becomes `//evil.com`. (An earlier rev rejected the literal
 *   backslash at position 1.)
 * - `/\tevil.com` (`%2F%09evil.com`) — the parser strips TAB/LF/CR before
 *   parsing, so this becomes benign `/evil.com`; but `/\t/evil.com` lands
 *   at `//evil.com`. A position check can't see past the stripping; the
 *   post-parse origin check can.
 * - `javascript:alert(1)` — `origin` is `null`, fails the equality check.
 *
 * Returns `pathname + search + hash` (origin stripped) so `router.push`
 * treats it as same-origin nav.
 *
 * SSR safety: `useSearchParams()` returns null during prerender, so `raw`
 * is null on the server pass and we return `/map` before touching
 * `window`. The `typeof window` guard is defence-in-depth.
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

/** Called by `PathTracker` on every Next.js route change. */
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
  // `prev !== current` guards a same-page reload looping us back to
  // ourselves, a worse failure mode than the fallback.
  if (prev && prev !== window.location.pathname) {
    router.push(prev);
    return;
  }
  router.push(fallback);
}
