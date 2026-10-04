"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { pointsBounds } from "@/components/map/bounds";
import { DetailSidePanel } from "@/components/map/DetailSidePanel";
import { ReaderHeader } from "@/components/collections/ReaderHeader";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useApiResource } from "@/hooks/useApiResource";
import { collectionPoints, eventCountLabel } from "@/lib/collections";
import type { EventDetail, EventListItem } from "@/types";

// MapLibre touches `window` at module scope, so it never server-renders.
const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/** True for a target that owns its arrow keys (a field, a select, an editable
 *  box): the step shortcut never takes a caret away. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The collection's Coverage card, stepped: the whole set on the map, one item at
 * a time in the panel beside it.
 *
 * The map is the shared `<Map>` over the items' pins, framed on the whole set
 * on open and flying to the current item on each step, walked steps dimmed. The
 * panel is the map's `DetailSidePanel`, which renders the event handed to it
 * under a header saying where the reader stands.
 *
 * **Side by side.** The panel's 384px width and viewport-relative height cap
 * suit a full-screen canvas, and below `sm` it is a viewport-pinned sheet. So
 * the card holds a two-column block (stacked below `sm`) and the panel takes its
 * `inline` placement. The block's height is fixed from `sm` up, under the map
 * page's panel cap.
 *
 * The step lives in the caller's URL (the step is the share unit). The arrow
 * keys keep their own cursor over it, so a held key walks the collection
 * without waiting on the URL round trip.
 */
export function CollectionReader({
  items,
  step,
  onStep,
}: {
  items: EventListItem[];
  /** 1-based, already clamped into `items`. */
  step: number;
  onStep: (step: number) => void;
}) {
  const total = items.length;
  const current = items[step - 1];
  const currentId = current?.id ?? null;

  // The hook aborts the request in flight on the next step.
  const detail = useApiResource<EventDetail>(
    currentId ? `/events/${currentId}` : null,
  );

  const points = useMemo(() => collectionPoints(items), [items]);
  // The opening camera: the whole sequence.
  const bounds = useMemo(() => pointsBounds(points), [points]);

  // Ids, since the map knows the set by id.
  const walkedIds = useMemo(
    () => new Set(items.slice(0, step - 1).map((item) => item.id)),
    [items, step],
  );

  const flyTo = current?.event_coords ?? null;

  const jumpToId = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) onStep(index + 1);
    },
    [items, onStep],
  );

  // The step plus presses not yet in the URL. A held arrow repeats faster than
  // the router's `replace`, so counting from `step` would walk one step however
  // long the key is held. Re-synced from the prop on every step that lands.
  const walked = useRef(step);
  useEffect(() => {
    walked.current = step;
  }, [step]);

  // Read on the window (focus may be anywhere); skipped while a field has the
  // caret or a modifier is held.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      const next = walked.current + (event.key === "ArrowLeft" ? -1 : 1);
      // At either end the press goes back to the browser.
      if (next < 1 || next > total) return;
      event.preventDefault();
      walked.current = next;
      onStep(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [total, onStep]);

  return (
    <Card as="section">
      <div className="flex items-center justify-between gap-3">
        <SectionEyebrow title="Coverage" margin="none" />
        <span className="text-xs text-neutral-500">
          {eventCountLabel(points.length)} on the map
        </span>
      </div>

      {/* Fixed height from `sm` up (32rem, capped to stay on screen in a short
          window); stacked below `sm`, each column takes its own height. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:h-[32rem] sm:max-h-[calc(100dvh-4.5rem)]">
        {/* No mappable point, no map (as on the profile's coverage map). */}
        {bounds && (
          // `sm:flex-1`, not `flex-1`: stacked, the axis is vertical and a basis
          // of 0 would collapse the map to a line.
          <div className="h-64 sm:h-full min-w-0 sm:flex-1 overflow-hidden rounded-lg border border-neutral-700">
            <Map
              points={points}
              selectedId={currentId}
              dimmedIds={walkedIds}
              flyTo={flyTo}
              fitBounds={bounds}
              onPointClick={jumpToId}
              embedded
            />
          </div>
        )}

        <DetailSidePanel
          // Keyed by event: a remount resets per-event state and scrolls to top.
          key={currentId ?? "empty"}
          placement="inline"
          resource={detail}
          header={<ReaderHeader step={step} total={total} onStep={onStep} />}
        />
      </div>
    </Card>
  );
}
