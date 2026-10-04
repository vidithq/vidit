"use client";

import type { ReactNode } from "react";

import { StatusBadge } from "@/components/event/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import type { PickableEvent } from "@/lib/collections";

/**
 * One event as a collection surface renders it: the catalogue's compact card with
 * its lifecycle badge and without the byline (a collection is one analyst's work
 * and the block above names them), and so without the height floor too.
 *
 * `action` is the control the surface puts on the row. `onSelect` is the
 * collection page's mode: the row picks the player's step instead of opening the
 * event, and the event's page is reached from the player panel's title.
 */
export function CollectionItemCard({
  item,
  action,
  selected = false,
  onSelect,
}: {
  item: PickableEvent;
  action?: ReactNode;
  /** The row the player stands on. Select mode only. */
  selected?: boolean;
  /** Picks this row instead of opening it. */
  onSelect?: () => void;
}) {
  const slots = {
    variant: "compact" as const,
    title: item.title,
    badge: <StatusBadge status={item.status} />,
    media: item.media ?? undefined,
    isGraphic: item.is_graphic,
    date: item.event_date ?? undefined,
    coords: item.event_coords,
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
    <EntityCard {...slots} detailHref={`/events/${item.id}`} />
  );
}
