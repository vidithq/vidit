"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { CollectionItemCard } from "@/components/collections/CollectionItemCard";
import { StatusBadge } from "@/components/event/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  HorizontalScroller,
  type HorizontalScrollerHandle,
} from "@/components/ui/HorizontalScroller";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  eventCountLabel,
  PICKER_ROW_LIMIT,
  pickerBrowsePath,
  searchPickableEvents,
  type PickableEvent,
} from "@/lib/collections";
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
 * **Two cards.** *Events in this collection* is what the collection holds if
 * saved now (the rows the page opened on, a `?event=` arrival, and everything
 * added since), in the collection page's order, as a carousel
 * `<HorizontalScroller>` of large `<CollectionItemCard>` blocks, each with its
 * own **Remove**. *Add events* is the way in: a `<Combobox>` that lists at most
 * `PICKER_ROW_LIMIT` rows, the analyst's most recent eligible events, or the
 * first matches once something is typed. A held row leaves the list, a pick
 * moves the carousel to it, and the list stays open for the next pick. Neither
 * card writes anything; the page's submit does.
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
  hideEmpty = false,
  heldLoading = false,
  heldNote,
}: {
  /** Whose events the add card lists: the signed-in analyst (a collection
   *  holds its owner's own work only). */
  username: string;
  events: PickableEvent[];
  onAdd: (event: PickableEvent) => void;
  onRemove: (eventId: string) => void;
  /** Drops the held card while it is empty: a search selection the save adds already says what
   *  the collection opens with. */
  hideEmpty?: boolean;
  /** Rows the page opened with are still loading (a search selection's events). */
  heldLoading?: boolean;
  /** A line under the held card's heading: what the page could not load into it. */
  heldNote?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const typed = query.trim();
  const scroller = useRef<HorizontalScrollerHandle>(null);
  // The row the carousel shows once `events` changes: the pick, or a removed row's neighbour.
  const reveal = useRef<string | null>(null);

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

  const held = chronological(events);
  const heldIds = new Set(events.map((e) => e.id));

  useEffect(() => {
    const id = reveal.current;
    reveal.current = null;
    if (!id) return;
    const index = chronological(events).findIndex((e) => e.id === id);
    if (index >= 0) scroller.current?.show(index);
  }, [events]);

  const add = (event: PickableEvent) => {
    reveal.current = event.id;
    onAdd(event);
  };
  const remove = (index: number) => {
    reveal.current = (held[index + 1] ?? held[index - 1])?.id ?? null;
    onRemove(held[index].id);
  };

  const searching = typed.length > 0;
  const found = answer?.query === typed ? answer : null;
  const results: PickableEvent[] = (
    searching ? (found?.items ?? []) : browse.items
  ).slice(0, PICKER_ROW_LIMIT);
  const error = searching ? (found?.error ?? null) : browse.error;
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
        {eventCountLabel(held.length)}, ordered by event date, earliest first.
      </p>
      {heldNote && <p className="text-xs text-neutral-500">{heldNote}</p>}
    </div>
  );

  return (
    <>
      {(held.length > 0 || !hideEmpty) && (
        <Card as="section">
          {held.length > 0 ? (
            <HorizontalScroller
              ref={scroller}
              variant="carousel"
              heading={heldHeading}
              label="Events in this collection"
              previousLabel="Previous event"
              nextLabel="Next event"
              dotLabel={(index) => `Show event ${index + 1}`}
            >
              {held.map((row, index) => (
                <div key={row.id} className="space-y-2">
                  <CollectionItemCard item={row} />
                  <div className="flex justify-end">
                    <Button
                      variant="dangerGhost"
                      onClick={() => remove(index)}
                      aria-label={`Remove ${row.title} from this collection`}
                    >
                      <X size={13} />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </HorizontalScroller>
          ) : (
            <>
              {heldHeading}
              {heldLoading ? (
                <p className="text-sm text-neutral-500">Loading the selected geolocations…</p>
              ) : (
                <EmptyState variant="plain" lead="Nothing on this collection yet.">
                  Add your own geolocations from the search below.
                </EmptyState>
              )}
            </>
          )}
        </Card>
      )}

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
            <>
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              {row.occurred_date && (
                <span className="shrink-0 text-xs text-neutral-500">
                  {formatDate(row.occurred_date)}
                </span>
              )}
              <StatusBadge status={row.status} />
            </>
          )}
          onPick={add}
          status={status}
        />
      </Card>
    </>
  );
}
