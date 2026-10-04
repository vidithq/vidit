"use client";

import { useEffect, type DependencyList } from "react";

/** Run `effect` once `deps` stop changing for `delayMs`, for typing-driven surfaces (search,
 * typeahead, duplicate probe). The optional cleanup runs on the next dep change or unmount,
 * only if the effect fired; a change inside the delay cancels the pending run, so a request
 * guard belongs in the cleanup. */
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
    // `effect` is a fresh closure every render by design; `deps` are the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);
}
