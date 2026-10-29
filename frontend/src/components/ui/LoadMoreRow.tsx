"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import type { useCursorList } from "@/hooks/useCursorList";
import { cn } from "@/lib/cn";
import { ActionIcon, Button, buttonClasses } from "./Button";
import { ErrorNotice } from "./ErrorNotice";

/** The label of the control that grows a list in place. */
const SHOW_MORE = "Show more";

type CursorWalk = Pick<
  ReturnType<typeof useCursorList>,
  "hasMore" | "loadingMore" | "loadMore" | "error"
>;

/**
 * The foot of a `useCursorList` list: **Show more** while a next page exists, a spinner while it
 * loads, and a failed page's `<ErrorNotice>` with a **Retry**. Renders nothing once the walk ends.
 *
 * `infinite` also loads the next page when the row comes within a screen of the viewport, and
 * pauses after a failure until the click, since the row is still in view. A first page that
 * fails leaves no next page, so its error stays the caller's to show.
 */
export function LoadMoreRow({
  walk,
  infinite = false,
}: {
  walk: CursorWalk;
  infinite?: boolean;
}) {
  const { hasMore, loadingMore, loadMore, error } = walk;
  const sentinel = useInfiniteScroll<HTMLDivElement>(
    loadMore,
    infinite && hasMore && !loadingMore && !error
  );
  if (!hasMore) return null;
  // A fault the reader did not cause brings its own Retry; a refused page keeps Show more.
  if (error?.title && !loadingMore) return <ErrorNotice error={error} onRetry={loadMore} />;
  return (
    <div className="space-y-3">
      <ErrorNotice error={error} />
      <div ref={sentinel} className="flex justify-center">
        <Button
          action={loadingMore ? undefined : error ? "retry" : "more"}
          variant="secondary"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore && <Loader2 size={14} className="animate-spin" />}
          {loadingMore ? "Loading…" : SHOW_MORE}
        </Button>
      </div>
    </div>
  );
}

/**
 * **See all**: the link from a preview to its whole list, on another page or in another view of
 * the same page (a profile block that opens in search, a search section that opens its kind). The
 * secondary button of `<LoadMoreRow>`, so the two read as one family. `className` places it
 * (`shrink-0` in a heading row).
 */
export function SeeAllLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={buttonClasses("secondary", { className: cn("whitespace-nowrap", className) })}
    >
      <ActionIcon action="seeAll" />
      See all
    </Link>
  );
}

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
function useInfiniteScroll<E extends Element>(
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
