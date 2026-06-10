"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { GeolocationDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import TrustBadge from "@/components/profile/TrustBadge";
import ShareButtons from "@/components/geolocation/ShareButtons";
import { GeolocationDetailBody } from "@/components/geolocation/GeolocationDetailBody";
import { PageCenter, PageShell } from "@/components/ui/PageShell";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function GeolocationPage() {
  const params = useParams();
  const { data: geo, error } = useApiResource<GeolocationDetail>(
    typeof params.id === "string" ? `/geolocations/${params.id}` : null
  );

  if (error)
    return (
      <PageCenter>
        <span className="text-red-400">{error}</span>
      </PageCenter>
    );
  if (!geo)
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );

  return (
    <PageShell
      back
      title={geo.title}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          by{" "}
          <Link
            href={`/profile/${geo.author.username}`}
            className="text-orange-400 hover:underline transition-colors"
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
        />
      }
    >
        <GeolocationDetailBody geo={geo} variant="page">
          <div>
            <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
              Location
            </h2>
            <div className="h-64 rounded-lg overflow-hidden border border-neutral-700">
              <Map
                points={[[geo.id, geo.lat, geo.lng]]}
                center={{ lat: geo.lat, lng: geo.lng }}
                zoom={12}
              />
            </div>
          </div>
        </GeolocationDetailBody>
    </PageShell>
  );
}
