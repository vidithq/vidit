"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import ShareButtons from "@/components/event/ShareButtons";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { DetailRow } from "@/components/ui/DetailRow";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function EventPage() {
  const params = useParams();
  const { data: geo, error } = useApiResource<EventDetail>(
    typeof params.id === "string" ? `/events/${params.id}` : null
  );

  if (error)
    return (
      <PageError message={error} />
    );
  if (!geo) return <PageLoading />;

  return (
    <PageShell
      back
      title={geo.title}
      subtitle={<AuthorByline author={geo.owner} />}
      actions={
        <ShareButtons
          id={geo.id}
          title={geo.title}
          author={geo.owner.username}
          eventDate={geo.event_date}
          lat={geo.event_coords?.lat ?? null}
          lng={geo.event_coords?.lng ?? null}
          status={geo.status}
        />
      }
    >
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
                      ],
                    ]}
                    center={{ lat: geo.event_coords.lat, lng: geo.event_coords.lng }}
                    zoom={12}
                  />
                </div>
                <DetailRow
                  label="Coordinates"
                  concept="coordinates"
                  className="border-t border-neutral-800 bg-neutral-900 rounded-b-lg"
                >
                  <span className="text-sm text-neutral-200 font-mono">
                    {geo.event_coords.lat.toFixed(6)}, {geo.event_coords.lng.toFixed(6)}
                  </span>
                </DetailRow>
              </div>
            </div>
          )}
        </EventDetailBody>
    </PageShell>
  );
}
