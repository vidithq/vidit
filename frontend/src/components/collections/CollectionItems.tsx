"use client";

import Link from "next/link";

import { CollectionItemCard } from "@/components/collections/CollectionItemCard";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { profileSearchHref } from "@/lib/search";
import type { EventListItem } from "@/types";

/**
 * A collection's items, in the order the events happened, as
 * `<CollectionItemCard>` rows.
 *
 * **The list is the player's step control.** A click on a row moves the player
 * above to that item, and the current row wears the accent border. A row carries
 * one gesture for owner and visitor alike: the title is plain text, and the
 * event's page is reached from the player panel's title.
 *
 * The header's one link is the owner's own catalogue in search, since an event
 * joins a collection from its own page. The sentence under the eyebrow names
 * that and the edit page's picker (also where an item leaves); this page only
 * reads the set.
 *
 * The list holds the whole sequence the map and panel read, so rows and pins
 * describe one collection and `N of M` is one count.
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
  /** The item the player stands on, 1-based. */
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
          // No status filter, unlike the profile's "Show more": an unconfirmed
          // detection can still go on a collection.
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
            <CollectionItemCard
              key={item.id}
              item={item}
              selected={index + 1 === step}
              onSelect={() => onStep(index + 1)}
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
