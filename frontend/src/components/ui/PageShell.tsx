"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
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
  titleField,
  subtitle,
  back = false,
  backFallback,
  onBack,
  actions,
  stickyActions,
  stickyActionsIdle = false,
  controls,
  rail,
  railLabel,
  narrowRail,
  headerInColumn = false,
  headerSide,
  column,
  children,
}: {
  title: ReactNode;
  /** Takes the title's place on a form whose first field is the title (`EventShell`). `title`
   *  stays the page's `h1`, visually hidden. */
  titleField?: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  /** Where Back lands when the session has nothing to return to. Forwards to
   *  `smartBack`'s `fallback` (`/` when unset). */
  backFallback?: string;
  /** Replaces Back's `smartBack`, for a page whose back target is a state of the page itself
   *  (the submit chooser). */
  onBack?: () => void;
  actions?: ReactNode;
  /** The page's actions, at the top right of the header, in an `aside` named *Actions*. While
   *  the page scrolls the title goes and they stay pinned at the top right of the column. They
   *  come before the title in the DOM and the tab order. */
  stickyActions?: ReactNode;
  /** Keeps the room of `stickyActions` but hides them: invisible, inert, and with no surface once
   *  the page scrolls. For actions that come and go with a page state (the search page's Add to
   *  collection, while nothing is selected), so the header does not move when they return. */
  stickyActionsIdle?: boolean;
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
   *  is `wide`, and the children lay out their own `PageColumns` under the header. `EventShell`
   *  sets it, `null` for an empty side. */
  headerSide?: ReactNode;
  /** The content column's width. Unset, it is `wide` with a `rail` or a `headerSide` and `reading`
   *  otherwise. `wide` gives a page without either the full column, for a grid that fills it (the
   *  submit chooser). */
  column?: "reading" | "wide";
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
  const stickyRef = useRef<HTMLElement>(null);
  // The side column's spacer, on a `headerSide` page.
  const sideSpacerRef = useRef<HTMLDivElement>(null);
  const [stickySize, setStickySize] = useState<{ width: number; height: number }>();
  // How far the resting cluster reaches left past the side column, into the header's row: all of
  // it while the columns stack.
  const [overhang, setOverhang] = useState(0);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = stickyRef.current;
    const sentinel = sentinelRef.current;
    if (!hasSticky || !el || !sentinel) return;
    const side = sideSpacerRef.current?.parentElement;
    const header = headerRef.current;
    const observer = new ResizeObserver(() => {
      setStickySize({ width: el.offsetWidth, height: el.offsetHeight });
      if (side && header) {
        const room = side.getBoundingClientRect().right - header.getBoundingClientRect().right;
        setOverhang(Math.max(0, el.offsetWidth - room));
      }
    });
    observer.observe(el);
    if (side && header) {
      observer.observe(side);
      observer.observe(header);
    }
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
  const stickySpacer = (size = stickySize, ref?: Ref<HTMLDivElement>, className?: string) =>
    hasSticky && (
      <div ref={ref} aria-hidden className={cn("shrink-0 max-w-full", className)} style={size} />
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
            <h1 className={cn(PAGE_TITLE_TEXT, "text-neutral-100", titleField && "sr-only")}>
              {title}
            </h1>
            {titleField}
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
          {/* From `lg` up a `headerSide` page keeps the room at the top of its side column, and
              here only what the cluster reaches past it. */}
          {headerSide === undefined
            ? stickySpacer()
            : overhang > 0 && stickySpacer(stickySize && { ...stickySize, width: overhang })}
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
      column={column ?? (rail || headerSide !== undefined ? "wide" : "reading")}
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
                it never moves before it pins. The cluster takes the width its actions need on one
                line, up to the column's. Its surface overhangs by 8px, so the actions themselves
                line up with the column's edges. */}
            <div className="sticky top-10 max-sm:top-16 z-30 h-0 !mb-0 flex items-start justify-end pointer-events-none">
              {/* On a phone the pinned cluster sits on a band from the screen's top edge to under
                  the cluster, the drawer chip's row included, so the content scrolls under one
                  surface instead of showing between the chip and the actions. */}
              {stuck && !stickyActionsIdle && stickySize && (
                <div
                  aria-hidden
                  className="sm:hidden pointer-events-auto absolute -top-16 -left-[calc(1rem+env(safe-area-inset-left))] -right-[calc(1rem+env(safe-area-inset-right))] border-b border-neutral-800 bg-neutral-950/95 backdrop-blur-sm"
                  style={{ height: `calc(5rem + ${stickySize.height}px)` }}
                />
              )}
              <div
                data-stuck={stuck || undefined}
                className={cn(
                  "pointer-events-auto relative -m-2 max-w-[calc(100%+1rem)] rounded-lg border p-[7px] transition-colors",
                  stuck && !stickyActionsIdle
                    ? "border-transparent sm:border-neutral-800 sm:bg-neutral-950/95 sm:shadow-lg sm:backdrop-blur-sm"
                    : "border-transparent",
                  stickyActionsIdle && "invisible",
                )}
              >
                {/* The one landmark of a page's actions, so no caller spells it. */}
                <aside ref={stickyRef} aria-label="Actions" inert={stickyActionsIdle}>
                  {stickyActions}
                </aside>
              </div>
            </div>
          </>
        )}
        {headerSide !== undefined ? (
          <PageColumns
            main={header}
            side={
              <>
                {stickySpacer(stickySize, sideSpacerRef, "max-lg:hidden")}
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

/** The page title's type: the `h1`, and a form's Title field in its place (`TitleField`). */
export const PAGE_TITLE_TEXT = "text-xl leading-7 font-medium";

/** The 65:35 split of `PageColumns`, for a grid that places its own cells (`EventLayout`). */
export const PAGE_COLUMNS_SPLIT = "lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]";

/**
 * A main column and a side column, 65:35 from `lg` up. Below `lg` the side column follows the main
 * one. Every `PageColumns` of a page shares the split, so its columns line up from one to the next.
 *
 * `stickySide` pins the side column from `lg` up while a long main column scrolls. Its `top`
 * clears the pinned `stickyActions` cluster, which hangs over the side column.
 */
export function PageColumns({
  main,
  side,
  stickySide = false,
}: {
  main: ReactNode;
  side: ReactNode;
  stickySide?: boolean;
}) {
  return (
    <div className={`grid items-start gap-6 ${PAGE_COLUMNS_SPLIT}`}>
      <div className="min-w-0 space-y-6">{main}</div>
      <div className={cn("min-w-0 space-y-6", stickySide && "lg:sticky lg:top-24")}>{side}</div>
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
  backLabel = "Back to map",
}: {
  message: ReactNode;
  backHref?: string;
  /** Names where `backHref` leads, when it is not the map. */
  backLabel?: string;
}) {
  return (
    <PageCenter>
      <div className="text-center space-y-2">
        <p className="text-sm text-neutral-300">{message}</p>
        {backHref && (
          <Link href={backHref} className={`text-xs ${TEXT_LINK}`}>
            {backLabel}
          </Link>
        )}
      </div>
    </PageCenter>
  );
}
