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
 * With `onSelect` it is the collection page's row: the compact card without the
 * height floor, which picks the player's step instead of opening the event; the
 * event's page is reached from the player panel's title. Without it, it is the
 * feed card, media under the title, linking to the event: one block of the
 * write pages' carousel of held events, whose remove control sits outside it.
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
    tags: item.tags,
  };

  return onSelect ? (
    <EntityCard
      {...slots}
      variant="compact"
      date={item.occurred_date ?? undefined}
      uniformHeight={false}
      onSelect={onSelect}
      selected={selected}
      selectLabel={`Read this collection from ${item.title}`}
    />
  ) : (
    <EntityCard
      {...slots}
      variant="feed"
      dates={item.occurred_date ? [{ label: "Event", date: item.occurred_date }] : undefined}
      detailHref={eventHref(item.id)}
    />
  );
}
