/**
 * Smart back-navigation. `router.back()` walks off our origin and is a no-op on a fresh tab;
 * `document.referrer` never updates on client nav.
 *
 * `PathTracker` (root providers) keeps a back-stack of same-origin pathnames in
 * `sessionStorage`: it pushes the path being left on each forward navigation and `smartBack`
 * pops it. A single "prev" slot would ping-pong between two pages, since `smartBack`
 * navigates with `push` and the tracker would re-record the page just left. A one-shot
 * "going back" flag, set by `smartBack` and consumed by the tracker, stops that.
 */
const NAV_STACK_KEY = "vidit:nav-stack";
const GOING_BACK_KEY = "vidit:nav-going-back";
const SKIP_RECORD_KEY = "vidit:nav-skip-record";
// Caps sessionStorage growth.
const MAX_STACK = 50;

/**
 * Sanitise `?next=` before honouring it as a post-login redirect. The WHATWG URL parser is
 * the source of truth: parse against `window.location.origin` and honour only if `origin`
 * did not escape. Character checks on the raw string miss cases the parser rewrites:
 * - `//evil.com/x`: scheme-relative.
 * - `/\evil.com`: `\` normalises to `/`, giving `//evil.com`.
 * - `/\t/evil.com`: the parser strips TAB/LF/CR, landing at `//evil.com`.
 * - `javascript:alert(1)`: `origin` is `null`.
 *
 * Returns `pathname + search + hash` so `router.push` treats it as same-origin.
 * `useSearchParams()` is null during prerender, so the server pass returns `/map` before
 * touching `window`.
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

/** Sign-in path that returns to `target` after login (read via `safeNext`). For authed
 *  actions on anonymous-readable pages, where the proxy can't intercept. */
export function loginNext(target: string): string {
  return `/login?next=${encodeURIComponent(target)}`;
}

function readStack(): string[] {
  try {
    const raw = window.sessionStorage.getItem(NAV_STACK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]): void {
  window.sessionStorage.setItem(
    NAV_STACK_KEY,
    JSON.stringify(stack.slice(-MAX_STACK))
  );
}

/**
 * Called by `PathTracker` on every route change with the pathname being left. Skips the push
 * when `smartBack` set the one-shot flag (the stack was already popped).
 */
export function recordNavigation(leftPath: string): void {
  if (typeof window === "undefined") return;
  if (window.sessionStorage.getItem(GOING_BACK_KEY) === "1") {
    window.sessionStorage.removeItem(GOING_BACK_KEY);
    return;
  }
  // Same one-shot shape for the page being left: a doorway declared itself, so it never
  // enters the chain.
  if (window.sessionStorage.getItem(SKIP_RECORD_KEY) === "1") {
    window.sessionStorage.removeItem(SKIP_RECORD_KEY);
    return;
  }
  const stack = readStack();
  // Skip a duplicate of the top (effect re-runs, repeated nav).
  if (stack[stack.length - 1] !== leftPath) {
    stack.push(leftPath);
    writeStack(stack);
  }
}

/**
 * Keep the page on screen out of the back-stack for the one navigation about to leave it.
 * For redirect-only routes (the detections review entry): walking back onto one reruns its
 * redirect, so the back arrow does nothing. Call it immediately before the `replace`: the
 * next `recordNavigation` consumes the flag, so one set without a navigation eats the next
 * entry.
 */
export function skipBackRecord(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SKIP_RECORD_KEY, "1");
}

export function smartBack(
  router: { push: (href: string) => void },
  fallback = "/"
): void {
  if (typeof window === "undefined") {
    router.push(fallback);
    return;
  }
  const stack = readStack();
  // Pop the first entry that isn't the current path (guards against reload or duplicate loops).
  let target: string | undefined;
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (candidate && candidate !== window.location.pathname) {
      target = candidate;
      break;
    }
  }
  writeStack(stack);
  // Flag the route change so `PathTracker` doesn't re-push the page being left.
  window.sessionStorage.setItem(GOING_BACK_KEY, "1");
  router.push(target ?? fallback);
}
