"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { CollectionTitleForm } from "@/components/collections/CollectionTitleForm";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  addEventToCollection,
  createCollection,
  eventCollectionsPath,
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
 * for. Each row is the app's boolean row (`<ToggleRow>`), so a tap anywhere on
 * it toggles rather than having to land on the track.
 *
 * **The toggle is optimistic, and it rolls back.** Membership is one bit and
 * both writes are idempotent, so the row flips on the click and the request
 * follows it; a refusal puts the bit back where it was and says why in the
 * panel's one error banner. Waiting for the round trip instead would leave a
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
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);

  const setMembership = (id: string, on: boolean) =>
    setRows((current) =>
      current === null
        ? current
        : current.map((row) =>
            row.id === id ? { ...row, in_collection: on } : row,
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

  const create = useMutation(
    async (title: string) => {
      const collection = await createCollection(title);
      await addEventToCollection(collection.id, eventId);
      return collection;
    },
    {
      fallback: "Failed to create the collection",
      onSuccess: (collection) => {
        setCreating(false);
        // Appended rather than re-read: the new collection holds this event
        // and nothing else, so the panel already knows its whole state.
        setRows((current) => [
          ...(current ?? []),
          { id: collection.id, title: collection.title, in_collection: true },
        ]);
      },
    },
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
        <div>
          {rows.map((row) => (
            <ToggleRow
              key={row.id}
              label={row.title}
              on={row.in_collection}
              onToggle={() => void toggle(row)}
            />
          ))}
        </div>
      ) : (
        !creating && (
          <EmptyState variant="plain" lead="No collections yet.">
            Open one and this geolocation is its first item.
          </EmptyState>
        )
      )}

      {write.error && <div className={FORM_ERROR_BANNER}>{write.error}</div>}

      {creating ? (
        <CollectionTitleForm
          submitLabel="Create and add"
          busy={create.loading}
          error={create.error}
          onSubmit={(title) => void create.run(title)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={14} strokeWidth={1.8} />
          New collection
        </Button>
      )}
    </div>
  );
}
