"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Plus, Search as SearchIcon } from "lucide-react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { ActionIcon, Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { CollectionIcon, type CollectionCoverTile } from "@/lib/collections";

/** Past this many collections the picker offers a field that narrows them by title. */
const FIND_FROM = 6;

const NEW_COLLECTION = (
  <>
    <Plus size={14} strokeWidth={1.8} />
    New collection
  </>
);

/** The row padding both pickers give their `<ActionRow>` or `<ToggleRow>`. */
export const PICKER_ROW = "px-2 py-1.5";

/** A row's lead picture: the collection's first cover tile as a 40px square, or the collection
 *  icon on an empty one, where the "no media" label would wrap. */
export function PickerCover({ cover }: { cover: CollectionCoverTile[] }) {
  if (cover.length === 0) {
    return (
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-600"
      >
        <CollectionIcon size={16} strokeWidth={1.8} aria-hidden />
      </div>
    );
  }
  return <CollectionCover cover={cover.slice(0, 1)} className="aspect-square size-10" />;
}

/**
 * The owner's collections in an Add to collection popover, shared by the event page (one event,
 * a switch per collection) and the search page (a selection, an Add per collection).
 *
 * Past `FIND_FROM` collections a field narrows them by title. The list scrolls inside the
 * popover, which is fixed to the viewport. `renderRow` draws one collection; `status` holds the
 * lines under the list (the write's progress, error and result). The footer's *New collection*
 * is a link to `newCollection`, or a button running it when opening the create page needs a step
 * first (the bulk add parks its selection).
 */
export function CollectionPicker<T extends { id: string; title: string }>({
  items,
  renderRow,
  emptyHint,
  status,
  newCollection,
}: {
  items: T[];
  renderRow: (item: T) => ReactNode;
  /** What *New collection* does with what is being added, under *No collections yet.* */
  emptyHint: string;
  status?: ReactNode;
  newCollection: string | (() => void);
}) {
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? items.filter((item) => item.title.toLowerCase().includes(needle))
    : items;

  return (
    <div className="space-y-3">
      {items.length >= FIND_FROM && (
        <Input
          type="search"
          icon={<SearchIcon size={14} />}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find a collection"
          aria-label="Find a collection"
        />
      )}

      {items.length === 0 ? (
        <EmptyState variant="plain" lead="No collections yet.">
          {emptyHint}
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="text-sm text-neutral-500">No collection matches.</p>
      ) : (
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {shown.map((item) => (
            <Fragment key={item.id}>{renderRow(item)}</Fragment>
          ))}
        </div>
      )}

      {status}

      {typeof newCollection === "string" ? (
        <Link href={newCollection} className={buttonClasses("ghost")}>
          <ActionIcon action="newCollection" />
          {NEW_COLLECTION}
        </Link>
      ) : (
        <Button action="newCollection" variant="ghost" onClick={newCollection}>
          {NEW_COLLECTION}
        </Button>
      )}
    </div>
  );
}
