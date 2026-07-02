"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { GeolocationDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import TrustBadge from "@/components/profile/TrustBadge";
import ShareButtons from "@/components/geolocation/ShareButtons";
import { GeolocationDetailBody } from "@/components/geolocation/GeolocationDetailBody";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { DetailRow } from "@/components/ui/DetailRow";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function GeolocationPage() {
  const params = useParams();
  const { data: geo, error } = useApiResource<GeolocationDetail>(
    typeof params.id === "string" ? `/geolocations/${params.id}` : null
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
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          by{" "}
          <Link
            href={`/profile/${geo.author.username}`}
            className={`${TEXT_LINK}`}
          >
            {geo.author.username}
          </Link>
          <TrustBadge
            isTrusted={geo.author.is_trusted}
            trustReason={geo.author.trust_reason}
            size={14}
          />
        </span>
      }
      actions={
        <ShareButtons
          id={geo.id}
          title={geo.title}
          author={geo.author.username}
          eventDate={geo.event_date}
          lat={geo.lat}
          lng={geo.lng}
          status={geo.status}
        />
      }
    >
        <GeolocationDetailBody geo={geo} variant="page">
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
                    [geo.id, geo.lat, geo.lng, "", "", geo.status === "detected" ? 1 : 0],
                  ]}
                  center={{ lat: geo.lat, lng: geo.lng }}
                  zoom={12}
                />
              </div>
              <DetailRow
                label="Coordinates"
                concept="coordinates"
                className="border-t border-neutral-800 bg-neutral-900 rounded-b-lg"
              >
                <span className="text-sm text-neutral-200 font-mono">
                  {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
                </span>
              </DetailRow>
            </div>
          </div>
        </GeolocationDetailBody>
    </PageShell>
  );
}
