"use client";

import { useEffect, useState } from "react";

import {
  CollectionPicker,
  PICKER_ROW,
  PickerCover,
} from "@/components/collections/CollectionPicker";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  addEventToCollection,
  eventCollectionsPath,
  eventCountLabel,
  newCollectionHref,
  removeEventFromCollection,
  type CollectionMembership,
  type CollectionMemberships,
} from "@/lib/collections";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/**
 * The owner's shelving panel for one event: every collection they hold, each
 * with an on/off state, in the `<CollectionPicker>` the search page's bulk add
 * shares.
 *
 * Reads `GET /events/{id}/collections` (owner-only, empty collections included).
 * `New collection` opens the create page carrying this event. Each row is a
 * `<ToggleRow>` led by the collection's cover, with the item count as its
 * `description`, which sets the title at reading size (titles run to 255 characters).
 *
 * **The toggle is optimistic and rolls back.** Membership is one bit and both
 * writes are idempotent, so the row flips on the click; a refusal restores the
 * bit and shows the error banner. The count moves with the bit.
 */
export function AddToCollectionPanel({ eventId }: { eventId: string }) {
  const { data, error } = useApiResource<CollectionMemberships>(
    eventCollectionsPath(eventId),
  );
  // Local copy so a toggle paints before its write lands.
  const [rows, setRows] = useState<CollectionMembership[] | null>(null);

  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);

  // The bit and the count move together. Setting the bit it already holds is a
  // no-op, so a rollback never counts twice.
  const setMembership = (id: string, on: boolean) =>
    setRows((current) =>
      current === null
        ? current
        : current.map((row) =>
            row.id === id && row.in_collection !== on
              ? {
                  ...row,
                  in_collection: on,
                  event_count: Math.max(0, row.event_count + (on ? 1 : -1)),
                }
              : row,
          ),
    );

  // `undefined` when the write threw: the caller rolls back.
  const write = useMutation(
    async (collectionId: string, on: boolean) => {
      if (on) await addEventToCollection(collectionId, eventId);
      else await removeEventFromCollection(collectionId, eventId);
      return true as const;
    },
    { fallback: "Failed to update the collection" },
  );

  const toggle = async (row: CollectionMembership) => {
    const on = !row.in_collection;
    setMembership(row.id, on);
    const ok = await write.run(row.id, on);
    if (!ok) setMembership(row.id, row.in_collection);
  };

  if (error) {
    return <ErrorNotice error={error} />;
  }
  if (rows === null) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }

  return (
    <CollectionPicker
      items={rows}
      renderRow={(row) => (
        <ToggleRow
          leading={<PickerCover cover={row.cover} />}
          label={row.title}
          description={eventCountLabel(row.event_count)}
          on={row.in_collection}
          onToggle={() => void toggle(row)}
          className={PICKER_ROW}
        />
      )}
      emptyHint="Open one and this geolocation is its first item."
      status={write.error && <ErrorNotice error={write.error} />}
      newCollection={newCollectionHref(eventId)}
    />
  );
}
