"use client";

import type { ReactNode } from "react";

import { StatusBadge } from "@/components/event/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import type { PickableEvent } from "@/lib/collections";
import { eventHref } from "@/lib/routes";

/**
 * One event as a collection surface renders it: the catalogue's compact card with
 * its lifecycle badge and without the byline (a collection is one analyst's work
 * and the block above names them), and so without the height floor too.
 *
 * `action` is the control the surface puts on the row. `onSelect` is the
 * collection page's mode: the row picks the player's step instead of opening the
 * event, and the event's page is reached from the player panel's title. `large`
 * is the feed card, media under the title, for a carousel that shows one event
 * at a time (the write pages' held events); its control sits outside the card.
 */
export function CollectionItemCard({
  item,
  action,
  selected = false,
  onSelect,
  large = false,
}: {
  item: PickableEvent;
  action?: ReactNode;
  /** The row the player stands on. Select mode only. */
  selected?: boolean;
  /** Picks this row instead of opening it. */
  onSelect?: () => void;
  large?: boolean;
}) {
  if (large) {
    return (
      <EntityCard
        variant="feed"
        title={item.title}
        badge={<StatusBadge status={item.status} />}
        media={item.media ?? undefined}
        isGraphic={item.is_graphic}
        dates={item.occurred_date ? [{ label: "Event", date: item.occurred_date }] : undefined}
        coords={item.coords}
        tags={item.tags}
        detailHref={eventHref(item.id)}
      />
    );
  }

  const slots = {
    variant: "compact" as const,
    title: item.title,
    badge: <StatusBadge status={item.status} />,
    media: item.media ?? undefined,
    isGraphic: item.is_graphic,
    date: item.occurred_date ?? undefined,
    coords: item.coords,
    tags: item.tags,
    uniformHeight: false,
    action,
  };

  return onSelect ? (
    <EntityCard
      {...slots}
      onSelect={onSelect}
      selected={selected}
      selectLabel={`Read this collection from ${item.title}`}
    />
  ) : (
    <EntityCard {...slots} detailHref={eventHref(item.id)} />
  );
}
