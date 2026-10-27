"use client";

import { StatusBadge } from "@/components/event/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import type { PickableEvent } from "@/lib/collections";
import { eventHref } from "@/lib/routes";

/**
 * One event as a collection surface renders it: the catalogue card with its
 * lifecycle badge and without the byline (a collection is one analyst's work
 * and the block above names them).
 *
 * Both modes are the compact card without the height floor. With `onSelect` it
 * is the collection page's row, which picks the player's step instead of
 * opening the event; the event's page is reached from the player panel's title.
 * Without it, it is one row of the write pages' list of held events, linking to
 * the event, with no tag row, so the list stays one line of meta per event; its
 * remove control sits outside it.
 */
export function CollectionItemCard({
  item,
  selected = false,
  onSelect,
}: {
  item: PickableEvent;
  /** The row the player stands on. Select mode only. */
  selected?: boolean;
  /** Picks this row instead of opening it. */
  onSelect?: () => void;
}) {
  const slots = {
    title: item.title,
    badge: <StatusBadge status={item.status} />,
    media: item.media ?? undefined,
    isGraphic: item.is_graphic,
    coords: item.coords,
    date: item.occurred_date ?? undefined,
    variant: "compact" as const,
    uniformHeight: false,
  };

  return onSelect ? (
    <EntityCard
      {...slots}
      tags={item.tags}
      onSelect={onSelect}
      selected={selected}
      selectLabel={`Read this collection from ${item.title}`}
    />
  ) : (
    <EntityCard {...slots} detailHref={eventHref(item.id)} />
  );
}
