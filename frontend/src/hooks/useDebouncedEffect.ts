"use client";

import { useEffect, type DependencyList } from "react";

/**
 * Run `effect` once `deps` have stopped changing for `delayMs`: the shape every
 * typing-driven surface here needs (the search page's commit + URL sync, the
 * author typeahead, the submit form's duplicate probe), so the timer bookkeeping
 * lives in one place instead of a hand-rolled `setTimeout` per call site.
 *
 * `effect` may return a cleanup, like `useEffect`. It runs on the next dep
 * change or on unmount, and only when the effect actually fired: a change that
 * lands inside the delay window cancels the pending run instead, so an
 * in-flight-request guard (`cancelled` flag, `AbortController`) belongs in the
 * returned cleanup and nothing has to guard a run that never started.
 */
export function useDebouncedEffect(
  effect: () => void | (() => void),
  deps: DependencyList,
  delayMs: number,
): void {
  useEffect(() => {
    let cleanup: void | (() => void);
    const timer = setTimeout(() => {
      cleanup = effect();
    }, delayMs);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
    // `effect` is a fresh closure every render by design; the call site's
    // `deps` are the contract, exactly as with `useEffect`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);
}
