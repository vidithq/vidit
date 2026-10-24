"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { META_LINE } from "./styles";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

type Span = { first: number; last: number };

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
 * A row of same-width items that scrolls sideways, one snap point per item. Two items fit side by
 * side once the row is 32rem wide; below that one fits and the next peeks. With more than one
 * item, the header carries the shown range ("1 to 2 of 5") and previous and next buttons that
 * scroll by one item and go inert at the ends.
 */
export function HorizontalScroller({
  heading,
  label,
  previousLabel,
  nextLabel,
  children,
}: {
  /** The header's leading node, such as a `<SectionEyebrow>`. */
  heading: ReactNode;
  /** The accessible name of the scrolling region. */
  label: string;
  /** The previous button's accessible name, such as *Previous source*. */
  previousLabel: string;
  nextLabel: string;
  children: ReactNode;
}) {
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

  const scrollTo = (index: number) => {
    const el = strip.current;
    const item = el?.children[index] as HTMLElement | undefined;
    if (!el || !item) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
    el.scrollTo({ left: item.offsetLeft, behavior: reduce ? "auto" : "smooth" });
  };

  const range =
    span.first === span.last
      ? `${span.first + 1} of ${count}`
      : `${span.first + 1} to ${span.last + 1} of ${count}`;

  return (
    <div className="@container space-y-3">
      <div className="flex items-center justify-between gap-2">
        {heading}
        {count > 1 && (
          <div className="flex items-center gap-1">
            <span className={cn(META_LINE, "mr-1 tabular-nums")} aria-live="polite">
              {range}
            </span>
            <Button
              icon
              variant="ghost"
              aria-label={previousLabel}
              disabled={span.first === 0}
              onClick={() => scrollTo(span.first - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <Button
              icon
              variant="ghost"
              aria-label={nextLabel}
              disabled={span.last >= count - 1}
              onClick={() => scrollTo(span.first + 1)}
            >
              <ChevronRight size={16} />
            </Button>
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
        className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-md pb-2 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400"
      >
        {items.map((item, i) => (
          <div
            key={isValidElement(item) && item.key !== null ? item.key : i}
            className="grid shrink-0 grid-cols-1 basis-[85%] snap-start @lg:basis-[calc(50%-0.375rem)]"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
