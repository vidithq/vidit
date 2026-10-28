"use client";

import type { ReactNode, Ref } from "react";
import dynamic from "next/dynamic";

import type { EventDetail } from "@/types";
import type { Concept } from "@/lib/fieldHelp";
import { EVENT_FIELDS } from "@/lib/events";
import { CoordinateValue } from "@/components/event/CoordinateActions";
import type { EventSlot } from "@/components/event/EventLayout";
import { DetailRow } from "@/components/ui/DetailRow";
import { META_LINE } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

const PointMap = dynamic(() => import("@/components/map/PointMap"), { ssr: false });

/**
 * The Location slot of the event and version pages: the map with its coordinates row, or null
 * for a row without coordinates. It takes a view, not an id, so the live row and a filed version
 * (fed by `snapshotToEventView`) render the same module.
 */
export function eventLocation(geo: EventDetail): EventSlot | null {
  const coords = geo.coords;
  if (!coords) return null;
  return {
    content: (
      <EventLocation
        coords={coords}
        map={<PointMap point={coords} id={geo.id} detected={geo.status === "detected"} />}
      />
    ),
  };
}

/**
 * The Location module: a map with its coordinates row fused to its foot. The event page passes
 * its single pin; the site page passes its zone map, more `rows` under the coordinates and its
 * map legend as `footer` lines. A collection passes its coverage map, with the coordinates of the
 * event it stands on, if any, and no foot at all on its forms. A `header` sits above the map: the
 * event forms' coordinate inputs, the go-to-coordinates field of a site source form.
 */
export function EventLocation({
  map,
  header,
  coords,
  coordinatesConcept = EVENT_FIELDS.coordinates.concept,
  rows,
  footer = [],
  ref,
}: {
  map: ReactNode;
  header?: ReactNode;
  coords?: { lat: number; lng: number } | null;
  /** The coordinates row's `?`, when the pair is not an event's subject (a site's centroid). */
  coordinatesConcept?: Concept;
  rows?: ReactNode;
  footer?: string[];
  ref?: Ref<HTMLDivElement>;
}) {
  const foot = !!coords || !!rows || footer.length > 0;
  return (
    // `overflow-hidden` sits on the map alone, to clip its rounded corners, since the whole module
    // would clip the rows' `?` tooltips.
    <div ref={ref} className="scroll-mt-20 rounded-lg border border-neutral-700">
      {header && (
        <div className="space-y-1.5 rounded-t-lg border-b border-neutral-800 bg-neutral-900 p-4">
          {header}
        </div>
      )}
      <div
        className={cn("h-56 overflow-hidden", !header && "rounded-t-lg", !foot && "rounded-b-lg")}
      >
        {map}
      </div>
      {foot && (
        <div className="divide-y divide-neutral-800 rounded-b-lg border-t border-neutral-800 bg-neutral-900">
          {coords && (
            <DetailRow
              label={EVENT_FIELDS.coordinates.label}
              concept={coordinatesConcept}
              align="center"
              wrapLabel
            >
              <CoordinateValue lat={coords.lat} lng={coords.lng} />
            </DetailRow>
          )}
          {rows}
          {footer.length > 0 && (
            <p className={`${META_LINE} flex-wrap gap-x-3 px-4 py-2.5`}>
              {footer.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
