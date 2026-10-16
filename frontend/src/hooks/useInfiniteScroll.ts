import { useEffect, useState } from "react";

/**
 * Infinite scroll for a `useCursorList` walk: returns a callback ref for the list's foot row,
 * and calls `loadMore` whenever that row comes within a screen of the viewport while `enabled`.
 * Pass `hasMore && !loadingMore`.
 *
 * The row is held in state, not a `useRef`, so the observer is rebuilt when the row mounts: a
 * page that renders the row late (after an auth gate) would otherwise keep an effect that ran
 * against no node and never scrolls on. A new observer reports the row's current position, so
 * a page too short to scroll keeps loading until it fills the screen or the walk ends.
 */
export function useInfiniteScroll<E extends Element>(
  loadMore: () => void,
  enabled: boolean
) {
  const [node, setNode] = useState<E | null>(null);

  useEffect(() => {
    if (!enabled || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "100% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled, loadMore]);

  return setNode;
}
