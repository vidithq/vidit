import { StatusBadge } from "@/components/event/StatusBadge";
import { SiteKindPill } from "@/components/sites/SiteBadges";
import { Highlighted, ITEM_KINDS, type ItemData, type ItemKind } from "@/components/ui/Item";
import { Pill } from "@/components/ui/Pill";
import {
  collectionHref,
  collectionSpanLabel,
  eventCountLabel,
  type CollectionCoverTile,
} from "@/lib/collections";
import { formatDate } from "@/lib/format";
import { creditProps } from "@/lib/geolocatorCredit";
import type { DisplayMedia } from "@/lib/mediaUrls";
import { memberCountLabel, organizationPath } from "@/lib/organizations";
import { eventHref, profileHref, requestHref } from "@/lib/routes";
import { siteHref, type SiteKind } from "@/lib/sites";
import type { AuthorRef, EventStatus, SearchHit, SearchHitType } from "@/types";

/** The fields of an event every list payload carries; the others are optional. */
export interface ItemEvent {
  id: string;
  title: string;
  /** Absent on a payload that only holds located events, which then carries no badge. */
  status?: EventStatus;
  occurred_date?: string | null;
  media?: DisplayMedia | null;
  is_graphic?: boolean;
  owner?: AuthorRef;
  geolocators?: AuthorRef[];
}

/** An event or a request: the request's page for a request, the event's otherwise, its
 *  lifecycle status as the badge, and its credit line as the analyst. */
export function eventItem(event: ItemEvent): ItemData {
  const requested = event.status === "requested";
  return {
    kind: requested ? "request" : "event",
    title: event.title,
    media: { file: event.media, isGraphic: event.is_graphic },
    date: event.occurred_date ? formatDate(event.occurred_date) : null,
    analyst: event.owner
      ? event.geolocators
        ? creditProps({ owner: event.owner, geolocators: event.geolocators })
        : { author: event.owner }
      : null,
    badge: event.status && <StatusBadge status={event.status} />,
    href: requested ? requestHref(event.id) : eventHref(event.id),
  };
}

export interface ItemSite {
  id: string;
  name: string;
  kind: SiteKind;
  media?: DisplayMedia | null;
  last_source?: { captured_at: string } | null;
  owner?: AuthorRef | null;
}

/** A site: its picture, the capture date of its latest source, its owner, and its kind as the
 *  badge. */
export function siteItem(site: ItemSite): ItemData {
  return {
    kind: "site",
    title: site.name,
    media: { file: site.media },
    date: site.last_source ? formatDate(site.last_source.captured_at) : null,
    analyst: site.owner ? { author: site.owner } : null,
    badge: <SiteKindPill kind={site.kind} />,
    href: siteHref(site.id),
  };
}

export interface ItemCollection {
  id: string;
  title: string;
  cover: CollectionCoverTile[];
  event_count: number;
  first_date?: string | null;
  last_date?: string | null;
  owner?: AuthorRef;
}

/** A collection: its mosaic, the span its events cover, its owner, and its size as the badge. */
export function collectionItem(collection: ItemCollection): ItemData {
  return {
    kind: "collection",
    title: collection.title,
    media: { cover: collection.cover },
    date: collectionSpanLabel(collection.first_date ?? null, collection.last_date ?? null),
    analyst: collection.owner ? { author: collection.owner } : null,
    badge: <Pill tone="neutral">{eventCountLabel(collection.event_count)}</Pill>,
    href: collectionHref(collection.id),
  };
}

/** The item kind of each `GET /search` type. A request is an event hit. */
const SEARCH_TYPE_KINDS: Record<SearchHitType, ItemKind> = {
  event: "event",
  site: "site",
  collection: "collection",
  user: "analyst",
  organization: "organization",
};

/** The name of a search type's section and of its Show chip: *Events*, *Sites*, *Analysts*. */
export function searchTypeLabel(type: SearchHitType): string {
  return ITEM_KINDS[SEARCH_TYPE_KINDS[type]].plural;
}

/** One hit of `GET /search`, with the words the query matched marked in its title. */
export function searchHitItem(hit: SearchHit): ItemData {
  switch (hit.type) {
    case "event":
      return {
        ...eventItem({ ...hit, media: hit.media[0] }),
        highlight: hit.title_highlight,
      };
    case "site":
      return { ...siteItem({ ...hit, media: hit.media[0] }), highlight: hit.name_highlight };
    case "collection":
      return collectionItem(hit);
    case "user":
      return {
        kind: "analyst",
        title: hit.username,
        highlight: hit.username_highlight,
        media: { avatar: { src: hit.avatar_url, name: hit.username } },
        extra: [hit.bio_highlight && <Highlighted value={hit.bio_highlight} />],
        href: profileHref(hit.username),
      };
    case "organization":
      return {
        kind: "organization",
        title: hit.name,
        highlight: hit.name_highlight,
        media: { avatar: { src: hit.avatar_url, name: hit.name, square: true } },
        extra: [hit.bio_highlight && <Highlighted value={hit.bio_highlight} />],
        badge: <Pill tone="neutral">{memberCountLabel(hit.member_count)}</Pill>,
        href: organizationPath(hit.slug),
      };
  }
}
