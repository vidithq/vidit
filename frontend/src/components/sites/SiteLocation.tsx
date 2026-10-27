"use client";

import { useMemo, type Ref } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { EventLocation } from "@/components/event/EventLocation";
import { DetailRow } from "@/components/ui/DetailRow";
import { formatInstantDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import { positionsBounds, zoneAreaKm2, zoneVertices } from "@/lib/siteZone";
import {
  contourBefore,
  contourOn,
  utcDay,
  zoneEmphasis,
  type Site,
  type SiteSource,
} from "@/lib/sites";

const SiteMap = dynamic(() => import("@/components/map/SiteMap"), { ssr: false });

/**
 * The site's Location block: the event page's `EventLocation` filled with the site map. It shows
 * the zone valid on the capture day of the source picked among the site's sources, the contour
 * before it dashed, and the linked events. With no contour yet on that day, the first contour
 * shows dashed and the Contour row says so. The coordinates are the current zone's centroid.
 */
export function SiteLocation({
  site,
  source,
  ref,
}: {
  site: Site;
  source: SiteSource | null;
  ref?: Ref<HTMLDivElement>;
}) {
  const router = useRouter();
  const day = source?.captured_at ? utcDay(source.captured_at) : null;
  const contour = day ? contourOn(site.contours, day) : null;
  const first = site.contours[0] ?? null;
  const previous = contour ? contourBefore(site.contours, contour) : null;
  const reference = contour ? previous : first;
  const drawnOn = contour && site.sources.find((s) => s.id === contour.source_id);
  const legend = [
    reference &&
      `Dashed: ${contour ? "the contour before it" : "the first contour"}, from ${formatInstantDate(reference.captured_at)}`,
    site.linked_events.some((e) => !e.inside_zone) && "Dotted: a linked event outside the zone of its date",
    site.linked_events.some((e) => e.measured_contour_id !== contour?.id) &&
      "Dimmed: an event measured against another contour",
  ].filter((line): line is string => typeof line === "string");

  const bounds = useMemo(
    () =>
      positionsBounds([
        ...site.contours.flatMap((c) => zoneVertices(c.zone)),
        ...site.linked_events.map((e) => [e.coords.lng, e.coords.lat] as [number, number]),
      ]),
    [site],
  );

  return (
    <EventLocation
      ref={ref}
      coords={site.centroid}
      coordinatesConcept="site_coordinates"
      map={
        bounds && (
          <SiteMap
            zone={contour?.zone ?? null}
            previousZone={reference?.zone ?? null}
            contourId={contour?.id ?? null}
            contours={site.contours}
            emphasis={zoneEmphasis(site)}
            events={site.linked_events}
            bounds={bounds}
            onEventClick={(id) => router.push(eventHref(id))}
          />
        )
      }
      rows={
        <>
          <DetailRow label="Zone on" value={day ? formatInstantDate(day) : "No source yet"} />
          <DetailRow
            label="Contour"
            concept="site_zone"
            value={
              contour
                ? `${zoneAreaKm2(zoneVertices(contour.zone)).toFixed(2)} km², from the source of ${formatInstantDate(
                    drawnOn?.captured_at ?? contour.captured_at,
                  )}`
                : "None drawn yet on this date"
            }
          />
        </>
      }
      footer={legend}
    />
  );
}
