"use client";

import Link from "next/link";

import { StatusBadge } from "@/components/event/StatusBadge";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
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
 * carrying a second control per row to start one. A row carries one gesture,
 * the same for the owner and a visitor: the title renders as plain text, and
 * the event's own page is reached from the player panel's own title above the
 * list.
 *
 * The header's one link is the owner's own catalogue in search, since an event
 * joins a collection from its own page and the owner has to get to one to do
 * it. The sentence under the eyebrow says so, and names the other way, the
 * picker on the collection's edit page, which is also where an item leaves the
 * collection: this page only reads the set, so its rows carry no control of
 * their own.
 *
 * The list holds the collection's whole sequence, the one the page reads for
 * the map and the panel too, so the rows and the pins can never describe
 * different collections and the row numbers and `N of M` are one count.
 */
export function CollectionItems({
  ownerUsername,
  items,
  isOwner,
  loading,
  error,
  step,
  onStep,
}: {
  /** The handle the owner's catalogue link carries. */
  ownerUsername: string;
  items: EventListItem[];
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  /** Which item the player above the list stands on, 1-based. */
  step: number;
  onStep: (step: number) => void;
}) {
  return (
    <Card as="section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Events" margin="none" />
          <p className="text-xs text-neutral-500">
            Ordered by event date and time, earliest first. Pick a row to read
            it on the map above.
            {isOwner &&
              " An event joins a collection from its own page, or from the picker on the edit page."}
          </p>
        </div>
        {isOwner && (
          // Where the owner goes to shelve something: their own catalogue,
          // since an event joins a collection from its own page or from the
          // edit page's picker. No status filter, unlike the profile's "Show
          // more", because a detection the owner has yet to confirm is still
          // theirs to put on a collection.
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
