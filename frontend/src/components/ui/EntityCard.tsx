import type { ReactNode } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

import type { Media } from "@/types";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { displayUrlsFor, posterFrameUrl } from "@/lib/mediaUrls";
import { TAPPABLE_HOVER, TEXT_LINK } from "@/components/ui/styles";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { Pill } from "@/components/ui/Pill";
import { Avatar } from "@/components/ui/Avatar";
import { SourceLabel } from "@/components/ui/SourceLabel";

// One card for every catalogue entity (geolocated / detected geolocation,
// requested event), in either layout.
//
// - The whole card navigates to `detailHref` via a stretched link. The author
//   byline sits above it (`relative z-20`) and stays clickable. No nested <a>.
// - `onSelect` swaps that link for a stretched button, for a list whose rows
//   pick a position on the surface they sit on (the collection page's step
//   list). The title is plain text in this mode and `detailHref` renders
//   nowhere.
// - Slots without data are omitted (a request has no `coords`). No `kind` flag.

// The one fixed-ratio media slot on cards: the real media, else a marked "no
// media" box. Video shows its first frame via `posterFrameUrl` +
// `preload="metadata"`, `object-contain` so a portrait clip letterboxes.
// Consumers: this card, the map's pin preview, the detections queue row.
//
// `isGraphic` covers the picture (not the "no media" box) with the compact
// `GraphicContentGate`.
export function MediaThumb({
  media,
  size = "thumbnail",
  className,
  isGraphic = false,
}: {
  /** The kind picks the element; the role tells `displayUrlsFor` whether the
   *  picture has derivatives. */
  media?: Pick<Media, "storage_url" | "media_type" | "role">;
  /** Image derivative: 400 px `thumbnail` or 1280 px `hero`. Videos and proof
   *  images have none and ignore it. */
  size?: "thumbnail" | "hero";
  className?: string;
  isGraphic?: boolean;
}) {
  const picture = media ? (
    media.media_type === "image" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={displayUrlsFor(media)[size]}
        alt=""
        className="w-full h-full object-cover"
      />
    ) : (
      <video
        src={posterFrameUrl(media.storage_url)}
        className="w-full h-full object-contain"
        preload="metadata"
        playsInline
        muted
      />
    )
  ) : null;

  return (
    <div
      className={cn(
        // `self-start` keeps the aspect ratio in a stretch-aligned flex row.
        "relative w-28 aspect-video self-start rounded-md overflow-hidden bg-neutral-800 shrink-0",
        className,
      )}
    >
      {picture ? (
        // The compact gate lifts its reveal control above the stretched link.
        isGraphic ? (
          <GraphicContentGate variant="compact">{picture}</GraphicContentGate>
        ) : (
          picture
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
          no media
        </div>
      )}
    </div>
  );
}

// The stretched link needs a plain-string name: `title` doubles as it when a
// string, else `titleText` is required.
type TitleProps =
  | { title: string; titleText?: string }
  | { title: ReactNode; titleText: string };

interface EntityCardBaseProps {
  badge?: ReactNode;
  media?: Media;
  isGraphic?: boolean;
  /** Omitted on a surface that names one analyst once in its header (a
   *  collection's item list). */
  author?: { username: string };
  /** Fixed height floor so catalogue rows match whatever slots they fill. Off,
   *  the row stands on its media column and the text centres against it. */
  uniformHeight?: boolean;
  /** The row the surface currently stands on: accent border, marked current. */
  selected?: boolean;
  date?: string;
  coords?: { lat: number; lng: number } | null;
  /** `url` is null on a sourceless machine detection ("To confirm" label). */
  source?: { url: string | null };
  tags?: { id: string; name: string }[];
}

// The row control hangs in the compact row's badge column. The feed card has no
// such column, so the type refuses the prop there.
type VariantProps =
  | {
      variant?: "compact";
      /** A control that acts on this row rather than opening it. Renders above
       *  the stretched link, at the bottom of the badge's column. */
      action?: ReactNode;
    }
  | { variant: "feed"; action?: undefined };

