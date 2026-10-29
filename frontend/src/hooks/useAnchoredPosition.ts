"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";

const MARGIN = 8;
const GAP = 4;

type Placement = {
  top?: number;
  bottom?: number;
  left: number;
  width?: number;
  maxHeight?: number;
};
const KEYS = ["top", "bottom", "left", "width", "maxHeight"] as const;

interface AnchorOptions {
  align?: "start" | "end";
  matchWidth?: boolean;
  maxHeight?: number;
}

function place(
  anchor: DOMRect,
  floating: HTMLElement | null,
  { align = "start", matchWidth = false, maxHeight }: AnchorOptions,
): Placement {
  const { clientWidth, clientHeight } = document.documentElement;
  const width = matchWidth ? anchor.width : (floating?.offsetWidth ?? 0);
  const measured = floating?.offsetHeight ?? 0;
  const topEdge = Math.max(anchor.bottom + GAP, MARGIN);
  const bottomEdge = Math.min(anchor.top - GAP, clientHeight - MARGIN);
  const below = clientHeight - MARGIN - topEdge;
  const above = bottomEdge - MARGIN;
  const up = below < (maxHeight ?? measured) && above > below;
  const height =
    maxHeight === undefined ? measured : Math.max(0, Math.min(maxHeight, up ? above : below));
  const left = align === "end" ? anchor.right - width : anchor.left;
  return {
    left: Math.max(MARGIN, Math.min(left, clientWidth - MARGIN - width)),
    ...(up
      ? {
          bottom:
            clientHeight - Math.min(clientHeight - MARGIN, Math.max(bottomEdge, MARGIN + height)),
        }
      : { top: Math.max(MARGIN, Math.min(topEdge, clientHeight - MARGIN - height)) }),
    ...(matchWidth && { width }),
    ...(maxHeight !== undefined && { maxHeight: height }),
  };
}

/**
 * The fixed-position style of a floating element anchored to `anchorRef`, for a portal that an
 * `overflow` ancestor must not clip. It opens below the anchor, or above it when the room below is
 * short and the room above larger, starts at the anchor's left edge or with `align="end"` ends at
 * its right edge, and stays 8px inside the viewport. `matchWidth` spans the anchor's width;
 * `maxHeight` caps the height at the room on the chosen side, and the side is chosen against the
 * cap rather than the measured height, so a list that grows as it filters does not flip.
 *
 * Measured on every frame while open, since the anchor moves without a scroll or a resize event
 * when the page shifts around it. Undefined until measured for each opening, which also keeps a
 * portal out of the server render. The object stays the same while the numbers do.
 */
export function useAnchoredPosition({
  open,
  anchorRef,
  floatingRef,
  align,
  matchWidth,
  maxHeight,
}: AnchorOptions & {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  floatingRef?: RefObject<HTMLElement | null>;
}): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) return;
    let last: Placement | undefined;
    let frame = 0;
    const update = (commit: (apply: () => void) => void) => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const next = place(anchor.getBoundingClientRect(), floatingRef?.current ?? null, {
        align,
        matchWidth,
        maxHeight,
      });
      const prev = last;
      if (prev && KEYS.every((key) => prev[key] === next[key])) return;
      last = next;
      commit(() => setStyle({ position: "fixed", ...next }));
    };
    update((apply) => apply());
    // Flushed at once, so a follow paints in the frame it was measured in, not one frame late.
    const follow = () => {
      update(flushSync);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      setStyle(undefined);
    };
  }, [open, anchorRef, floatingRef, align, matchWidth, maxHeight]);

  return style;
}
