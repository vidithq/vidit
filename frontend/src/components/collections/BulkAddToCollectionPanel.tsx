"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Plus } from "lucide-react";

import { ActionRow } from "@/components/ui/ActionRow";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  addEventsToCollection,
  collectionHref,
  eventCountLabel,
  newCollectionHref,
  userCollectionsPath,
  type BulkAddResult,
  type CollectionPage,
  type SearchMatchParams,
} from "@/lib/collections";

/** One page of the owner's list at the endpoint's page cap (`services/pagination.MAX_PAGE_SIZE`);
 *  older collections past it are absent, as in the event page's panel. */
const PANEL_COLLECTIONS = 100;

export type BulkTarget = { eventIds: string[] } | { match: SearchMatchParams };

function summary({ added, skipped }: BulkAddResult): string {
  const parts = [`${added} added`];
  if (skipped.already_in_collection > 0) {
    parts.push(`${skipped.already_in_collection} already in this collection`);
  }
  if (skipped.not_collectable > 0) {
    parts.push(`${skipped.not_collectable} not collectable`);
  }
  return parts.join(", ");
}

/**
 * Puts a selection of the owner's events on one of their collections in one write
 * (`POST /collections/{id}/events`). Each collection is an `<ActionRow>`: the title over its
 * item count, and an **Add** button. Once the selection is on it, the button gives way to a
 * static **Added** pill with a check, since a bulk add has no undo here, and the count moves by
 * what was added. The line under the list says what the write did and links to the collection.
 * A `New collection` link closes the list.
 */
export function BulkAddToCollectionPanel({
  username,
  target,
}: {
  username: string;
  target: BulkTarget;
}) {
  const { data, error } = useApiResource<CollectionPage>(
    userCollectionsPath(username, PANEL_COLLECTIONS),
  );
  const [done, setDone] = useState<Record<string, BulkAddResult>>({});
  const [last, setLast] = useState<{ id: string; result: BulkAddResult } | null>(null);

  const write = useMutation(
    (collectionId: string) => addEventsToCollection(collectionId, target),
    {
      fallback: "Failed to add to the collection",
      onSuccess: (result, collectionId) => {
        setDone((d) => ({ ...d, [collectionId]: result }));
        setLast({ id: collectionId, result });
      },
    },
  );

  if (error) return <div className={FORM_ERROR_BANNER}>{error}</div>;
  if (data === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-4">
      {data.items.length > 0 ? (
        /* As in AddToCollectionPanel: the list owns its dividers and row padding, and scrolls
           inside the viewport-fixed popover. */
        <div className="max-h-72 divide-y divide-neutral-800 overflow-y-auto">
          {data.items.map((row) => (
            <ActionRow
              key={row.id}
              label={row.title}
              description={eventCountLabel(row.event_count + (done[row.id]?.added ?? 0))}
              className="py-2.5"
              action={
                row.id in done ? (
                  <Pill tone="accent" icon={<Check size={11} />}>
                    Added
                  </Pill>
                ) : (
                  <Button
                    variant="secondary"
                    aria-label={`Add to ${row.title}`}
                    disabled={write.loading}
                    onClick={() => void write.run(row.id)}
                  >
                    Add
                  </Button>
                )
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState variant="plain" lead="No collections yet.">
          Open one, then come back to add this selection.
        </EmptyState>
      )}

      {write.loading && <p className="text-xs text-neutral-500">Adding…</p>}
      {write.error && <div className={FORM_ERROR_BANNER}>{write.error}</div>}
      {last && !write.loading && !write.error && (
        <p role="status" className="text-xs text-neutral-300">
          {summary(last.result)}.{" "}
          <Link href={collectionHref(last.id)} className={TEXT_LINK}>
            Open the collection
          </Link>
        </p>
      )}

      <Link href={newCollectionHref()} className={buttonClasses("ghost")}>
        <Plus size={14} strokeWidth={1.8} />
        New collection
      </Link>
    </div>
  );
}
