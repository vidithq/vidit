"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, Search as SearchIcon } from "lucide-react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { ActionRow } from "@/components/ui/ActionRow";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
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

/** One page of the owner's list at the endpoint's page cap (`services/pagination.MAX_PAGE_SIZE`);
 *  older collections past it are absent, as in the event page's panel. */
const PANEL_COLLECTIONS = 100;

/** Past this many collections the panel offers a field that narrows them by title. */
const FIND_FROM = 6;

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
 * Each collection is an `<ActionRow>`: its lead cover tile as a 40px square, the title, and its
 * item count. No heading, since the search page's head row already counts the selection, and the
 * popover's `PopoverPanel` names the dialog. The whole row adds; once the write lands the row
 * reads *Added N* and its count moves, and the line under the list says what the write did and
 * links to the collection. Past `FIND_FROM` collections a field narrows them by title.
 * The footer opens `/collections/new` carrying the selection (`newCollectionFromSelectionHref`).
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
  const [find, setFind] = useState("");

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

  const needle = find.trim().toLowerCase();
  const shown = needle
    ? data.items.filter((row) => row.title.toLowerCase().includes(needle))
    : data.items;

  return (
    <div className="space-y-3">
      {data.items.length >= FIND_FROM && (
        <Input
          type="search"
          icon={<SearchIcon size={14} />}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find a collection"
          aria-label="Find a collection"
        />
      )}

      {data.items.length === 0 ? (
        <EmptyState variant="plain" lead="No collections yet.">
          Open one with these geolocations below.
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="text-sm text-neutral-500">No collection matches.</p>
      ) : (
        /* The list scrolls inside the popover, which is fixed to the viewport. */
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {shown.map((row) => {
            const result = done[row.id];
            return (
              <ActionRow
                key={row.id}
                leading={
                  <CollectionCover
                    cover={row.cover.slice(0, 1)}
                    className="aspect-square size-10"
                  />
                }
                label={row.title}
                description={eventCountLabel(row.event_count + (result?.added ?? 0))}
                actionLabel="Add"
                aria-label={`Add to ${row.title}`}
                disabled={write.loading}
                onAct={() => void write.run(row.id)}
                className="py-1.5"
                done={
                  result && (
                    <Pill tone="accent" icon={<Check size={11} />}>
                      Added {result.added}
                    </Pill>
                  )
                }
              />
            );
          })}
        </div>
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

      <Button
        variant="ghost"
        onClick={() =>
          router.push(
            newCollectionFromSelectionHref({
              target,
              rows,
              count,
              from: `${window.location.pathname}${window.location.search}`,
            }),
          )
        }
      >
        <Plus size={14} strokeWidth={1.8} />
        New collection
      </Button>
    </div>
  );
}
