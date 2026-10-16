"use client";

import { Loader2 } from "lucide-react";

import type { useCursorList } from "@/hooks/useCursorList";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { Button } from "./Button";
import { FORM_ERROR_BANNER } from "./form-styles";

type CursorWalk = Pick<
  ReturnType<typeof useCursorList>,
  "hasMore" | "loadingMore" | "loadMore" | "error"
>;

/**
 * The foot of a `useCursorList` list: **Load more** while a next page exists, a spinner while it
 * loads, and a failed page's message above a **Try again**. Renders nothing once the walk ends.
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
  return (
    <div className="space-y-3">
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      <div ref={sentinel} className="flex justify-center">
        <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
          {loadingMore && <Loader2 size={14} className="animate-spin" />}
          {loadingMore ? "Loading…" : error ? "Try again" : "Load more"}
        </Button>
      </div>
    </div>
  );
}
