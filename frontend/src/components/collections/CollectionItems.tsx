"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
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
 * The owner gets one control per row, taking the item off the shelf. It is not
 * a destructive verb and does not wear the destructive colour: the event is
 * untouched, the write is idempotent, and putting it back is the panel on its
 * own page. So there is no confirm either.
 *
 * The list walks the shared cursor, `Load more` at the foot like every other
 * list on the site.
 */
export function CollectionItems({
  collectionId,
  items,
  isOwner,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onRemoved,
}: {
  collectionId: string;
  items: EventListItem[];
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Runs once an item is off the collection: the page re-reads the header,
   *  whose count, date range and default cover all move with the set. */
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
            Ordered by event date and time, earliest first.
          </p>
        </div>
        {isOwner && (
          // Events join a collection from their own pages, which is where the
          // owner can see what they are shelving, so this is a way into the
          // work rather than a picker of its own.
          <Link
            href="/submit"
            className={buttonClasses("secondary", {
              className: "shrink-0 whitespace-nowrap",
            })}
          >
            <Plus size={14} strokeWidth={1.8} />
            Add events
          </Link>
        )}
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {remove.error && <div className={FORM_ERROR_BANNER}>{remove.error}</div>}

      {items.length > 0 ? (
        <>
          <div className="space-y-2">
            {items.map((item) => (
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
                action={
                  isOwner ? (
                    <Button
                      icon
                      variant="ghost"
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
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
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
