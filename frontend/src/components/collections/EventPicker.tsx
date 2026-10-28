"use client";

import { useCallback, useMemo, useRef, useState, type ComponentProps } from "react";

import { Card } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Item } from "@/components/ui/Item";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { errorMessage } from "@/lib/api";
import { errorText } from "@/lib/errors";
import {
  eventCountLabel,
  PICKER_ROW_LIMIT,
  pickerBrowsePath,
  searchPickableEvents,
  type PickableEvent,
} from "@/lib/collections";
import { eventItem } from "@/lib/items";
import { useCursorList } from "@/hooks/useCursorList";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import type { EventListItem } from "@/types";

/** Debounce before a typed query is sent, as on the search page. */
const DEBOUNCE_MS = 300;

/** The rows in the order the collection's page reads them: event date, earliest
 *  first, undated last, then id. Mirrors `services/collections.chronological_key`,
 *  except its middle keys (`event_time`, `created_at`), which are not on the
 *  card shapes the picker reads, so same-date rows can swap places on save. */
function chronological(events: PickableEvent[]): PickableEvent[] {
  return [...events].sort(
    (a, b) =>
      (a.occurred_date ?? "9999").localeCompare(b.occurred_date ?? "9999") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The events a collection is being written to hold, and the search that adds to
 * them. Both the create and the edit page use it.
 *
 * **Two cards.** *Add events* comes first, the way in: a `<Combobox>` that
 * lists at most `PICKER_ROW_LIMIT` rows, the analyst's most recent eligible
 * events, or the first matches once something is typed. *Events in this
 * collection* follows: what the collection holds if saved now (the rows the
 * page opened on, a `?event=` arrival, and everything added since), in the
 * collection page's order, as compact `<Item>` rows, each with a `<RemoveButton>`
 * at its right edge. Each add option is a compact `<Item>` too. A held row leaves the
 * add list, a pick scrolls its new row into view, and the add list stays open
 * for the next pick. Neither card writes anything; the page's submit does.
 *
 * **Two sources, one row.** With nothing typed, the add card reads the
 * analyst's catalogue through `GET /events` (`view=located`, `author=`, the two
 * collectable statuses), whose cursor tells it more exists. A typed query goes
 * to `GET /search` (`type=event`, `author=`), which answers the pre-cap count.
 * Either way a row is a `PickableEvent` (`lib/collections.ts`).
 *
 * Search answers out of its located group, which requires coordinates, while
 * browse serves every collectable event, so browse is the only way to an event
 * without coordinates. No single endpoint serves both halves.
 */
export function EventPicker({
  username,
  events,
  onAdd,
  onRemove,
  matched,
}: {
  /** Whose events the add card lists: the signed-in analyst (a collection
   *  holds its owner's own work only). */
  username: string;
  events: PickableEvent[];
  onAdd: (event: PickableEvent) => void;
  onRemove: (eventId: string) => void;
  /** A search match the save adds besides `events`, loaded a page at a time into the held card:
   *  the rows so far, how many the match holds (less the removed), the walk behind **Show more**,
   *  and the removal of one matched row. */
  matched?: {
    rows: PickableEvent[];
    total: number;
    walk: ComponentProps<typeof LoadMoreRow>["walk"] & { loading: boolean };
    onRemove: (eventId: string) => void;
  };
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const typed = query.trim();

  const buildPath = useCallback(
    (cursor: string | null) => pickerBrowsePath(username, cursor),
    [username],
  );
  const browse = useCursorList<EventListItem>(buildPath);

  // Carries its query: shown only while that query is still in the field.
  const [answer, setAnswer] = useState<{
    query: string;
    items: PickableEvent[];
    total: number;
    error: string | null;
  } | null>(null);

  // The cleanup flips `live`, so an answer to an abandoned query never lands.
  useDebouncedEffect(
    () => {
      if (!typed) return;
      let live = true;
      searchPickableEvents(username, typed)
        .then((result) => {
          if (live) setAnswer({ query: typed, ...result, error: null });
        })
        .catch((e: unknown) => {
          if (live) {
            setAnswer({
              query: typed,
              items: [],
              total: 0,
              error: errorMessage(e, "Failed to search your events"),
            });
          }
        });
      return () => {
        live = false;
      };
    },
    [typed, username],
    DEBOUNCE_MS,
  );

  const heldIds = new Set(events.map((e) => e.id));
  const matchedRows = matched?.rows;
  const held = useMemo(() => {
    const picked = new Set(events.map((e) => e.id));
    return chronological([...events, ...(matchedRows ?? []).filter((row) => !picked.has(row.id))]);
  }, [events, matchedRows]);
  // Matches not loaded yet count too, so the heading says what the save holds. A pick that is
  // also a loaded match counts once.
  const heldCount =
    events.length +
    (matched ? matched.total - matched.rows.filter((row) => heldIds.has(row.id)).length : 0);
  const matchedLoading = !!matched?.walk.loading && held.length === 0;

  // The row a pick added, scrolled into view once it renders, so the pick shows wherever the
  // list puts it.
  const added = useRef<string | null>(null);
  const revealAdded = (id: string) => (el: HTMLLIElement | null) => {
    if (!el || added.current !== id) return;
    added.current = null;
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };

  const add = (event: PickableEvent) => {
    added.current = event.id;
    onAdd(event);
  };
  const remove = ({ id }: PickableEvent) => {
    if (heldIds.has(id)) onRemove(id);
    else matched?.onRemove(id);
  };

  const searching = typed.length > 0;
  const found = answer?.query === typed ? answer : null;
  const results: PickableEvent[] = (
    searching ? (found?.items ?? []) : browse.items
  ).slice(0, PICKER_ROW_LIMIT);
  const error = searching ? (found?.error ?? null) : browse.error && errorText(browse.error);
  const loading = searching ? found === null : browse.loading;
  // What the card is not showing. A search states the pre-cap count; a browse
  // only knows another page exists. A search also cannot reach events without
  // coordinates (see the component note).
  const capped =
    found !== null && found.total > results.length
      ? `Showing ${results.length} of ${found.total} matches. Refine the search to reach the rest. `
      : "";
  const refine = searching
    ? found === null
      ? null
      : `${capped}Search reaches your events that carry coordinates; clear the field to see the rest.`
    : browse.hasMore
      ? "Showing your most recent. Search to reach the rest of your catalogue."
      : null;

  const addable = results.filter((row) => !heldIds.has(row.id));
  const empty = searching
    ? "Nothing of yours matches those words. Try fewer words, or clear the field to see your most recent."
    : "No geolocations to put on a collection yet. A collection holds your own geolocated and detected events.";
  const status = loading
    ? "Loading your geolocations…"
    : error
      ? error
      : results.length === 0
        ? empty
        : addable.length === 0
          ? `Every event on show is already in this collection. ${refine ?? ""}`.trim()
          : refine;

  const heldHeading = (
    <div className="space-y-1">
      <SectionHeading title="Events in this collection" />
      <p className="text-xs text-neutral-500">
        {eventCountLabel(heldCount)}, ordered by event date, earliest first.
      </p>
    </div>
  );

  return (
    <>
      <Card as="section">
        <div className="space-y-1">
          <SectionHeading title="Add events" />
          <p className="text-xs text-neutral-500">
            Your own geolocated and detected events, {PICKER_ROW_LIMIT} at a
            time.
          </p>
        </div>

        <Combobox
          aria-label="Add events"
          placeholder="Search your geolocations by title…"
          query={query}
          onQueryChange={setQuery}
          open={open}
          onOpenChange={setOpen}
          options={loading ? [] : addable}
          optionKey={(row) => row.id}
          renderOption={(row) => (
            <div className="min-w-0 flex-1">
              <Item variant="compact" {...eventItem(row)} href={undefined} />
            </div>
          )}
          onPick={add}
          status={status}
        />
      </Card>

      <Card as="section">
        {heldHeading}
        {held.length > 0 ? (
          <ul className="space-y-2" aria-label="Events in this collection">
            {held.map((row) => (
              <li key={row.id} ref={revealAdded(row.id)}>
                <Item
                  variant="compact"
                  {...eventItem(row)}
                  actions={
                    <RemoveButton
                      label={`Remove ${row.title} from this collection`}
                      onClick={() => remove(row)}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        ) : matchedLoading ? (
          <p className="text-sm text-neutral-500">Loading the geolocations you selected…</p>
        ) : (
          <EmptyState variant="plain" lead="Nothing on this collection yet.">
            Add your own geolocations from the search above.
          </EmptyState>
        )}
        {matched && <LoadMoreRow walk={matched.walk} />}
      </Card>
    </>
  );
}