// A card carries one gesture: `detailHref` for the link, `onSelect` for the
// button.
type SelectableProps =
  | { onSelect?: undefined; detailHref: string; selectLabel?: undefined }
  | {
      /** Picks this row instead of opening it. */
      onSelect: () => void;
      detailHref?: string;
      /** The button's name; the title already names the row. */
      selectLabel: string;
    };

type EntityCardProps = EntityCardBaseProps &
  TitleProps &
  SelectableProps &
  VariantProps;

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

function AuthorLink({ username }: { username: string }) {
  return (
    <Link
      href={`/profile/${username}`}
      className={`relative z-20 font-medium ${TEXT_LINK}`}
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
  isGraphic = false,
  author,
  action,
  onSelect,
  selectLabel,
  selected = false,
  date,
  coords,
  source,
  tags,
  uniformHeight = true,
  variant = "compact",
}: EntityCardProps) {
  const name = titleText ?? (typeof title === "string" ? title : undefined);
  const stretched = onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      aria-label={selectLabel}
      aria-current={selected ? "true" : undefined}
      className="absolute inset-0 z-10 rounded-[inherit]"
    />
  ) : (
    <Link
      href={detailHref}
      aria-label={name}
      className="absolute inset-0 z-10 rounded-[inherit]"
    />
  );
  const shell = cn(SHELL, selected && "border-orange-500/60");
  // Narrower on a phone, where the 112px slot plus the badge left the title no
  // width.
  const thumb = (
    <MediaThumb media={media} isGraphic={isGraphic} className="w-20 sm:w-28" />
  );

  if (variant === "feed") {
    return (
      <article className={cn(shell, "flex-col gap-3", TAPPABLE_HOVER)}>
        {stretched}
        {badge && <div className="absolute top-3 right-3 z-20">{badge}</div>}
        <div className="relative z-20 flex items-center gap-2.5 text-xs w-fit">
          {author && (
            <Link href={`/profile/${author.username}`}>
              <Avatar username={author.username} size="size-7" />
            </Link>
          )}
          <div className="flex flex-col leading-tight">
            {author && (
              <span className="text-[11px] text-neutral-500">
                by <AuthorLink username={author.username} />
              </span>
            )}
            <span className="text-[11px] text-neutral-500 inline-flex items-center gap-2">
              {date && formatDate(date)}
              {coords && <CoordsMeta coords={coords} />}
            </span>
          </div>
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-100">{title}</h2>
          <MediaThumb
            media={media}
            isGraphic={isGraphic}
            className="w-full border border-neutral-800"
          />
        </div>
        {tags && tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            {tags.map((t) => (
              <Pill key={t.id} tone="neutral">{t.name}</Pill>
            ))}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className={cn(shell, TAPPABLE_HOVER)}>
      {stretched}
      {thumb}
      {/* The badge drops under the text on a phone: beside it, the pill left
          the title no width. */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-2">
        {/* `uniformHeight` sets a min-height (dropped on a phone) and packs content
            to the top. Without it, text shorter than the media column centres
            against it. */}
        <div
          className={cn(
            "flex-1 min-w-0 flex flex-col gap-1.5",
            uniformHeight ? "sm:min-h-[5.75rem]" : "sm:justify-center",
          )}
        >
          <h3 className="text-sm font-medium text-neutral-100 line-clamp-2">
            {title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
            {author && (
              <span>
                by <AuthorLink username={author.username} />
              </span>
            )}
            {date && <span>{formatDate(date)}</span>}
            {coords && <CoordsMeta coords={coords} />}
            {source && (
              <span className="relative z-20">
                <SourceLabel url={source.url} variant="inline" />
              </span>
            )}
          </div>
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {tags.map((t) => (
                <Pill key={t.id} tone="neutral">{t.name}</Pill>
              ))}
            </div>
          )}
        </div>
        {(badge || action) && (
          // The badge is inert; the action is lifted above the stretched link
          // (`relative z-20`) and sits at the bottom right, the far corner from
          // the row's own destination.
          <div className="shrink-0 flex items-start justify-between gap-1.5 sm:flex-col sm:items-end">
            {badge}
            {action && <div className="relative z-20">{action}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
