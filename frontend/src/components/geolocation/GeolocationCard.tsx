"use client";

import Link from "next/link";
import { ExternalLink, MapPin } from "lucide-react";
import StatusBadge from "@/components/geolocation/StatusBadge";
import MediaPlaceholder from "@/components/ui/MediaPlaceholder";
import { TAG_CHIP, TAPPABLE_HOVER } from "@/components/ui/styles";
import { formatDate } from "@/lib/format";
import type { GeolocationState } from "@/types";

interface GeolocationCardData {
  id: string;
  title: string;
  event_date: string;
  is_demo?: boolean;
  /** Optional so minimal card data (no lifecycle context) still type-checks;
   *  the badge only renders for ``detected``. */
  state?: GeolocationState;
  lat?: number | null;
  lng?: number | null;
  author?: { username: string } | null;
  tags: {
    id: string;
    name: string;
    category: "conflict" | "capture_source" | "free";
  }[];
}

function formatCoord(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${latDir}, ${Math.abs(lng).toFixed(3)}°${lngDir}`;
}

interface GeolocationCardProps {
  geo: GeolocationCardData;
  variant?: "feed" | "compact";
  /** When the card is already inside a section attributed to the author
   * (e.g. the author's own profile), skip the redundant "by @username". */
  hideAuthor?: boolean;
  /** Custom seed for MediaPlaceholder to avoid collisions across lists. */
  mediaSeed?: string;
}

function Byline({ username }: { username: string }) {
  return (
    <span className="text-[11px] text-neutral-500">
      by{" "}
      <Link
        href={`/profile/${username}`}
        className="text-orange-400 font-medium hover:underline"
      >
        @{username}
      </Link>
    </span>
  );
}

export default function GeolocationCard({
  geo,
  variant = "feed",
  hideAuthor = false,
  mediaSeed,
}: GeolocationCardProps) {
  const seed = mediaSeed ?? `geo-${geo.id}`;
  const conflictTags = geo.tags.filter((t) => t.category === "conflict");
  const captureSourceTags = geo.tags.filter(
    (t) => t.category === "capture_source"
  );
  const freeTags = geo.tags.filter((t) => t.category === "free");
  const showAuthor = !hideAuthor && geo.author?.username;
  const hasCoords = typeof geo.lat === "number" && typeof geo.lng === "number";
  const coords = hasCoords ? formatCoord(geo.lat!, geo.lng!) : null;

  if (variant === "compact") {
    return (
      <Link
        href={`/geolocations/${geo.id}`}
        className={`flex items-center gap-3 p-2 bg-neutral-800 border border-neutral-700 rounded-md group ${TAPPABLE_HOVER}`}
      >
        <div className="relative w-16 aspect-video rounded-md overflow-hidden bg-neutral-900 shrink-0">
          <MediaPlaceholder seed={seed} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-200 truncate group-hover:text-orange-400 transition-colors">
            {geo.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-[11px]">
            {geo.state && <StatusBadge state={geo.state} />}
            {conflictTags.slice(0, 1).map((t) => (
              <span
                key={t.id}
                className={`px-1.5 py-0.5 rounded-full ${TAG_CHIP}`}
              >
                {t.name}
              </span>
            ))}
            <span className="text-neutral-500">{formatDate(geo.event_date)}</span>
            {coords && (
              <span className="inline-flex items-center gap-1 text-neutral-500">
                <MapPin size={10} />
                {coords}
              </span>
            )}
            {showAuthor && <Byline username={geo.author!.username} />}
          </div>
        </div>
      </Link>
    );
  }

  // Feed variant has three separate click regions (byline, title+image,
  // "View detail"), so no `TAPPABLE_HOVER` on the outer article — its
  // click-anywhere hover signal would be a lie. The inner title-link
  // carries its own `group-hover:text-orange-400`.
  return (
    <article className="bg-neutral-900 rounded-lg border border-neutral-800 p-4 space-y-3">
      {showAuthor && (
        <div className="flex items-center gap-2.5 text-xs">
          <Link
            href={`/profile/${geo.author!.username}`}
            className="size-7 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-300 font-medium hover:bg-neutral-700 transition-colors"
          >
            {geo.author!.username[0].toUpperCase()}
          </Link>
          <div className="flex flex-col leading-tight">
            <Byline username={geo.author!.username} />
            <span className="text-[11px] text-neutral-500 inline-flex items-center gap-2">
              {formatDate(geo.event_date)}
              {coords && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={10} />
                  {coords}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <Link href={`/geolocations/${geo.id}`} className="block space-y-3 group">
        <h2 className="text-sm font-medium text-neutral-100 group-hover:text-orange-400 transition-colors">
          {geo.title}
        </h2>
        <div className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800">
          <MediaPlaceholder seed={seed} />
        </div>
      </Link>

      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {geo.state && <StatusBadge state={geo.state} />}
          {conflictTags.map((t) => (
            <span
              key={t.id}
              className={`px-1.5 py-0.5 rounded-full ${TAG_CHIP}`}
            >
              {t.name}
            </span>
          ))}
          {captureSourceTags.map((t) => (
            <span
              key={t.id}
              className={`px-1.5 py-0.5 rounded-full ${TAG_CHIP}`}
            >
              {t.name}
            </span>
          ))}
          {freeTags.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className={`px-1.5 py-0.5 rounded-full ${TAG_CHIP}`}
            >
              {t.name}
            </span>
          ))}
        </div>
        <Link
          href={`/geolocations/${geo.id}`}
          className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          View detail
          <ExternalLink size={11} />
        </Link>
      </div>
    </article>
  );
}
