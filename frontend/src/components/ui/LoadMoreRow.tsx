"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";

import type { useCursorList } from "@/hooks/useCursorList";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { cn } from "@/lib/cn";
import { Button, buttonClasses } from "./Button";
import { FORM_ERROR_BANNER } from "./form-styles";

/** The one label of the control that shows more of a list, in place or on another page. */
const SHOW_MORE = "Show more";

type CursorWalk = Pick<
  ReturnType<typeof useCursorList>,
  "hasMore" | "loadingMore" | "loadMore" | "error"
>;

/**
 * The foot of a `useCursorList` list: **Show more** while a next page exists, a spinner while it
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
          {loadingMore ? "Loading…" : error ? "Try again" : SHOW_MORE}
        </Button>
      </div>
    </div>
  );
}

/**
 * `<LoadMoreRow>`'s control as a link, for a preview whose whole list lives on another page (a
 * profile block that opens in search): the same label and the same secondary button, so the two
 * read as one control. `className` places it (`shrink-0` in a heading row).
 */
export function ShowMoreLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={buttonClasses("secondary", { className: cn("whitespace-nowrap", className) })}
    >
      {SHOW_MORE}
    </Link>
  );
}
