"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
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

/**
 * The owner's shelving panel for one event: every collection they hold, each
 * with an on/off state, plus a row that opens a new one.
 *
 * Reads `GET /events/{id}/collections` (owner-only, empty collections included).
 * `New collection` links to the create page carrying this event. Each row is a
 * `<ToggleRow>` with the item count as its `description`, which sets the title
 * at reading size (titles run to 255 characters).
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
    return <div className={FORM_ERROR_BANNER}>{error}</div>;
  }
  if (rows === null) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 ? (
        /* The dividers and row padding are this list's: the described shape
           carries neither. */
        <div className="divide-y divide-neutral-800">
          {rows.map((row) => (
            <ToggleRow
              key={row.id}
              label={row.title}
              description={eventCountLabel(row.event_count)}
              on={row.in_collection}
              onToggle={() => void toggle(row)}
              className="py-2.5"
            />
          ))}
        </div>
      ) : (
        <EmptyState variant="plain" lead="No collections yet.">
          Open one and this geolocation is its first item.
        </EmptyState>
      )}

      {write.error && <div className={FORM_ERROR_BANNER}>{write.error}</div>}

      <Link href={newCollectionHref(eventId)} className={buttonClasses("ghost")}>
        <Plus size={14} strokeWidth={1.8} />
        New collection
      </Link>
    </div>
  );
}
