import type { ReactNode } from "react";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";

import type { Media } from "@/types";
import { formatDate } from "@/lib/format";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { MediaThumb } from "@/components/ui/MediaThumb";
import { TagBadge } from "@/components/ui/TagBadge";
import { Avatar } from "@/components/ui/Avatar";
import MediaPlaceholder from "@/components/ui/MediaPlaceholder";
import SourceLabel from "@/components/ui/SourceLabel";

// One card for every catalogue entity (submitted / detected geolocation,
// bounty), in either layout. The two surfaces had drifted into three separate
// components with three click models; this is the single, data-driven card.
//
// - Click model is uniform: the whole card navigates to `detailHref` via a
//   stretched link. Interactive children (the author byline, the `actions`
//   slot) sit above it (`relative z-20`) and stay independently clickable.
//   No nested <a>.
// - It renders the slots that carry data; an entity without `coords` (a bounty)
//   or without `working` (a geolocation) simply omits that bit. No `kind` flag.
// - `media` shows a real thumbnail (`MediaThumb`); `mediaSeed` shows a generated
//   `MediaPlaceholder` (the geolocation list cards have no real media payload).

interface EntityCardProps {
  detailHref: string;
  /** Plain text, or a highlighted node in search results. */
  title: ReactNode;
  /** Accessible name for the stretched link (the title as a plain string). */
  titleText: string;
  /** A rendered status pill: `<StatusBadge>` or `<BountyStatusBadge>`. */
  badge?: ReactNode;
  media?: Media;
  mediaSeed?: string;
  author?: { username: string } | null;
  date?: string;
  coords?: { lat: number; lng: number } | null;
  source?: { url: string; isDemo: boolean };
  working?: number;
  tags?: { id: string; name: string }[];
  /** Edit / delete controls (the detections queue). Kept clickable above the
   *  stretched link. */
  actions?: ReactNode;
  variant?: "feed" | "compact";
  /** Skip the author byline (e.g. on the author's own profile). */
  hideAuthor?: boolean;
}

function formatCoord(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${latDir}, ${Math.abs(lng).toFixed(3)}°${lngDir}`;
}

function CoordsMeta({ coords }: { coords: { lat: number; lng: number } }) {
  return (
    <span className="inline-flex items-center gap-1">
      <MapPin size={10} />
      {formatCoord(coords.lat, coords.lng)}
    </span>
  );
}

function WorkingMeta({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-neutral-400">
      <Users size={10} />
      {count} working
    </span>
  );
}

// The author link is interactive (-> profile), so it sits above the stretched
// link.
function AuthorLink({ username }: { username: string }) {
  return (
    <Link
      href={`/profile/${username}`}
      className="relative z-20 text-orange-400 font-medium hover:underline"
    >
      @{username}
    </Link>
  );
}

const SHELL =
  "relative flex gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md";

export function EntityCard({
  detailHref,
  title,
  titleText,
  badge,
  media,
  mediaSeed,
  author,
  date,
  coords,
  source,
  working,
  tags,
  actions,
  variant = "compact",
  hideAuthor = false,
}: EntityCardProps) {
  const showAuthor = !hideAuthor && author?.username;
  const stretched = (
    <Link
      href={detailHref}
      aria-label={titleText}
      className="absolute inset-0 z-10 rounded-[inherit]"
    />
  );
  const thumb = media ? (
    <MediaThumb media={media} />
  ) : mediaSeed ? (
    <div className="relative w-28 aspect-video rounded-md overflow-hidden bg-neutral-800 shrink-0">
      <MediaPlaceholder seed={mediaSeed} />
    </div>
  ) : null;

  if (variant === "feed") {
    return (
      <article className={`${SHELL} flex-col gap-3 ${TAPPABLE_HOVER}`}>
        {stretched}
        {showAuthor && (
          <div className="relative z-20 flex items-center gap-2.5 text-xs w-fit">
            <Link href={`/profile/${author!.username}`}>
              <Avatar username={author!.username} size="size-7" />
            </Link>
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] text-neutral-500">
                by <AuthorLink username={author!.username} />
              </span>
              <span className="text-[11px] text-neutral-500 inline-flex items-center gap-2">
                {date && formatDate(date)}
                {coords && <CoordsMeta coords={coords} />}
              </span>
            </div>
          </div>
        )}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-100">{title}</h2>
          {(media || mediaSeed) && (
            <div className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800">
              {media ? (
                <MediaThumb media={media} className="absolute inset-0 w-full h-full" />
              ) : (
                <MediaPlaceholder seed={mediaSeed!} />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          {badge}
          {tags?.map((t) => (
            <TagBadge key={t.id} name={t.name} />
          ))}
        </div>
      </article>
    );
  }

  return (
    <div className={`${SHELL} ${TAPPABLE_HOVER}`}>
      {stretched}
      {thumb}
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3 className="text-sm font-medium text-neutral-100 line-clamp-2">
            {title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
            {showAuthor && (
              <span>
                by <AuthorLink username={author!.username} />
              </span>
            )}
            {date && <span>{formatDate(date)}</span>}
            {coords && <CoordsMeta coords={coords} />}
            {source && (
              <span className="relative z-20">
                <SourceLabel
                  isDemo={source.isDemo}
                  url={source.url}
                  variant="inline"
                />
              </span>
            )}
            {typeof working === "number" && working > 0 && (
              <WorkingMeta count={working} />
            )}
          </div>
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {tags.map((t) => (
                <TagBadge key={t.id} name={t.name} />
              ))}
            </div>
          )}
          {actions && <div className="relative z-20 pt-0.5">{actions}</div>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
    </div>
  );
}
