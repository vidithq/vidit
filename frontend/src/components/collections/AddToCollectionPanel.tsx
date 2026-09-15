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
 * It reads `GET /events/{id}/collections`, which is owner-only and lists empty
 * collections too, since putting the first event on one is what this panel is
 * for, and the `New collection` row is a link to the create page carrying this
 * event, which opens the collection with the event already on it and comes back
 * here. Each row is the app's boolean row (`<ToggleRow>`), so a tap anywhere on
 * it toggles rather than having to land on the track. It carries the
 * collection's item count as the row's `description`, which is what puts the
 * title at reading size: a title runs to 255 characters and the row's other
 * shape sets its label as a filter's 10px uppercase micro text. The count is
 * the line the surface has to say anyway, in the phrasing every collection
 * surface uses (`eventCountLabel`).
 *
 * **The toggle is optimistic, and it rolls back.** Membership is one bit and
 * both writes are idempotent, so the row flips on the click and the request
 * follows it; a refusal puts the bit back where it was and says why in the
 * panel's one error banner. The count line moves with the bit, since the row
 * states what the collection holds and the click is what changes it. Waiting for the round trip instead would leave a
 * reader who is shelving several events watching a row that has not moved, and
 * a stale bit is the one failure a rollback fully undoes.
 */
export function AddToCollectionPanel({ eventId }: { eventId: string }) {
  const { data, error } = useApiResource<CollectionMemberships>(
    eventCollectionsPath(eventId),
  );
  // The panel's own copy of the rows, so a toggle paints before its write
  // lands. Seeded from the read rather than derived from it: what the reader
  // sees after a click is local state the request either confirms or reverts.
  const [rows, setRows] = useState<CollectionMembership[] | null>(null);

  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);

  // The bit and the count move together: the count line under the title is
  // what the collection holds, so shelving an event has to add to it rather
  // than leaving the row saying the figure from before the click. A call that
  // sets the bit it already holds changes nothing, which is what keeps a
  // rollback from counting twice.
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

  // `true` on success, `undefined` when the write threw (`useMutation.run`
  // resolves to undefined then), which is what tells the caller to roll the
  // row back. The hook owns the message either way.
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
        /* The dividers and the row padding are this list's, not the
           primitive's: its described shape carries neither, the way the
           settings card supplies both for its own two rows. */
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

      {/* Opening a collection is its own page, and it carries this event, so
          the analyst lands back here with the row already on rather than
          filling a form inside a panel over the event they are reading. */}
      <Link href={newCollectionHref(eventId)} className={buttonClasses("ghost")}>
        <Plus size={14} strokeWidth={1.8} />
        New collection
      </Link>
    </div>
  );
}
