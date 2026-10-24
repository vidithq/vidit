"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";

import type { EventDetail } from "@/types";
import { CoordinateValue } from "@/components/event/CoordinateActions";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/**
 * The full-page render of one event: the shared `EventDetailBody`, with the page's Location module
 * and then `approvalRequests` at the top of its side column. It takes a view, not an id, so the
 * same markup renders the live row on `/events/{id}` and a filed version on `/events/{id}/vN` (fed
 * by `snapshotToEventView`). The body writes nothing, so a version page needs no gate: the chrome
 * above carries every control that acts on the record, and the approvals.
 */
export function EventPageBody({
  geo,
  approvalRequests,
}: {
  geo: EventDetail;
  approvalRequests?: ReactNode;
}) {
  return (
    <EventDetailBody
      geo={geo}
      variant="page"
      side={
        <>
          <EventLocation geo={geo} />
          {approvalRequests}
        </>
      }
    />
  );
}

/** The Location module: the map with its coordinates row fused to its foot. A coordless event (a
 *  `requested` row served by id) has no point, so it renders nothing. */
function EventLocation({ geo }: { geo: EventDetail }) {
  if (!geo.coords) return null;
  return (
    <div>
      {/* Beside the sources scroller, whose header row is as tall as its 32px buttons, the heading
          takes a row of that height, so the map's top is level with the source blocks. */}
      {geo.sources.length > 1 ? (
        <div className="mb-3 flex h-8 items-center">
          <SectionEyebrow title="Location" concept="section_location" margin="none" />
        </div>
      ) : (
        <SectionEyebrow title="Location" concept="section_location" />
      )}
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
                geo.coords.lat,
                geo.coords.lng,
                "",
                "",
                geo.status === "detected" ? 1 : 0,
              ],
            ]}
            center={{ lat: geo.coords.lat, lng: geo.coords.lng }}
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
          <CoordinateValue lat={geo.coords.lat} lng={geo.coords.lng} />
        </DetailRow>
      </div>
    </div>
  );
}
