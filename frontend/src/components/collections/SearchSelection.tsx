"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { BulkAddToCollectionPanel } from "@/components/collections/BulkAddToCollectionPanel";
import { Button, ICON_TAP_STEP } from "@/components/ui/Button";
import { PopoverPanel } from "@/components/ui/Popover";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import {
  BULK_ADD_MAX_EVENTS,
  COLLECTABLE_STATUSES,
  countCollectableMatches,
  pickableFromHit,
  type BulkTarget,
  type SearchMatchParams,
} from "@/lib/collections";
import { creditedAuthors } from "@/lib/geolocatorCredit";
import type { SearchEventHit } from "@/types";

/** Explicit rows, or every collectable event the search matches, resolved by the server. */
type Picked = { kind: "ids"; ids: ReadonlySet<string> } | { kind: "all" };

const NONE: Picked = { kind: "ids", ids: new Set() };

export type SearchSelection = ReturnType<typeof useSearchSelection>;

/**
 * The search page's Geolocations selection, for a bulk add to one collection.
 *
 * A row is selectable when the signed-in reader is credited on it and its status is one a
 * collection holds: the add verb's own rule (`services/collections.ensure_collectable`), as on the
 * event page's Add to collection. The selection belongs to one `match`: a new query or filter set
 * starts empty. **Select all** hands the server the match rather than ids, so it covers every
 * matching event, loaded or not; `matchTotal` is that set's size
 * (`POST /collections/collectable-count`), read as soon as a loaded row is selectable, since
 * the head row's label depends on it.
 */
export function useSearchSelection(match: SearchMatchParams, hits: SearchEventHit[]) {
  const { user } = useAuth();
  const key = JSON.stringify(match);
  const [state, setState] = useState<{ key: string; picked: Picked }>({ key, picked: NONE });
  const picked = state.key === key ? state.picked : NONE;
  const set = (next: Picked) => setState({ key, picked: next });

  const canSelect = (hit: SearchEventHit) =>
    !!user &&
    COLLECTABLE_STATUSES.includes(hit.status) &&
    creditedAuthors(hit).some((a) => a.id === user.id);
  const isSelected = (id: string) => picked.kind === "all" || picked.ids.has(id);
  const active = picked.kind === "all" || picked.ids.size > 0;

  const gutter = hits.some(canSelect);
  const [counted, setCounted] = useState<{ key: string; total: number } | null>(null);
  useEffect(() => {
    if (!gutter) return;
    const controller = new AbortController();
    countCollectableMatches(JSON.parse(key) as SearchMatchParams, controller.signal)
      .then((total) => setCounted({ key, total }))
      // No count, no Select all: the rows stay pickable one by one.
      .catch(() => {});
    return () => controller.abort();
  }, [gutter, key]);
  const matchTotal = counted?.key === key ? counted.total : null;

  const toggle = (hit: SearchEventHit) => {
    // Unpicking one row out of "all" keeps the loaded rows: the rest were never on screen.
    const ids = new Set(
      picked.kind === "all" ? hits.filter(canSelect).map((h) => h.id) : picked.ids,
    );
    if (picked.kind === "ids" && !ids.has(hit.id)) ids.add(hit.id);
    else ids.delete(hit.id);
    set({ kind: "ids", ids });
  };

  const target: BulkTarget =
    picked.kind === "all" ? { match } : { eventIds: [...picked.ids] };
  // Checked rows are always loaded hits, so a new collection can open holding them as they are.
  const rows = picked.kind === "all" ? [] : hits.filter((h) => picked.ids.has(h.id)).map(pickableFromHit);

  return {
    username: user?.username ?? null,
    count: picked.kind === "all" ? (matchTotal ?? 0) : picked.ids.size,
    all: picked.kind === "all",
    matchTotal,
    target,
    rows,
    /** Some loaded row is selectable, so every row takes the checkbox column. */
    gutter,
    canSelect,
    isSelected,
    toggle,
    selectAll: () => set({ kind: "all" }),
    clear: () => set(NONE),
  };
}

/** Add to collection, for `PageShell`'s `stickyActions`. The page mounts it while a loaded row
 *  is selectable and marks it idle while nothing is selected, so the header keeps its height. */
export function SearchSelectionActions({ selection }: { selection: SearchSelection }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { username } = selection;
  if (!username) return null;

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) anchorRef.current?.focus();
  };

  return (
    <>
      <Button
        action="collect"
        ref={anchorRef}
        variant="primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Add to collection
      </Button>
      {open && (
        <PopoverPanel label="Add to collection" anchorRef={anchorRef} onClose={close}>
          <BulkAddToCollectionPanel
            username={username}
            target={selection.target}
            rows={selection.rows}
            count={selection.count}
          />
        </PopoverPanel>
      )}
    </>
  );
}

/** The list's head row in the checkbox column: one tri-state checkbox over every matching event,
 *  loaded or not. Empty, it selects them all; holding anything, it clears. Its line says
 *  *Select all*, the count held, or, past the bulk add's cap with nothing held, why Select all is
 *  out of reach (the box is then disabled, as it is until the count arrives). */
export function SelectAllRow({ selection }: { selection: SearchSelection }) {
  const { gutter, matchTotal, count } = selection;
  if (!gutter) return null;
  const overCap = matchTotal !== null && matchTotal > BULK_ADD_MAX_EVENTS;
  const full = selection.all || (matchTotal !== null && count >= matchTotal);
  return (
    <label className="flex cursor-pointer items-center gap-1 text-xs text-neutral-400 has-disabled:cursor-default">
      <span className={cn(ICON_TAP_STEP, "sm:size-8 flex shrink-0 items-center justify-center")}>
        <input
          type="checkbox"
          className="accent-orange-400"
          checked={full}
          ref={(el) => {
            if (el) el.indeterminate = count > 0 && !full;
          }}
          disabled={count === 0 && (overCap || matchTotal === null)}
          onChange={() => (count > 0 ? selection.clear() : selection.selectAll())}
          aria-label={count > 0 ? "Clear selection" : "Select all"}
        />
      </span>
      <span aria-live="polite">
        {count > 0
          ? `${count} selected`
          : overCap
            ? `Narrow to ${BULK_ADD_MAX_EVENTS} or fewer to select all`
            : "Select all"}
      </span>
    </label>
  );
}

/** One Geolocations hit with its checkbox column: a native checkbox on a row the reader can
 *  shelve, an empty column on any other, so the cards stay aligned. No column at all when no
 *  loaded row is selectable. The tick takes the accent through `accent-color`, at `TEXT_LINK`'s
 *  step, so it follows the reader's accent like every other `orange-*` utility. */
export function SelectableHit({
  hit,
  selection,
  children,
}: {
  hit: SearchEventHit;
  selection: SearchSelection;
  children: ReactNode;
}) {
  if (!selection.gutter) return <>{children}</>;
  return (
    <div className="flex items-start gap-1">
      <div className={cn(ICON_TAP_STEP, "sm:size-8 shrink-0")}>
        {selection.canSelect(hit) && (
          <label className="flex size-full cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              className="accent-orange-400"
              checked={selection.isSelected(hit.id)}
              onChange={() => selection.toggle(hit)}
              aria-label={`Select ${hit.title}`}
            />
          </label>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
