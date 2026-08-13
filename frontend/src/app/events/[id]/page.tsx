"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { formatCoordinates } from "@/lib/coordinates";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { CoordinateActions } from "@/components/event/CoordinateActions";
import ShareButtons from "@/components/event/ShareButtons";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { useReportEvent } from "@/components/event/useReportEvent";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { DetailRow } from "@/components/ui/DetailRow";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function EventPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const { data: geo, error } = useApiResource<EventDetail>(
    eventId ? `/events/${eventId}` : null
  );
  // Two nodes from one state machine: the red trigger joins the share row in
  // the header, the form opens under it. Called before the early returns, as
  // every hook here must be.
  const report = useReportEvent(eventId);

  if (error)
    return (
      <PageError message={error} />
    );
  if (!geo) return <PageLoading />;

  return (
    <PageShell
      back
      title={geo.title}
      subtitle={<AuthorByline author={geo.owner} avatar />}
      actions={
        <div className="flex items-center gap-1.5">
          <ShareButtons
            id={geo.id}
            title={geo.title}
            author={geo.owner.username}
            eventDate={geo.event_date}
            lat={geo.event_coords?.lat ?? null}
            lng={geo.event_coords?.lng ?? null}
            status={geo.status}
          />
          {report.trigger}
        </div>
      }
    >
        {/* Directly under the header, where the trigger that opened it is. */}
        {report.panel}

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
                  sits on the map alone (to clip its rounded top corners) — not the
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
                        geo.is_demo ? 1 : 0,
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
                  {/* The pair plus its two actions is wider than the row on a
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
    </PageShell>
  );
}
