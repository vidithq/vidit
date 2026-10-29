"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Card } from "@/components/ui/Card";

// Hover-intent delay before a preview shows (and an event's detail fetch fires), so sweeping a
// dense field flashes nothing and sends no requests.
export const PREVIEW_INTENT_MS = 150;

// Gap (px) between the anchor and the card's near edge.
const ANCHOR_GAP_PX = 12;
const EDGE_MARGIN_PX = 8;

/** The hover preview card of the map, for an event pin and a site alike. Anchored in map-container
 * px and clamped after measuring so it stays inside the map: flips left when the right lacks room,
 * shifts vertically at the edges. `children` re-measure it when they change. */
export function MapPreviewCard({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxLeft = parent.clientWidth - w - EDGE_MARGIN_PX;
    const maxTop = parent.clientHeight - h - EDGE_MARGIN_PX;
    let left = x + ANCHOR_GAP_PX;
    if (left > maxLeft) left = x - w - ANCHOR_GAP_PX;
    left = Math.min(Math.max(left, EDGE_MARGIN_PX), Math.max(maxLeft, EDGE_MARGIN_PX));
    const top = Math.min(Math.max(y - 10, EDGE_MARGIN_PX), Math.max(maxTop, EDGE_MARGIN_PX));
    setPos({ left, top });
  }, [x, y, children]);

  return (
    // Above the detail and filter overlays (z-1000) so a preview near a panel edge stays readable.
    <div
      ref={ref}
      className="absolute z-[1100] w-max min-w-64 max-w-sm pointer-events-none"
      style={{
        left: pos?.left ?? x + ANCHOR_GAP_PX,
        top: pos?.top ?? y - 10,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <Card className="p-2.5 shadow-lg">{children}</Card>
    </div>
  );
}
