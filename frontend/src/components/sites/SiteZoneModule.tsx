"use client";

import { forwardRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { DetailRow } from "@/components/ui/DetailRow";
import { META_LINE } from "@/components/ui/styles";
import { LatestEffectValue } from "./SiteFacts";
import { formatInstantDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import { positionsBounds, zoneAreaKm2, zoneVertices } from "@/lib/siteZone";
import {
  contourBefore,
  contourOn,
  utcDay,
  zoneEmphasis,
  type Site,
  type SiteImage,
} from "@/lib/sites";

const SiteMap = dynamic(() => import("@/components/map/SiteMap"), { ssr: false });

/**
 * The site's Zone module, the map with its caption fused to its foot like the event page's
 * Location module. It shows the zone valid on the capture day of the image picked in the
 * imagery history, the contour before it dashed, and the linked events. With no contour yet on
 * that day, the first contour shows dashed and the caption says so. The caption ends on the
 * latest linked event's effect, the one fact that colours the zone.
 */
export const SiteZoneModule = forwardRef<HTMLDivElement, { site: Site; image: SiteImage | null }>(
  function SiteZoneModule({ site, image }, ref) {
    const router = useRouter();
    const day = image?.captured_at ? utcDay(image.captured_at) : null;
    const contour = day ? contourOn(site.contours, day) : null;
    const first = site.contours[0] ?? null;
    const previous = contour ? contourBefore(site.contours, contour) : null;
    const reference = contour ? previous : first;
    const source = contour && site.images.find((i) => i.id === contour.image_id);
    const legend = [
      reference &&
        `Dashed: ${contour ? "the contour before it" : "the first contour"}, from ${formatInstantDate(reference.captured_at)}`,
      site.linked_events.some((e) => !e.inside_zone) && "Dotted: a linked event outside the zone",
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
      <div ref={ref} className="scroll-mt-20 rounded-lg border border-neutral-700">
        <div className="h-64 overflow-hidden rounded-t-lg">
          {bounds && (
            <SiteMap
              zone={contour?.zone ?? null}
              previousZone={reference?.zone ?? null}
              contourId={contour?.id ?? null}
              emphasis={zoneEmphasis(site)}
              events={site.linked_events}
              bounds={bounds}
              onEventClick={(id) => router.push(eventHref(id))}
            />
          )}
        </div>
        <div className="divide-y divide-neutral-800 rounded-b-lg border-t border-neutral-800 bg-neutral-900">
          <DetailRow label="Zone on" value={day ? formatInstantDate(day) : "No image yet"} />
          {contour ? (
            <DetailRow
              label="Contour"
              concept="site_zone"
              value={`${zoneAreaKm2(zoneVertices(contour.zone)).toFixed(2)} km², from the image of ${formatInstantDate(
                source?.captured_at ?? contour.captured_at,
              )}`}
            />
          ) : (
            <DetailRow label="Contour" concept="site_zone" value="None drawn yet on this date" />
          )}
          {site.latest_link_effect && (
            <DetailRow label="Latest effect" concept="link_effect" align="center">
              <LatestEffectValue effect={site.latest_link_effect} />
            </DetailRow>
          )}
          {legend.length > 0 && (
            <p className={`${META_LINE} flex-wrap gap-x-3 px-4 py-2.5`}>
              {legend.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          )}
        </div>
      </div>
    );
  },
);
