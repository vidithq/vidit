"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { smartBack } from "@/lib/navigation";
import { getPhoneBackSlot, subscribePhoneBackSlot } from "@/lib/phoneBackSlot";
import { TEXT_LINK } from "./styles";
import { Button } from "./Button";
import { PageCenter, PageFrame } from "./PageFrame";
import { PageWithRail } from "./PageWithRail";

export function PageShell({
  title,
  subtitle,
  back = false,
  backFallback,
  onBack,
  actions,
  stickyActions,
  controls,
  rail,
  railLabel,
  narrowRail,
  headerInColumn = false,
  headerSide,
  wide = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  /** Where Back lands when the session has nothing to return to. Forwards to
   *  `smartBack`'s `fallback` (`/` when unset). */
  backFallback?: string;
  /** Replaces Back's `smartBack`, for a page whose back target is a state of the page itself
   *  (the submit chooser). */
  onBack?: () => void;
  actions?: ReactNode;
  /** The page's actions, at the top right of the header. While the page scrolls the title goes
   *  and they stay pinned at the top right of the column. They come before the title in the DOM
   *  and the tab order. */
  stickyActions?: ReactNode;
  /** The view controls under the title, left-aligned (a scope or sort `SegmentedControl`, a
   *  mode picker), with any companion control pushed to the row's right end. */
  controls?: ReactNode;
  /** A right rail beside `children` (see `PageWithRail`). A page whose rail comes and goes passes
   *  `null` while it is gone, so the column keeps its element and its focus. The frame is `wide`
   *  while a rail shows and `reading` otherwise, which leaves the main column one width. */
  rail?: ReactNode;
  railLabel?: string;
  narrowRail?: ComponentProps<typeof PageWithRail>["narrow"];
  /** Puts the header (and `controls`) at the top of the main column, beside the rail, so the rail's
   *  first block sits top right level with the title. Below `lg` the header comes before the rail. */
  headerInColumn?: boolean;
  /** Heads the side column of a two-column page, beside the header (see `PageColumns`). The frame
   *  is `wide`, and the children lay out their own `PageColumns` under the header. */
  headerSide?: ReactNode;
  /** Takes the `wide` frame without a rail or a `headerSide`, for a page that lays out its own
   *  `PageColumns` (an event form). */
  wide?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const handleBack = onBack ?? (() => smartBack(router, backFallback));
  // The chip's back slot, published by `Sidebar`. Null until the chip exists.
  const phoneBackSlot = useSyncExternalStore(
    subscribePhoneBackSlot,
    getPhoneBackSlot,
    getPhoneBackSlot,
  );
  // One control, two placements: only the visibility classes differ.
  const renderBack = (className: string) => (
    <Button
      icon
      variant="ghost"
      onClick={handleBack}
      aria-label="Back"
      title="Back"
      className={className}
    >
      <ArrowLeft size={18} />
    </Button>
  );
  const inColumn = headerInColumn && rail !== undefined;
  // A rail under a full-width header rests below it. Its sticky `top` is that resting top, so it
  // never moves when the page scrolls; the header's height is only known once it renders.
  const measureHeader = !inColumn && rail !== undefined;
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState<number>();
  useEffect(() => {
    const el = headerRef.current;
    if (!measureHeader || !el) return;
    const observer = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureHeader]);
  // The frame's `pt-10`, plus the header and the `space-y-6` gap under it when it sits above the rail.
  const railTop = {
    "--rail-top":
      measureHeader && headerHeight !== undefined
        ? `calc(2.5rem + ${headerHeight}px + 1.5rem)`
        : "2.5rem",
  } as CSSProperties;
  const hasSticky = stickyActions !== undefined && stickyActions !== null && stickyActions !== false;
  // The sticky actions float over the header, so the header keeps their room: a spacer the
  // cluster's measured size, where they rest. The sentinel marks that resting top, so the cluster
  // knows when it has left it and needs a surface over the content scrolling under it.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const [stickySize, setStickySize] = useState<{ width: number; height: number }>();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = stickyRef.current;
    const sentinel = sentinelRef.current;
    if (!hasSticky || !el || !sentinel) return;
    const observer = new ResizeObserver(() =>
      setStickySize({ width: el.offsetWidth, height: el.offsetHeight }),
    );
    observer.observe(el);
    const onScroll = () =>
      setStuck(el.getBoundingClientRect().top - sentinel.getBoundingClientRect().top > 1);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [hasSticky]);
  const stickySpacer = (className?: string) =>
    hasSticky && (
      <div
        aria-hidden
        className={cn("shrink-0 max-w-full", className)}
        style={stickySize}
      />
    );
  const header = (
    <div ref={headerRef} className="space-y-6">
      <header>
        {/* Phone only: portaled into the chip's back slot, which lives inside a
            `sm:hidden` chip. */}
        {back && phoneBackSlot && createPortal(renderBack(""), phoneBackSlot)}
        {/* The actions drop under the title once they can't share a row. `basis-56`
            (14rem) is a preference, not a floor (`min-w-0`, `grow`): as a hard
            minimum it scrolled the page sideways on the narrowest phones. */}
        {/* With sticky actions the row wraps upwards, so on a phone their spacer takes a line above
            the title, where the cluster rests (`flex-wrap-reverse` swaps the cross axis, hence
            `items-end` for a top alignment). */}
        <div
          className={cn(
            "flex justify-between gap-4",
            hasSticky ? "flex-wrap-reverse items-end" : "flex-wrap items-start",
          )}
        >
          <div className="basis-56 grow min-w-0 space-y-2">
            <h1 className="text-xl font-medium text-neutral-100">{title}</h1>
            {subtitle && (
              // A bio can hold a bare URL, one unbreakable token.
              <div className="text-sm text-neutral-400 wrap-anywhere">
                {subtitle}
              </div>
            )}
          </div>
          {/* `max-w-full` lets a wide action row wrap inside itself; `shrink-0` alone
              would scroll a phone sideways. */}
          {actions && <div className="shrink-0 max-w-full">{actions}</div>}
          {/* From `lg` up a `headerSide` page keeps the room at the top of its side column. */}
          {stickySpacer(headerSide !== undefined ? "lg:hidden" : undefined)}
        </div>
      </header>
      {controls && (
        <div className="flex flex-wrap items-center justify-between gap-2">{controls}</div>
      )}
    </div>
  );
  return (
    // `max-sm:pt-16` (64px) clears the off-canvas rail's chip (about 55px). `pt-10` is also the
    // sticky `top` of the back arrow and of a rail beside the header (`PageWithRail`), so neither
    // moves when the page scrolls.
    <PageFrame
      column={rail || headerSide !== undefined || wide ? "wide" : "reading"}
      className="pt-10 max-sm:pt-16 pb-16"
    >
      <div className="relative space-y-6" style={railTop}>
        {back && (
          // From `lg` up the back arrow sits in the gutter left of the column (`right-full`), so
          // the title's x is the same with or without it; below `lg` that gutter would sit under
          // the fixed sidebar. The track spans the page's height and lets clicks through, so the
          // arrow can stick at the top of the viewport. `pt-1.5` levels it with the title. From
          // `sm` to `lg` it sits in flow above the title (`flex`, since `size-9` fixes the width).
          // `-ml-2` takes back 8 of the glyph's 9px inset. Below `sm` the chip copy takes over.
          <div className="max-sm:hidden mb-1 lg:absolute lg:inset-y-0 lg:right-full lg:mr-3 lg:mb-0 lg:pointer-events-none">
            <div className="lg:sticky lg:top-10 lg:pt-1.5">
              {renderBack("flex -ml-2 lg:ml-0 lg:pointer-events-auto")}
            </div>
          </div>
        )}
        {hasSticky && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-0 !mb-0" />
            {/* A zero-height track that sticks, so the cluster hangs from it over the header and
                stays pinned until the end of the page. Its `top` is the frame's top padding, so
                it never moves before it pins. From `lg` up the cluster is no wider than the side
                column (`PAGE_COLUMNS_SPLIT`, less the gap). Its surface overhangs by 8px, so the
                actions themselves line up with the column's edges. */}
            <div className="sticky top-10 max-sm:top-16 z-30 h-0 !mb-0 flex items-start justify-end pointer-events-none">
              <div
                data-stuck={stuck || undefined}
                className={cn(
                  "pointer-events-auto -m-2 max-w-[calc(100%+1rem)] lg:max-w-[calc((100%-1.5rem)*0.35+1rem)] rounded-lg border p-[7px] transition-colors",
                  stuck
                    ? "border-neutral-800 bg-neutral-950/95 shadow-lg backdrop-blur-sm"
                    : "border-transparent",
                )}
              >
                <div ref={stickyRef}>{stickyActions}</div>
              </div>
            </div>
          </>
        )}
        {headerSide !== undefined ? (
          <PageColumns
            main={header}
            side={
              <>
                {stickySpacer("max-lg:hidden")}
                {headerSide}
              </>
            }
          />
        ) : (
          !inColumn && header
        )}
        {rail === undefined ? (
          children
        ) : (
          <PageWithRail
            rail={rail}
            railLabel={railLabel}
            narrow={narrowRail}
            header={inColumn ? header : undefined}
          >
            {children}
          </PageWithRail>
        )}
      </div>
    </PageFrame>
  );
}

/** The 65:35 split of `PageColumns`, for a grid that places its own cells (`EventLayout`). */
export const PAGE_COLUMNS_SPLIT = "lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]";

/**
 * A main column and a side column, 65:35 from `lg` up. Below `lg` the side column follows the main
 * one. Every `PageColumns` of a page shares the split, so its columns line up from one to the next.
 */
export function PageColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className={`grid items-start gap-6 ${PAGE_COLUMNS_SPLIT}`}>
      <div className="min-w-0 space-y-6">{main}</div>
      <div className="min-w-0 space-y-6">{side}</div>
    </div>
  );
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <PageCenter>
      <span className="text-neutral-500">{label}</span>
    </PageCenter>
  );
}

// Centered error state, with an optional back link.
export function PageError({
  message,
  backHref,
}: {
  message: ReactNode;
  backHref?: string;
}) {
  return (
    <PageCenter>
      <div className="text-center space-y-2">
        <p className="text-sm text-neutral-300">{message}</p>
        {backHref && (
          <Link href={backHref} className={`text-xs ${TEXT_LINK}`}>
            Back to map
          </Link>
        )}
      </div>
    </PageCenter>
  );
}
