"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ActionIcon, Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ItemSearch } from "@/components/ui/ItemSearch";
import { collectionItem, type ItemCollection } from "@/lib/items";

/** Past this many collections the picker offers a search over them by title. */
const FIND_FROM = 6;

const NEW_COLLECTION = (
  <>
    <Plus size={14} strokeWidth={1.8} />
    New collection
  </>
);

/**
 * The owner's collections in an Add to collection popover, shared by the event page (one event,
 * a switch per collection) and the search page (a selection, an Add per collection).
 *
 * Past `FIND_FROM` collections an `<ItemSearch>` finds one by title, and a pick runs `onPick`, the
 * row's own action. The list scrolls inside the popover, which is fixed to the viewport.
 * `renderRow` draws one collection; `status` holds the
 * lines under the list (the write's progress, error and result). The footer's *New collection*
 * is a link to `newCollection`, or a button running it when opening the create page needs a step
 * first (the bulk add parks its selection).
 */
export function CollectionPicker<T extends ItemCollection & { id: string }>({
  items,
  renderRow,
  onPick,
  done,
  emptyHint,
  status,
  newCollection,
}: {
  items: T[];
  renderRow: (item: T) => ReactNode;
  onPick: (item: T) => void;
  /** Collections the search leaves out, since the pick already applies to them. */
  done: (item: T) => boolean;
  /** What *New collection* does with what is being added, under *No collections yet.* */
  emptyHint: string;
  status?: ReactNode;
  newCollection: string | (() => void);
}) {
  return (
    <div className="space-y-3">
      {items.length >= FIND_FROM && (
        <ItemSearch
          options={items}
          minChars={1}
          toItem={(item) => ({ ...collectionItem(item), href: undefined })}
          rowKey={(item) => item.id}
          hide={done}
          onPick={onPick}
          placeholder="Find a collection"
          aria-label="Find a collection"
          emptyText="No collection matches."
          hiddenText="Already added."
        />
      )}

      {items.length === 0 ? (
        <EmptyState variant="plain" lead="No collections yet.">
          {emptyHint}
        </EmptyState>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {items.map((item) => (
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
