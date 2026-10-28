"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { EventLocation } from "@/components/event/EventLocation";
import { pointsBounds } from "@/components/map/bounds";
import { Button } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { collectionPoints, type PickableEvent } from "@/lib/collections";
import { eventHref } from "@/lib/routes";
import type { EventListItem } from "@/types";

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
 * The collection page's Coverage section, stepped: the whole set on the map, the item the reader
 * stands on lit, and under the map its coordinates, its title linking to the event, where the
 * reader stands and the two moves. It is the event page's Location module (`EventLocation`).
 *
 * The map frames the whole set on open and flies to the current item on each step, walked steps
 * dimmed. A set with no mappable point renders no section.
 *
 * The step lives in the caller's URL (the step is the share unit). The arrow keys keep their own
 * cursor over it, so a held key walks the collection without waiting on the URL round trip.
 */
export function CollectionCoverage({
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

  const points = useMemo(() => collectionPoints(items), [items]);
  const bounds = useMemo(() => pointsBounds(points), [points]);
  const walkedIds = useMemo(
    () => new Set(items.slice(0, step - 1).map((item) => item.id)),
    [items, step],
  );

  const jumpToId = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) onStep(index + 1);
    },
    [items, onStep],
  );

  // The step plus presses not yet in the URL. A held arrow repeats faster than the router's
  // `replace`, so counting from `step` would walk one step however long the key is held.
  const walked = useRef(step);
  useEffect(() => {
    walked.current = step;
  }, [step]);

  // Read on the window (focus may be anywhere); skipped while a field has the caret or a
  // modifier is held.
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

  if (!bounds || !current) return null;

  return (
    <section>
      <SectionEyebrow title="Coverage" />
      <EventLocation
        map={
          <Map
            points={points}
            selectedId={current.id}
            dimmedIds={walkedIds}
            flyTo={current.coords}
            fitBounds={bounds}
            onPointClick={jumpToId}
            embedded
          />
        }
        coords={current.coords}
        rows={
          <>
            <DetailRow label="Event" align="start">
              <Link href={eventHref(current.id)} className={cn("text-right text-sm", TEXT_LINK)}>
                {current.title}
              </Link>
            </DetailRow>
            <DetailRow
              align="center"
              label={
                <span>
                  <span className="block text-neutral-200">
                    {step} of {total}
                  </span>
                  {/* Hidden below `sm`: no keyboard. */}
                  <span className="block text-[11px] max-sm:hidden">&larr; &rarr; to step</span>
                </span>
              }
            >
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  action="previous"
                  variant="ghost"
                  disabled={step <= 1}
                  onClick={() => onStep(step - 1)}
                  aria-keyshortcuts="ArrowLeft"
                >
                  Previous
                </Button>
                <Button
                  action="next"
                  variant="secondary"
                  disabled={step >= total}
                  onClick={() => onStep(step + 1)}
                  aria-keyshortcuts="ArrowRight"
                >
                  Next
                </Button>
              </span>
            </DetailRow>
          </>
        }
      />
    </section>
  );
}

/** A form's Coverage section: the events the save holds on the map, framed on the whole set. */
export function HeldCoverage({ events }: { events: PickableEvent[] }) {
  const points = useMemo(() => collectionPoints(events), [events]);
  const bounds = useMemo(() => pointsBounds(points), [points]);
  return (
    <section>
      <SectionEyebrow title="Coverage" />
      {bounds ? (
        <EventLocation map={<Map points={points} fitBounds={bounds} embedded />} />
      ) : (
        <EmptyState>The map shows the events you add.</EmptyState>
      )}
    </section>
  );
}
