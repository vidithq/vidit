"use client";

import type { ReactNode } from "react";

import { StatusBadge } from "@/components/event/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import type { PickableEvent } from "@/lib/collections";

/**
 * One event as a collection surface renders it: the catalogue's own compact
 * card, with its lifecycle badge and without the byline.
 *
 * Every surface that lists a collection's events reads it, so a row on the
 * collection's page, on the picker's held block and on the picker's add block
 * fill the same slots. The byline is the one slot they all drop: a collection
 * is one analyst's own work and the block above names them, so the same handle
 * on every row would only push the title's column narrower. That is also why
 * the height floor is off: with the byline gone the floor would print a band of
 * nothing under the two lines each row carries.
 *
 * `action` is the control the surface puts on the row (the cross that takes an
 * item off, the plus that adds one). `onSelect` is the collection page's own
 * mode, where the row picks the player's step instead of opening the event: the
 * whole card becomes that button, the title renders as plain text, and the
 * event's own page is reached from the player panel's title above the list.
 */
export function CollectionItemCard({
  item,
  action,
  selected = false,
  onSelect,
}: {
  item: PickableEvent;
  action?: ReactNode;
  /** True for the row the player stands on. Select mode only. */
  selected?: boolean;
  /** Picks this row on the surface it sits on instead of opening it. */
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
