import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { Building2, Users, type LucideIcon } from "lucide-react";

import type { CollectionCoverTile } from "@/lib/collections";
import { cn } from "@/lib/cn";
import { displayUrlsFor, posterFrameUrl, type DisplayMedia } from "@/lib/mediaUrls";
import { splitHighlights } from "@/lib/search";
import { AuthorByline } from "./AuthorByline";
import { Avatar } from "./Avatar";
import { ACTION_ICONS } from "./Button";
import { GraphicContentGate } from "./GraphicContentGate";
import { META_LINE, TAPPABLE_HOVER } from "./styles";

export type ItemKind = "event" | "request" | "site" | "collection" | "analyst" | "organization";

export type ItemVariant = "compact" | "list" | "card";

/** The word that opens an item's detail line, its plural that heads a list of the kind, and the
 *  icon of its empty media slot. */
export const ITEM_KINDS: Record<ItemKind, { label: string; plural: string; icon: LucideIcon }> = {
  event: { label: "Event", plural: "Events", icon: ACTION_ICONS.geolocate },
  request: { label: "Request", plural: "Requests", icon: ACTION_ICONS.request },
  site: { label: "Site", plural: "Sites", icon: ACTION_ICONS.site },
  collection: { label: "Collection", plural: "Collections", icon: ACTION_ICONS.collect },
  analyst: { label: "Analyst", plural: "Analysts", icon: Users },
  organization: { label: "Organization", plural: "Organizations", icon: Building2 },
};

/** What fills the media slot: a file, a collection's mosaic, or a profile picture. */
export type ItemMediaSource =
  | { file: DisplayMedia | null | undefined; isGraphic?: boolean }
  | { cover: CollectionCoverTile[] }
  | { avatar: { src: string | null | undefined; name: string; square?: boolean } };

type Author = { username: string; avatar_url?: string | null };

/** An item's anatomy, which the adapters in `lib/items.tsx` fill from each payload. */
export interface ItemData {
  kind: ItemKind;
  title: string;
  /** The title with the words a search matched, wrapped in the backend's sentinels. */
  highlight?: string;
  media?: ItemMediaSource;
  date?: string | null;
  analyst?: { author: Author; coAuthors?: Author[] } | null;
  place?: string | null;
  /** Segments after the place, such as how long a request has been open. */
  extra?: ReactNode[];
  /** The state: Detected, Geolocated, Requested, a site's kind, a collection's size. */
  badge?: ReactNode;
  href?: string;
}

type ItemProps = ItemData & {
  variant: ItemVariant;
  /** Opens `href` in a new tab, for a list inside a form the reader is filling. */
  newTab?: boolean;
  /** Picks the item on its own surface instead of opening it; `href` is then unused. */
  onSelect?: () => void;
  /** The select button's name. */
  selectLabel?: string;
  /** The item the surface stands on. */
  selected?: boolean;
  /** Controls after the badge, above the item's link. */
  actions?: ReactNode;
};

const SLOT_WIDTH: Record<ItemVariant, string> = {
  compact: "w-14",
  list: "w-20 sm:w-28",
  card: "w-full",
};

const ICON_SIZE: Record<ItemVariant, number> = { compact: 14, list: 20, card: 32 };

const AVATAR_SIZE: Record<ItemVariant, string> = {
  compact: "size-6",
  list: "size-10",
  card: "size-16",
};

function Picture({ media, size }: { media: DisplayMedia; size: "thumbnail" | "hero" }) {
  return media.kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displayUrlsFor(media)[size]} alt="" className="h-full w-full object-cover" />
  ) : (
    <video
      src={posterFrameUrl(media.storage_url)}
      className="h-full w-full object-contain"
      preload="metadata"
      playsInline
      muted
    />
  );
}

/** A collection's mosaic: one tile fills the slot, two split it, three put the earliest tall on
 *  the left, four fill a 2x2. */
