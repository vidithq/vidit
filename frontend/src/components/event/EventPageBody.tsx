"use client";

import dynamic from "next/dynamic";

import type { EventDetail } from "@/types";
import { formatCoordinates } from "@/lib/coordinates";
import { CoordinateActions } from "@/components/event/CoordinateActions";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * The full-page render of one event: the shared `EventDetailBody` plus the
 * Location module the page owns.
 *
 * It takes a view rather than an id, so the same markup renders the live row on
 * `/events/{id}` and a filed version on `/events/{id}/vN`, which is fed the same
 * shape by `snapshotToEventView`. The body writes nothing, so a version page
 * needs no gate here: the page chrome above it carries every control that acts
 * on the record, which is what lets a version page drop them without touching
 * this.
 */
export function EventPageBody({ geo }: { geo: EventDetail }) {
  return (
    <EventDetailBody geo={geo} variant="page">
      {/* A located row (``geolocated`` / ``detected`` with coords) gets the
          Location module; a coordless event (a ``requested`` row served here
          by id) has no point, so the block is omitted. */}
      {geo.event_coords && (
        <div>
          <SectionEyebrow title="Location" concept="section_location" />
          {/* Map + coordinates are one module: the coords read as a Details-
              style row fused to the bottom of the map (shared border, no gap),
              mirroring the submit form's Location section. `overflow-hidden`
              sits on the map alone (to clip its rounded top corners), not the
              whole module, which would clip the coordinate row's `?` tooltip. */}
          <div className="rounded-lg border border-neutral-700">
            <div className="h-64 overflow-hidden rounded-t-lg">
              {/* Single-point map reads [id, lat, lng] + the detected flag
                  (so the marker colours match the rest of the app); the two
                  date slots are inert here, so pass empty strings. */}
              <Map
                points={[
                  [
                    geo.id,
                    geo.event_coords.lat,
                    geo.event_coords.lng,
                    "",
                    "",
                    geo.status === "detected" ? 1 : 0,
                  ],
                ]}
                center={{ lat: geo.event_coords.lat, lng: geo.event_coords.lng }}
                zoom={12}
              />
            </div>
            <DetailRow
              label="Coordinates"
              concept="coordinates"
              align="center"
              className="border-t border-neutral-800 bg-neutral-900 rounded-b-lg"
            >
              {/* The pair plus its two icon buttons is wider than the row on a
                  narrow phone, so the group wraps and the actions take a
                  second line under the coordinates rather than pushing the
                  page sideways. `min-w-0` lets this flex item shrink below
                  its content width, which is what makes the wrap happen at
                  all instead of the row growing past the frame, and
                  `justify-end` keeps the wrapped line flush right like the
                  tag rows above. */}
              <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 min-w-0">
                <span className="text-sm text-neutral-200 font-mono">
                  {formatCoordinates(geo.event_coords.lat, geo.event_coords.lng)}
                </span>
                <CoordinateActions
                  lat={geo.event_coords.lat}
                  lng={geo.event_coords.lng}
                />
              </span>
            </DetailRow>
          </div>
        </div>
      )}
    </EventDetailBody>
  );
}
