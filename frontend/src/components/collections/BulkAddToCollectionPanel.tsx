"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import {
  CollectionPicker,
  PICKER_ROW,
  PickerCover,
} from "@/components/collections/CollectionPicker";
import { ActionRow } from "@/components/ui/ActionRow";
import { Pill } from "@/components/ui/Pill";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  addEventsToCollection,
  collectionHref,
  eventCountLabel,
  newCollectionFromSelectionHref,
  userCollectionsPath,
  type BulkAddResult,
  type BulkTarget,
  type CollectionPage,
  type PickableEvent,
} from "@/lib/collections";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** One page of the owner's list at the endpoint's page cap (`services/pagination.MAX_PAGE_SIZE`);
 *  older collections past it are absent, as in the event page's panel. */
const PANEL_COLLECTIONS = 100;

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
 * (`POST /collections/{id}/events`).
 *
 * In the `<CollectionPicker>` the event page's panel shares, each collection is an `<ActionRow>`:
 * its lead cover tile, the title, and its item count. No heading, since the search page's head
 * row already counts the selection, and the popover's `PopoverPanel` names the dialog. The whole
 * row adds; once the write lands the row reads *Added N* and its count moves, and the line under
 * the list says what the write did and links to the collection. *New collection* opens
 * `/collections/new` carrying the selection (`newCollectionFromSelectionHref`).
 */
export function BulkAddToCollectionPanel({
  username,
  target,
  rows,
  count,
}: {
  username: string;
  target: BulkTarget;
  /** The checked rows, handed to the create page; none for a search match. */
  rows: PickableEvent[];
  /** How many geolocations the selection holds. */
  count: number;
}) {
  const router = useRouter();
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

  if (error) return <ErrorNotice error={error} />;
  if (data === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <CollectionPicker
      items={data.items}
      renderRow={(row) => {
        const result = done[row.id];
        return (
          <ActionRow
            leading={<PickerCover cover={row.cover} />}
            label={row.title}
            description={eventCountLabel(row.event_count + (result?.added ?? 0))}
            actionLabel="Add"
            aria-label={`Add to ${row.title}`}
            disabled={write.loading}
            onAct={() => void write.run(row.id)}
            className={PICKER_ROW}
            done={
              result && (
                <Pill tone="accent" icon={<Check size={11} />}>
                  Added {result.added}
                </Pill>
              )
            }
          />
        );
      }}
      emptyHint="Open one with these geolocations below."
      status={
        <>
          {write.loading && <p className="text-xs text-neutral-500">Adding…</p>}
          {write.error && <ErrorNotice error={write.error} />}
          {last && !write.loading && !write.error && (
            <p role="status" className="text-xs text-neutral-300">
              {summary(last.result)}.{" "}
              <Link href={collectionHref(last.id)} className={TEXT_LINK}>
                Open the collection
              </Link>
            </p>
          )}
        </>
      }
      newCollection={() =>
        router.push(
          newCollectionFromSelectionHref({
            target,
            rows,
            count,
            from: `${window.location.pathname}${window.location.search}`,
          }),
        )
      }
    />
  );
}
