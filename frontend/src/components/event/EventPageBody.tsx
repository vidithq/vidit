"use client";

import dynamic from "next/dynamic";

import type { EventDetail } from "@/types";
import { CoordinateValue } from "@/components/event/CoordinateActions";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * The full-page render of one event: the shared `EventDetailBody`, with the page's Location module
 * under Details in its side column. It takes a view, not an id, so the same markup renders the live
 * row on `/events/{id}` and a filed version on `/events/{id}/vN` (fed by `snapshotToEventView`). The body writes nothing, so a version page needs no gate: the chrome
 * above carries every control that acts on the record, and the approvals.
 */
export function EventPageBody({ geo }: { geo: EventDetail }) {
  // A coordless event (a `requested` row served by id) has no point, so no Location module.
  const location = geo.coords ? <EventLocation geo={geo} coords={geo.coords} /> : null;
  return <EventDetailBody geo={geo} variant="page" location={location} />;
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
    <div>
      <SectionEyebrow title="Location" concept="section_location" />
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
          label="Coordinates"
          concept="coordinates"
          align="center"
          className="border-t border-neutral-800 bg-neutral-900 rounded-b-lg"
        >
          <CoordinateValue lat={coords.lat} lng={coords.lng} />
        </DetailRow>
      </div>
    </div>
  );
}
