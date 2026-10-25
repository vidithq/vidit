"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { Dot } from "./Dot";
import { META_LINE } from "./styles";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

type Span = { first: number; last: number };

/** What a parent can ask of the scroller: `show` scrolls item `index` into view. */
export interface HorizontalScrollerHandle {
  show: (index: number) => void;
}

// An item counts as shown once half of it is in view, so the card peeking on a phone does not.
// A zero-width item (no layout yet, or jsdom) is never shown, which keeps the last measured span.
function shownSpan(strip: HTMLElement): Span | null {
  const left = strip.scrollLeft;
  const right = left + strip.clientWidth;
  let first = -1;
  let last = -1;
  Array.from(strip.children).forEach((child, i) => {
    const item = child as HTMLElement;
    const width = item.offsetWidth;
    const shown = Math.min(item.offsetLeft + width, right) - Math.max(item.offsetLeft, left);
    if (width > 0 && shown >= width / 2) {
      if (first < 0) first = i;
      last = i;
    }
  });
  return first < 0 ? null : { first, last };
}

/**
 * A row of same-width items that scrolls sideways, one snap point per item. In the `row` variant,
 * a lone item takes the row's full width, and two items fit side by side once the row is 32rem
 * wide; below that one fits and the next peeks. With more than one item, the header carries the shown range ("1 to 2 of 5") and previous and
 * next buttons that scroll by one item and go inert at the ends. The `carousel` variant shows one
 * item at the row's full width, the position ("2 / 3") between the buttons, and one dot per item
 * under the row.
 */
export function HorizontalScroller({
  heading,
  label,
  previousLabel,
  nextLabel,
  variant = "row",
  actions,
  dotLabel = (index) => `Show item ${index + 1}`,
  ref,
  children,
}: {
  /** The header's leading node, such as a `<SectionEyebrow>`. */
  heading: ReactNode;
  /** The accessible name of the scrolling region. */
  label: string;
  /** The previous button's accessible name, such as *Previous source*. */
  previousLabel: string;
  nextLabel: string;
  variant?: "row" | "carousel";
  /** Header controls after the buttons, shown at any item count. */
  actions?: ReactNode;
  /** A carousel dot's accessible name, such as *Show source 2*. */
  dotLabel?: (index: number) => string;
  ref?: Ref<HorizontalScrollerHandle>;
  children: ReactNode;
}) {
  const carousel = variant === "carousel";
  const items = Children.toArray(children);
  const count = items.length;
  const strip = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<Span>({ first: 0, last: 0 });

  const measure = useCallback(() => {
    const el = strip.current;
    const next = el && shownSpan(el);
    if (next) {
      setSpan((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
    }
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure, count]);

  // A removal can leave the last measure past the end until the strip measures again.
  const first = Math.min(span.first, count - 1);
  const last = Math.min(span.last, count - 1);

  const scrollTo = (index: number) => {
    const el = strip.current;
    const item = el?.children[index] as HTMLElement | undefined;
    if (!el || !item) return;
    // The carousel names the target at once: a smooth scroll only lands on it later.
    if (carousel) setSpan({ first: index, last: index });
    const reduce = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
    el.scrollTo({ left: item.offsetLeft, behavior: reduce ? "auto" : "smooth" });
  };

  useImperativeHandle(ref, () => ({ show: scrollTo }));

  const previous = () => {
    if (first > 0) scrollTo(first - 1);
  };
  const next = () => {
    if (last < count - 1) scrollTo(first + 1);
  };
  // Left and right on either button step like the buttons, so a keyboard reader stays on them.
  const onArrowKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    if (e.key === "ArrowLeft") previous();
    else next();
  };

  const range = carousel
    ? `${first + 1} / ${count}`
    : first === last
      ? `${first + 1} of ${count}`
      : `${first + 1} to ${last + 1} of ${count}`;
  const position = (
    <span className={cn(META_LINE, "tabular-nums", !carousel && "mr-1")} aria-live="polite">
      {carousel ? (
        <>
          <span aria-hidden="true">{range}</span>
          <span className="sr-only">{`${first + 1} of ${count}`}</span>
        </>
      ) : (
        range
      )}
    </span>
  );
  const previousButton = (
    <Button icon variant="ghost" aria-label={previousLabel} disabled={first === 0} onClick={previous}>
      <ChevronLeft size={16} />
    </Button>
  );
  const nextButton = (
    <Button icon variant="ghost" aria-label={nextLabel} disabled={last >= count - 1} onClick={next}>
      <ChevronRight size={16} />
    </Button>
  );

  return (
    <div className="@container space-y-3">
      {/* At least as tall as the 32px buttons, so a heading beside an actions-only row (one item)
          keeps the height a column beside it levels with (`SectionEyebrow besideScroller`). */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        {heading}
        {(count > 1 || actions) && (
          <div className="flex items-center gap-1">
            {count > 1 && (
              <div className="flex items-center gap-1" onKeyDown={onArrowKey}>
                {carousel ? (
                  <>
                    {previousButton}
                    {position}
                    {nextButton}
                  </>
                ) : (
                  <>
                    {position}
                    {previousButton}
                    {nextButton}
                  </>
                )}
              </div>
            )}
            {actions}
          </div>
        )}
      </div>
      {/* Focusable so the arrow keys scroll it; `relative` makes each item's offsetLeft a scroll position.
          `grid-cols-1` is `minmax(0, 1fr)`: an item's unbreakable content (a long link) truncates
          instead of widening the item past its basis. */}
      <div
        ref={strip}
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "relative flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-md outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400",
          carousel ? "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "pb-2",
        )}
      >
        {items.map((item, i) => (
          <div
            key={isValidElement(item) && item.key !== null ? item.key : i}
            className={cn(
              "grid shrink-0 grid-cols-1 snap-start",
              carousel || count === 1 ? "basis-full" : "basis-[85%] @lg:basis-[calc(50%-0.375rem)]",
            )}
          >
            {item}
          </div>
        ))}
      </div>
      {carousel && count > 1 && (
        <div className="flex flex-wrap justify-center">
          {items.map((_, i) => (
            <Button
              key={i}
              icon
              variant="ghost"
              className="size-6 sm:size-6"
              aria-label={dotLabel(i)}
              aria-current={i === first ? "true" : undefined}
              onClick={() => scrollTo(i)}
            >
              <Dot className={cn("size-2", i !== first && "bg-neutral-600")} />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
