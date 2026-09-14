"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo } from "react";

import { pointsBounds } from "@/components/map/bounds";
import { DetailSidePanel } from "@/components/map/DetailSidePanel";
import { ReaderHeader } from "@/components/collections/ReaderHeader";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useApiResource } from "@/hooks/useApiResource";
import { collectionPoints, eventCountLabel } from "@/lib/collections";
import type { EventDetail, EventListItem } from "@/types";

// The same dynamic import every other map surface takes: MapLibre touches
// `window` at module scope, so it never server-renders.
const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/** True for a target that owns its own arrow keys: a field being typed into,
 *  a select being walked, or an editable box. The step keys are a reading
 *  shortcut, and a shortcut never takes a caret away from what it is doing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The collection's Coverage card, stepped: the whole set on the map, one item
 * at a time in the panel beside it.
 *
 * It is the map page's own two surfaces, rearranged around a position rather
 * than around a selection. The map is the shared [`<Map>`](../map/Map.tsx)
 * over the items' pins, framed on the whole set on open and flying to the
 * current item on every step, with the steps already walked dimmed. The panel
 * is the map's own `DetailSidePanel`, which fetches nothing and renders the
 * event handed to it, under a header saying where in the collection the reader
 * stands and how to move.
 *
 * **The two sit side by side rather than one over the other.** The panel is
 * 384px wide and caps its height against the viewport, both of which are
 * answers about a full-screen canvas: inside a card it would cover most of the
 * block at `sm` and run past its bottom edge, and below `sm` the same panel is
 * a sheet pinned to the viewport, which is wrong on a page that scrolls. So
 * the card holds a two-column block whose columns stack below `sm`, and the
 * panel takes its `inline` placement, where it is a column of the page with no
 * insets, no sheet and no cap of its own. The block's height is the card's one
 * fixed figure from `sm` up, held under the map page's own panel cap so a
 * short laptop window never has to scroll the page to see the bottom of it.
 *
 * Nothing here is the owner's: `DetailSidePanel` takes no action tier on any
 * surface, so the player shows every reader the same panel.
 *
 * The step itself belongs to the caller, which keeps it in the URL: the step
 * is the share unit, and a component that held it in state would make a shared
 * link open somewhere else.
 */
export function CollectionReader({
  items,
  step,
  onStep,
}: {
  /** The collection's items, in the order they happened. */
  items: EventListItem[];
  /** Which item is being read, 1-based and already clamped into `items`. */
  step: number;
  onStep: (step: number) => void;
}) {
  const total = items.length;
  const current = items[step - 1];
  const currentId = current?.id ?? null;

  // The panel's event, read the way every other page reads one row. The hook
  // aborts the request in flight when the reader steps again, so a slow event
  // can never land on top of the one the reader moved to.
  const { data: detail, loading } = useApiResource<EventDetail>(
    currentId ? `/events/${currentId}` : null,
  );

  const points = useMemo(() => collectionPoints(items), [items]);
  // The opening camera: the whole sequence, so the reader sees the shape of
  // what they are about to walk before the first step moves them into it.
  const bounds = useMemo(() => pointsBounds(points), [points]);

  // The steps behind the reader. Ids rather than indices, since the map knows
  // the set by id.
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

  // The arrow keys step. They are read on the window, since the reader's own
  // focus may be anywhere on the page (or nowhere), and skipped while a field
  // has the caret or a modifier is held, where the same press means something
  // else to the browser or to the field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      const next = event.key === "ArrowLeft" ? step - 1 : step + 1;
      if (next < 1 || next > total) return;
      event.preventDefault();
      onStep(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, total, onStep]);

  return (
    <Card as="section">
      <div className="flex items-center justify-between gap-3">
        <SectionEyebrow title="Coverage" margin="none" />
        <span className="text-xs text-neutral-500">
          {eventCountLabel(points.length)} on the map
        </span>
      </div>

      {/* One fixed height for the block from `sm` up, under the map page's own
          panel cap: 32rem is a real canvas beside a readable column, and the
          cap keeps the whole block on screen in a short window. Below `sm` the
          columns stack and each takes its own height, the map fixed like every
          other embedded map and the panel as long as its event. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:h-[32rem] sm:max-h-[calc(100dvh-4.5rem)]">
        {/* A set with no mappable point renders no map at all, the rule the
            profile's own coverage map keeps: an empty world map says less than
            no map, and the panel and the list below say the rest. */}
        {bounds && (
          // `sm:flex-1` and not `flex-1`: while the columns are stacked the
          // flex axis is vertical, and a basis of 0 there collapses the map to
          // a line instead of leaving it the height it was given.
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
          // Keyed by event, the map page's own rule: a remount is what starts
          // every piece of per-event state inside the panel clean, and here it
          // also puts a long event back at its top when the reader steps.
          key={currentId ?? "empty"}
          placement="inline"
          detail={detail}
          loading={loading}
          header={<ReaderHeader step={step} total={total} onStep={onStep} />}
        />
      </div>
    </Card>
  );
}