function Mosaic({ cover }: { cover: CollectionCoverTile[] }) {
  return (
    <div
      className={cn(
        "grid h-full w-full gap-[2px]",
        cover.length === 1 ? "grid-cols-1" : "grid-cols-2",
        cover.length > 2 && "grid-rows-2",
      )}
    >
      {cover.map((tile, index) => (
        <div
          key={`${tile.url}-${index}`}
          className={cn("min-w-0 overflow-hidden", cover.length === 3 && index === 0 && "row-span-2")}
        >
          <Picture
            media={{ storage_url: tile.url, kind: tile.kind, role: tile.role }}
            size={cover.length === 1 ? "hero" : "thumbnail"}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The media slot of an item, 16:9 at every width: the item's picture, else a neutral tile with
 * the kind's icon. A video shows its first frame. A graphic file sits behind the compact
 * `GraphicContentGate`, except in the compact variant, whose slot is too small for the gate's
 * control and shows the kind's tile instead.
 */
export function ItemMedia({
  kind,
  media,
  variant,
  className,
}: {
  kind: ItemKind;
  media?: ItemMediaSource;
  variant: ItemVariant;
  className?: string;
}) {
  const Icon = ITEM_KINDS[kind].icon;
  let content: ReactNode = null;
  if (media && "file" in media && media.file) {
    const picture = (
      <Picture media={media.file} size={variant === "card" ? "hero" : "thumbnail"} />
    );
    if (!media.isGraphic) content = picture;
    else if (variant !== "compact") {
      content = <GraphicContentGate variant="compact">{picture}</GraphicContentGate>;
    }
  } else if (media && "cover" in media && media.cover.length > 0) {
    content = <Mosaic cover={variant === "compact" ? media.cover.slice(0, 1) : media.cover} />;
  } else if (media && "avatar" in media) {
    content = (
      <div className="flex h-full w-full items-center justify-center">
        <Avatar
          src={media.avatar.src ?? null}
          username={media.avatar.name}
          size={AVATAR_SIZE[variant]}
          shape={media.avatar.square ? "square" : "circle"}
          decorative
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "relative aspect-video shrink-0 self-start overflow-hidden rounded-md bg-neutral-800",
        SLOT_WIDTH[variant],
        className,
      )}
    >
      {content ?? (
        <div className="flex h-full w-full items-center justify-center text-neutral-600">
          <Icon size={ICON_SIZE[variant]} strokeWidth={1.6} aria-hidden />
        </div>
      )}
    </div>
  );
}

/** A sentinel-wrapped search string as text and `<mark>`. */
export function Highlighted({ value }: { value: string }) {
  return (
    <>
      {splitHighlights(value).map((seg, i) =>
        seg.highlighted ? (
          <mark key={i} className="rounded-sm bg-orange-500/30 px-0.5 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}

function DetailLine({
  kind,
  date,
  analyst,
  place,
  extra = [],
  linked,
  className,
}: Pick<ItemData, "kind" | "date" | "analyst" | "place" | "extra"> & {
  linked: boolean;
  className?: string;
}) {
  const parts: ReactNode[] = [ITEM_KINDS[kind].label];
  if (date) parts.push(date);
  if (analyst) {
    parts.push(
      <AuthorByline
        author={analyst.author}
        coAuthors={analyst.coAuthors}
        coAuthorsAs={linked ? "avatars" : "names"}
        avatar={linked}
        prefix={false}
        link={linked}
        size="xs"
        className={linked ? "relative z-20" : undefined}
      />,
    );
  }
  if (place) parts.push(place);
  parts.push(...extra.filter((part) => part !== null && part !== undefined && part !== false && part !== ""));
  return (
    <p className={cn(META_LINE, "flex-wrap gap-x-1.5 gap-y-0.5", className)}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span className="inline-flex min-w-0 items-center">{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

const SHELL = "relative flex gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-3";

/**
 * One event, request, site or collection (or, on the search page, an analyst or an
 * organization), in one of three variants that share one anatomy: the media slot, the title,
 * the detail line (the kind, then the date, the analyst and the place), and the state badge.
 *
 * - `compact`: a bare row with a small media slot, for pickers, link dialogs, map previews and
 *   dense lists.
 * - `list`: a bordered row, media on the left and the badge on the right (under the text on a
 *   phone).
 * - `card`: the media large on top, then the title with the badge, then the detail line.
 *
 * The whole item is a stretched link to `href`, or a stretched button with `onSelect`; the
 * analyst and `actions` sit above it and take their own click. Without either it is static.
 */
export function Item({
  variant,
  kind,
  title,
  highlight,
  media,
  date,
  analyst,
  place,
  extra,
  badge,
  href,
  newTab = false,
  onSelect,
  selectLabel,
  selected = false,
  actions,
}: ItemProps) {
  const stretch = "absolute inset-0 z-10 rounded-[inherit]";
  const cover = onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      aria-label={selectLabel ?? title}
      aria-current={selected ? "true" : undefined}
      className={stretch}
    />
  ) : href ? (
    <Link
      href={href}
      aria-label={title}
      className={stretch}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    />
  ) : null;
  const interactive = cover !== null;
  const name = highlight ? <Highlighted value={highlight} /> : title;
  const detail = (
    <DetailLine
      kind={kind}
      date={date}
      analyst={analyst}
      place={place}
      extra={extra}
      linked={interactive && variant !== "compact"}
      className={variant === "compact" ? "flex-nowrap overflow-hidden whitespace-nowrap" : undefined}
    />
  );
  const trailing = (badge || actions) && (
    <div className="flex shrink-0 items-center gap-1">
      {badge}
      {actions && <div className="relative z-20 flex items-center gap-1">{actions}</div>}
    </div>
  );
  const slot = <ItemMedia kind={kind} media={media} variant={variant} />;

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "relative flex items-center gap-2.5 rounded-md",
          interactive && "-mx-1.5 px-1.5 py-1 transition-colors hover:bg-neutral-800/60",
          selected && "bg-orange-500/10",
        )}
      >
        {cover}
        {slot}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-100">{name}</p>
          {detail}
        </div>
        {trailing}
      </div>
    );
  }

  const shell = cn(SHELL, interactive && TAPPABLE_HOVER, selected && "border-orange-500/60");

  if (variant === "card") {
    return (
      <article className={cn(shell, "flex-col")}>
        {cover}
        {slot}
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-sm font-medium text-neutral-100 [overflow-wrap:anywhere]">{name}</h2>
          {trailing}
        </div>
        {detail}
      </article>
    );
  }

  return (
    <div className={shell}>
      {cover}
      {slot}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="line-clamp-2 text-sm font-medium text-neutral-100 [overflow-wrap:anywhere]">{name}</h3>
          {detail}
        </div>
        {trailing}
      </div>
    </div>
  );
}
