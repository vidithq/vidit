"use client";

import { useState } from "react";
import Link from "next/link";

import { CollectionItemCard } from "@/components/collections/CollectionItemCard";
import { ActionIcon, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { profileSearchHref } from "@/lib/search";
import type { EventListItem } from "@/types";

/** Rows the list shows per **Show more**. */
const PAGE_SIZE = 20;

/**
 * A collection's items, in the order the events happened, as `<CollectionItemCard>` rows, a
 * page of `PAGE_SIZE` at a time behind the shared **Show more** row. The sequence is already
 * loaded whole, so a page is a slice of it.
 *
 * **The list is the step control.** A click on a row moves the Coverage section to that item,
 * and the current row wears the accent border. A step past the rows shown (a shared link, the
 * map, the arrow keys) opens the pages down to it. A row carries one gesture for owner and
 * visitor alike: the title is plain text, and the event's page is reached from the Coverage
 * section's Event row.
 *
 * The header's one link is the owner's own catalogue in search, since an event joins a
 * collection from its own page. The sentence under the eyebrow names that and the edit page's
 * picker (also where an item leaves); this page only reads the set.
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
  ownerUsername: string;
  items: EventListItem[];
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  /** The item the reader stands on, 1-based. */
  step: number;
  onStep: (step: number) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = Math.max(shown, Math.ceil(step / PAGE_SIZE) * PAGE_SIZE);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Events" margin="none" />
          <p className="text-xs text-neutral-500">
            Ordered by event date and time, earliest first. Pick a row to show it on the map.
            {isOwner &&
              " An event joins a collection from its own page, or from the picker on the edit page."}
          </p>
        </div>
        {isOwner && (
          // No status filter, unlike the profile's "Show more": an unconfirmed
          // detection can still go on a collection.
          <Link
            href={profileSearchHref(ownerUsername)}
            className={buttonClasses("secondary", {
              className: "shrink-0 whitespace-nowrap",
            })}
          >
            <ActionIcon action="search" />
            Your geolocations
          </Link>
        )}
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.slice(0, visible).map((item, index) => (
            <CollectionItemCard
              key={item.id}
              item={item}
              selected={index + 1 === step}
              onSelect={() => onStep(index + 1)}
            />
          ))}
          <LoadMoreRow
            walk={{
              hasMore: visible < items.length,
              loadingMore: false,
              loadMore: () => setShown(visible + PAGE_SIZE),
              error: null,
            }}
          />
        </div>
      ) : (
        !loading &&
        !error && (
          <EmptyState>
            Nothing on this collection yet.{" "}
            {isOwner
              ? "Open one of your geolocations and add it from there."
              : "The analyst has not put anything on it."}
          </EmptyState>
        )
      )}
    </section>
  );
}
