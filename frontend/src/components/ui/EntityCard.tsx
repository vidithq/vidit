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
// - Click model is uniform: the whole card navigates to `detailHref` via a
//   stretched link. The author byline sits above it (`relative z-20`) and
//   stays independently clickable. No nested <a>.
// - `onSelect` swaps that one link for a stretched button, for a list whose
//   rows pick a position on the surface they sit on rather than leave it (the
//   collection page's step list). A card carries one gesture: the title is
//   plain text in this mode (same typography as the linked title, minus the
//   link styling and the z-20 lift) and `detailHref` renders nowhere on the
//   row. The entity's own page stays reachable elsewhere (the player panel's
//   own title, above the list).
// - It renders the slots that carry data; an entity without `coords` (a request)
//   simply omits that bit. No `kind` flag.
// - The thumbnail is the private `MediaThumb` below: the real media when
//   `media` is present, its marked "no media" box otherwise.

// The one fixed-ratio media slot on cards: the real media when there is one
// (the image derivative `size` names, or muted video first-frame via `posterFrameUrl` +
// `preload="metadata"` so it paints as a poster), else a marked "no media"
// box. No generated stand-ins: a card without media says so. The video is
// `object-contain` on the slot's backdrop, so a portrait clip letterboxes in
// the 16:9 slot rather than showing a cropped band of itself. Consumers: this
// card, the map's pin preview, and the detections queue row (the detail
// surfaces use MediaGallery).
//
// `isGraphic` covers the slot with the compact `GraphicContentGate`, the same
// per-session confirmation the detail gallery asks for, so a flagged event
// never paints its footage on a card the reader was only scrolling past. The
// gate wraps the picture and not the slot, so the "no media" box is never
// covered (there is nothing to cover).
export function MediaThumb({
  media,
  size = "thumbnail",
  className,
  isGraphic = false,
}: {
  /** Anything carrying a stored url and its kind: an event's `Media` row, or
   *  one tile of a collection's mosaic, which is one item's media read off the
   *  collection read. The kind is what picks the element, so a clip plays as a
   *  clip on every surface that shows this slot. */
  media?: Pick<Media, "storage_url" | "media_type">;
  /** Which image derivative the slot reads: the 400 px `thumbnail` a card row
   *  shows, or the 1280 px `hero` a slot spanning its column needs (a
   *  collection's mosaic where one tile fills it). Videos have no derivatives
   *  and ignore it. */
  size?: "thumbnail" | "hero";
  className?: string;
  /** The event's `is_graphic` flag. */
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
        // `self-start` keeps the aspect ratio: in a stretch-aligned flex row a
        // tall neighbour otherwise pulls the slot to full card height and the
        // thumbnail renders as a column.
        "relative w-28 aspect-video self-start rounded-md overflow-hidden bg-neutral-800 shrink-0",
        className,
      )}
    >
      {picture ? (
        // The compact gate lifts its own reveal control above the card's
        // stretched link (`z-20`, the lift `AuthorLink` gets), so the control
        // takes the click; once revealed nothing is left above the link and
        // the thumbnail navigates like any other card surface.
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

// The stretched link needs a plain-string accessible name. When `title` is a
// string it doubles as that name and `titleText` is optional; when `title` is a
// node (search highlights) `titleText` is required, so the link can never end
// up unnamed.
type TitleProps =
  | { title: string; titleText?: string }
  | { title: ReactNode; titleText: string };

interface EntityCardBaseProps {
  /** A rendered status pill: `<StatusBadge>` (any lifecycle state). */
  badge?: ReactNode;
  media?: Media;
  /** The event's `is_graphic` flag, forwarded to the card's media slot. */
  isGraphic?: boolean;
  /** The card's byline. Shown on every catalogue surface, where a card stands
   *  beside other analysts' work and the handle is what tells them apart.
   *  Omitted on a surface that is one analyst's own set and names them once in
   *  its header (a collection's item list), where repeating the same handle on
   *  every row says nothing about any of them. */
  author?: { username: string };
  /** A control that acts on this row rather than opening it (taking an item
   *  off a collection). It renders above the stretched link, at the bottom of
   *  the badge's column, so it takes its own click and sits as far from the
   *  row's own destination as the column allows; a row with none stays one
   *  click. */
  action?: ReactNode;
  /** The fixed height floor that keeps every row of a catalogue list the same
   *  height whatever slots its entity fills (a 1-line title, tags or none).
   *  A list whose rows all carry the same short shape turns it off: a
   *  collection's items drop the byline and stand under a header that names
   *  the analyst, so the floor would leave a band of empty space under two
   *  lines of text on every row. Off, the row stands on its media column and
   *  the text centres against it. */
  uniformHeight?: boolean;
  /** What that button is called, since the title beside it already carries the
   *  row's own name and two controls reading the same words say nothing about
   *  either. Falls back to the title. */
  selectLabel?: string;
  /** True for the row the surface currently stands on: the card wears the
   *  accent border its hover treatment already uses, and the stretched control
   *  is marked as the current one. */
  selected?: boolean;
  date?: string;
  coords?: { lat: number; lng: number } | null;
  /** ``url`` is null on a sourceless machine detection; `SourceLabel` renders the
   *  muted "To confirm" label for it. */
  source?: { url: string | null };
  tags?: { id: string; name: string }[];
  variant?: "feed" | "compact";
}

// A card carries one gesture. The default mode's stretched link needs
// `detailHref`; `onSelect`'s stretched button needs none, since the title
// renders as plain text and the entity's own page is reached elsewhere in
// that mode.
type SelectableProps =
  | { onSelect?: undefined; detailHref: string }
  | {
      /** Picks this row on the surface it sits on instead of opening it. The
       *  whole card becomes the button that does it. */
      onSelect: () => void;
      detailHref?: string;
    };

type EntityCardProps = EntityCardBaseProps & TitleProps & SelectableProps;

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

// The author link is interactive (-> profile), so it sits above the stretched
// link.
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
      aria-label={selectLabel ?? name}
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
  // A card carries one gesture: on a selecting row the title is plain text,
  // same as every other row, where the whole card is the link already. It
  // carries no `detailHref` of its own in that mode; the entity's own page is
  // reached elsewhere (the player panel's own title, on the collection page).
  // The one border a selected row wears, the accent its hover already reaches
  // for, so standing on a row and pointing at one read as the same colour.
  const shell = cn(SHELL, selected && "border-orange-500/60");
  // Always a thumbnail (keeps the row height uniform): MediaThumb renders the
  // real media or its own "no media" box. Narrower on a phone, where the
  // desktop 112px slot plus the status badge left the title column no width at
  // all and the heading rendered as an empty strip.
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
      {/* The badge shares the row with the text from `sm` up and drops under it
          on a phone: as a `shrink-0` column beside a `min-w-0` one it took its
          full width out of the title's, and a status pill is wide enough to
          leave nothing behind. */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-2">
        {/* Under `uniformHeight`, a fixed min-height keeps every compact card
            the same height. Content packs to the top, so a 1-line title leaves
            its slack at the bottom of the card rather than as a gap under the
            title. Dropped on a phone, where the badge's own row already fills
            it and the floor only added dead space.

            Without it the row stands on its media column, and text shorter
            than that column centres against it, so two lines sit beside the
            thumbnail instead of hanging from its top edge over a band of
            nothing. Text taller than the column sets the row's height and
            `justify-center` has nothing left to move, which is why a row
            carrying a byline, a meta line and tags reads the same either
            way. */}
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
          // The badge is inert and sits under the stretched link; the action is
          // a control, so it is lifted above it (`relative z-20`, the lift the
          // author link takes) and takes its own click.
          //
          // The column holds the two apart: the badge at the top of the row and
          // the action at its bottom right, the far corner from the title, so a
          // control that takes the row away is never under the pointer aiming
          // at the row itself. A column carrying only a badge keeps it at the
          // top, which is where every other catalogue row wears it.
          <div className="shrink-0 flex items-start justify-between gap-1.5 sm:flex-col sm:items-end">
            {badge}
            {action && <div className="relative z-20">{action}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
