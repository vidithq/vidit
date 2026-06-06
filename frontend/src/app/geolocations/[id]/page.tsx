"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { GeolocationDetail } from "@/types";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { renderProof } from "@/lib/proof";
import SourceLabel from "@/components/ui/SourceLabel";
import TrustBadge from "@/components/profile/TrustBadge";
import ShareButtons from "@/components/geolocation/ShareButtons";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { TAG_CHIP } from "@/components/ui/styles";

const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

export default function GeolocationPage() {
  const params = useParams();
  const [geo, setGeo] = useState<GeolocationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.id) {
      apiFetch<GeolocationDetail>(`/geolocations/${params.id}`)
        .then(setGeo)
        .catch((e) => setError(e.message));
    }
  }, [params.id]);

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
        {/* Media */}
        <div>
          <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Media
          </h2>
          {geo.media.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {geo.media.map((m) => (
                <div
                  key={m.id}
                  className="relative h-48 rounded-lg overflow-hidden border border-neutral-700 bg-neutral-900"
                >
                  {m.media_type === "image" ? (
                    // Detail-page gallery cards render at ~384 CSS
                    // px wide (sm:grid-cols-2 inside max-w-4xl).
                    // ``hero`` (max-dim 1280) covers a 2x-DPI fetch
                    // sharply without paying for the original's
                    // multi-megabyte payload on every page open.
                    <Image
                      src={displayUrlsFor(m).hero}
                      alt={geo.title}
                      fill
                      sizes="(min-width: 768px) 384px, 100vw"
                      className="object-cover"
                    />
                  ) : (
                    <video
                      src={m.storage_url}
                      controls
                      className="w-full h-48 object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-700 bg-neutral-800 h-48 flex items-center justify-center">
              <span className="text-sm text-neutral-500">
                No media available
              </span>
            </div>
          )}
        </div>

        {/* Map */}
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

        {/* Details — key-value */}
        <div>
          <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Details
          </h2>
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 divide-y divide-neutral-800">
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Event date</span>
              <span className="text-sm text-neutral-200">{formatDate(geo.event_date)}</span>
            </div>
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Coordinates</span>
              <span className="text-sm text-neutral-200 font-mono">
                {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
              </span>
            </div>
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Source</span>
              <SourceLabel
                isDemo={geo.is_demo}
                url={geo.source_url}
                variant="link"
                maxWidthClass="max-w-[300px]"
                className="text-sm ml-4"
              />
            </div>
            {geo.tags.length > 0 && (
              <div className="flex justify-between items-start px-4 py-3">
                <span className="text-sm text-neutral-500">Tags</span>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {geo.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className={`text-xs px-2.5 py-0.5 rounded-full ${TAG_CHIP}`}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Submitted</span>
              <span className="text-sm text-neutral-200">
                {formatDate(geo.created_at)}
              </span>
            </div>
            {geo.originated_from_bounty && (
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-neutral-500">Bounty</span>
                <Link
                  href={`/bounties/${geo.originated_from_bounty.id}`}
                  className="text-sm text-orange-400 hover:underline truncate ml-4 max-w-[300px]"
                >
                  {geo.originated_from_bounty.title}
                </Link>
              </div>
            )}
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Author</span>
              <span className="text-sm inline-flex items-center gap-1.5">
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
            </div>
          </div>
        </div>

        {/* Proof */}
        <div>
          <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Proof
          </h2>
          <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-700">
            {geo.proof ? (
              <div className="text-sm text-neutral-300 leading-relaxed">
                {renderProof(geo.proof)}
              </div>
            ) : (
              <p className="text-sm text-neutral-500 italic">
                No proof provided
              </p>
            )}
          </div>
        </div>
    </PageShell>
  );
}
