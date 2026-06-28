/**
 * Smart back-navigation helper.
 *
 * Not `router.back()` / `window.history.back()`: they walk off our origin
 * (e.g. back to the X.com post) and are a no-op on a fresh tab. Not
 * `document.referrer`: it only updates on full-page loads, and Next.js client
 * nav uses `history.pushState`, which never touches it — so in a long SPA flow
 * it stays whatever it was at first entry.
 *
 * Instead, `PathTracker` (mounted in the root providers) maintains a back-stack
 * of same-origin pathnames in `sessionStorage`: it pushes the path being left on
 * each forward navigation, and `smartBack` pops it. A single "prev" slot can't
 * do this — `smartBack` navigates with `push` (a forward nav), so the tracker
 * would immediately re-record the page just left, and the button would
 * ping-pong between the last two pages instead of walking the chain
 * (Map → Profile → Detections then back should go Detections → Profile → Map). A
 * one-shot "going back" flag, set by `smartBack` and consumed by the tracker,
 * stops that re-record so the walk stays honest.
 */
const NAV_STACK_KEY = "vidit:nav-stack";
const GOING_BACK_KEY = "vidit:nav-going-back";
// Cap the stack so a long session can't grow sessionStorage without bound; the
// deep tail of a back-stack is never reached in practice.
const MAX_STACK = 50;

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
 * Called by `PathTracker` on every Next.js route change, with the pathname being
 * left. Pushes it onto the back-stack — unless the change was triggered by
 * `smartBack` (the one-shot flag), in which case the stack was already popped
 * and re-pushing would defeat the back walk.
 */
export function recordNavigation(leftPath: string): void {
  if (typeof window === "undefined") return;
  if (window.sessionStorage.getItem(GOING_BACK_KEY) === "1") {
    window.sessionStorage.removeItem(GOING_BACK_KEY);
    return;
  }
  const stack = readStack();
  // Skip a duplicate of the current top (effect re-runs, repeated nav to the
  // same path) so the stack mirrors the real visit chain.
  if (stack[stack.length - 1] !== leftPath) {
    stack.push(leftPath);
    writeStack(stack);
  }
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
  // Pop the first entry that isn't where we already are (defensive against a
  // reload or a duplicate push looping us back to ourselves).
  let target: string | undefined;
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (candidate && candidate !== window.location.pathname) {
      target = candidate;
      break;
    }
  }
  writeStack(stack);
  // Flag the upcoming route change as this back-nav so `PathTracker` doesn't
  // re-push the page we're leaving (the ping-pong this whole module avoids).
  window.sessionStorage.setItem(GOING_BACK_KEY, "1");
  router.push(target ?? fallback);
}
