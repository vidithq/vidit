"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useMutation } from "@/hooks/useMutation";
import { removeEventFromCollection } from "@/lib/collections";
import { profileSearchHref } from "@/lib/search";
import type { EventListItem } from "@/types";

/**
 * A collection's items, in the order the events happened.
 *
 * Each row is the catalogue's own compact card, with its lifecycle badge, so a
 * collection item and the same event in a search result or on a profile read as
 * one object. The byline is the one thing the row drops: a collection is one
 * analyst's own work and the header above names them, so the same handle on
 * every row would only push the title's column narrower.
 *
 * **The list is the player's step control.** A click anywhere on a row moves
 * the player above it to that item, and the row the player stands on wears the
 * accent border, so the list doubles as the index of the walk instead of
 * carrying a second control per row to start one. The row keeps the way to the
 * event's own page on its title, the lift `<EntityCard>` gives every link that
 * is not the card's own click.
 *
 * The owner gets one control per row, taking the item off the shelf: a red icon
 * button at the row's bottom right, the far corner from the title, since it is
 * the one thing on the row that takes something away. It still asks for no
 * confirm, because the event is untouched, the write is idempotent, and putting
 * it back is the panel on the event's own page.
 *
 * The header's one link is the owner's own catalogue in search, since events
 * join a collection from their own pages and the owner has to get to one to do
 * it. The sentence under the eyebrow says so.
 *
 * The list holds the collection's whole sequence, the one the page reads for
 * the map and the panel too, so the rows and the pins can never describe
 * different collections and the row numbers and `N of M` are one count.
 */
export function CollectionItems({
  collectionId,
  ownerUsername,
  items,
  isOwner,
  loading,
  error,
  step,
  onStep,
  onRemoved,
}: {
  collectionId: string;
  /** The handle the owner's catalogue link carries. */
  ownerUsername: string;
  items: EventListItem[];
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  /** Which item the player above the list stands on, 1-based. */
  step: number;
  onStep: (step: number) => void;
  /** Runs once an item is off the collection: the page re-reads the header,
   *  whose count, date range and mosaic all move with the set. */
  onRemoved: () => void;
}) {
  // Which row's removal is in flight. One banner for the section and one
  // pending id, rather than an error line inside a card that has no slot for
  // one: only one removal is ever in flight, since the control that started it
  // is the one that goes quiet.
  const [pending, setPending] = useState<string | null>(null);
  const remove = useMutation(
    (eventId: string) => removeEventFromCollection(collectionId, eventId),
    { fallback: "Failed to take the event off this collection", onSuccess: onRemoved },
  );

  const handleRemove = (eventId: string) => {
    setPending(eventId);
    void remove.run(eventId).finally(() => setPending(null));
  };

  return (
    <Card as="section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Events" margin="none" />
          <p className="text-xs text-neutral-500">
            Ordered by event date and time, earliest first. Pick a row to read
            it on the map above.
            {isOwner && " An event joins a collection from its own page."}
          </p>
        </div>
        {isOwner && (
          // Where the owner goes to shelve something: their own catalogue,
          // since an event joins a collection from its own page. No status
          // filter, unlike the profile's "Show more", because a detection the
          // owner has yet to confirm is still theirs to put on a collection.
          // Same builder as every other link into a filtered catalogue.
          <Link
            href={profileSearchHref(ownerUsername)}
            className={buttonClasses("secondary", {
              className: "shrink-0 whitespace-nowrap",
            })}
          >
            Your geolocations
          </Link>
        )}
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {remove.error && <div className={FORM_ERROR_BANNER}>{remove.error}</div>}

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <EntityCard
              key={item.id}
              variant="compact"
              detailHref={`/events/${item.id}`}
              title={item.title}
              badge={<StatusBadge status={item.status} />}
              media={item.media ?? undefined}
              isGraphic={item.is_graphic}
              date={item.event_date ?? undefined}
              coords={item.event_coords}
              tags={item.tags}
              selected={index + 1 === step}
              onSelect={() => onStep(index + 1)}
              selectLabel={`Read this collection from ${item.title}`}
              // Every row here carries the same two lines, since the byline is
              // the one slot a collection item drops, so the catalogue's height
              // floor would only print a band of nothing under each of them.
              uniformHeight={false}
              action={
                isOwner ? (
                  <Button
                    icon
                    variant="dangerGhost"
                    disabled={pending === item.id}
                    onClick={() => handleRemove(item.id)}
                    aria-label={`Remove ${item.title} from this collection`}
                    title="Remove from collection"
                  >
                    <X size={14} />
                  </Button>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        !loading &&
        !error && (
          <EmptyState variant="plain" lead="Nothing on this collection yet.">
            {isOwner
              ? "Open one of your geolocations and add it from there."
              : "The analyst has not put anything on it."}
          </EmptyState>
        )
      )}
    </Card>
  );
}
