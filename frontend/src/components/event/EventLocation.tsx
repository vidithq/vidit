"use client";

import dynamic from "next/dynamic";

import type { EventDetail } from "@/types";
import { EVENT_FIELDS } from "@/lib/events";
import { CoordinateValue } from "@/components/event/CoordinateActions";
import type { EventSlot } from "@/components/event/EventLayout";
import { DetailRow } from "@/components/ui/DetailRow";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * The Location slot of the event and version pages: the map with its coordinates row, or null for
 * a coordless event (a `requested` row served by id). It takes a view, not an id, so the live row
 * and a filed version (fed by `snapshotToEventView`) render the same module.
 */
export function eventLocation(geo: EventDetail): EventSlot | null {
  return geo.coords ? { content: <EventLocation geo={geo} coords={geo.coords} /> } : null;
}

/** The Location module: the map with its coordinates row fused to its foot. */
function EventLocation({
  geo,
  coords,
}: {
  geo: EventDetail;
  coords: NonNullable<EventDetail["coords"]>;
}) {
  return (
    <>
      {/* Map and coordinates are one module: the coords read as a Details-style row fused to the map's
          bottom (mirrors the submit form's Location section). `overflow-hidden` sits on the map alone,
          to clip its rounded corners, since the whole module would clip the coordinate row's `?` tooltip. */}
      <div className="rounded-lg border border-neutral-700">
        <div className="h-56 overflow-hidden rounded-t-lg">
          {/* Single-point map reads [id, lat, lng] plus the detected flag (marker colours match the app); the
              two date slots are inert, so empty strings. */}
          <Map
            points={[
              [
                geo.id,
                coords.lat,
                coords.lng,
                "",
                "",
                geo.status === "detected" ? 1 : 0,
              ],
            ]}
            center={{ lat: coords.lat, lng: coords.lng }}
            zoom={12}
            embedded
          />
        </div>
        <DetailRow
          {...EVENT_FIELDS.coordinates}
          align="center"
          wrapLabel
          className="border-t border-neutral-800 bg-neutral-900 rounded-b-lg"
        >
          <CoordinateValue lat={coords.lat} lng={coords.lng} />
        </DetailRow>
      </div>
    </>
  );
}
