"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

import { CollectionItemCard } from "@/components/collections/CollectionItemCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { errorMessage } from "@/lib/api";
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

/** How long the field waits before a typed query is sent, the debounce the
 *  search page uses on the same endpoint. */
const DEBOUNCE_MS = 300;

/** The rows a collection holds, in the order its page reads them: by when the
 *  events happened, earliest first. A row with no date sits at the end, since
 *  there is nothing to place it against. The server orders a stored collection
 *  this way (`services/collections.chronological_key`), so the pending list and
 *  the collection it becomes read alike.
 *
 *  Two rows sharing a date fall back to their id, the server's last key, which
 *  is what makes the order total: without it two same-day rows sit in whichever
 *  order they were picked in, and the collection reorders them on save. The
 *  server's middle keys, `event_time` then `created_at`, are not on the card
 *  shape either half of the picker reads (`EventList`, `SearchEventHit`), so
 *  two rows sharing a date and differing in time can still swap places between
 *  this list and the saved collection. */
function chronological(events: PickableEvent[]): PickableEvent[] {
  return [...events].sort(
    (a, b) =>
      (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The events a collection is being written to hold, and the search that adds
 * to them.
 *
 * Both collection writes carry it, opening one and editing one, so the set a
 * collection holds is chosen where its title and description are written
 * rather than one event at a time afterwards. The two pages read the same:
 * nothing here knows which of them it is standing on.
 *
 * **Two cards, and the first one is the answer.** *Events in this collection*
 * is what the collection will hold if the analyst saves now: the rows the edit
 * page opened on, the one event a `?event=` create arrived with, and everything
 * added since, under the count line and the order the collection's own page
 * takes. *Add events* is the way in, and it is deliberately short: at most
 * `PICKER_ROW_LIMIT` rows, the most recent of the analyst's own eligible events
 * with nothing typed and the first matches once something is. Neither card
 * writes anything: both move rows in and out of the pending list the form
 * holds, and the page's own submit is what reaches the server.
 *
 * **A row is `<CollectionItemCard>`**, the row every collection surface
 * renders, here in its plain mode: the title links to the event and the card's
 * own control fills the `action` slot, the same icon-button shape on both
 * cards. On the first card that control is the red cross that takes the row
 * off, the one control that lets an item leave a collection anywhere on the
 * site. On the second it is an accent plus icon that adds the row, and a row
 * already on the first card shows a disabled check icon instead of dropping
 * out of the results: the analyst searched for that event, and answering with
 * nothing says less than answering with the row and the reason it cannot be
 * added twice.
 *
 * **Two sources, one row.** With nothing typed the add card reads the
 * analyst's catalogue newest first through `GET /events` (`view=located`,
 * `author=`, scoped to the two statuses a collection may hold), the
 * cursor-paged endpoint, whose cursor is how the card knows more stands behind
 * the rows it shows. A typed query goes to `GET /search` (`type=event`,
 * `author=`), the endpoint that reads words, which answers the pre-cap match
 * count beside its rows. Either way a row is a `PickableEvent`
 * ([`lib/collections.ts`](../../lib/collections.ts)), and either way the line
 * under the rows says how many there are and that narrowing the words is how to
 * reach them.
 *
 * The two halves serve different sets in one respect, and the line under the
 * rows says so: search answers out of its located group, which requires
 * coordinates, while the browse list serves every collectable event. A
 * collection may hold an event with no coordinates, so the browse list is the
 * only way to one. `GET /events` reads no words, so there is no one endpoint
 * to put both halves on.
 */
export function EventPicker({
  username,
  events,
  onAdd,
  onRemove,
}: {
  /** Whose events the add card lists: the signed-in analyst, since a
   *  collection holds its owner's own work and nothing else. */
  username: string;
  /** What the collection will hold, held by the form that submits it. */
  events: PickableEvent[];
  onAdd: (event: PickableEvent) => void;
  onRemove: (eventId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim();

  const buildPath = useCallback(
    (cursor: string | null) => pickerBrowsePath(username, cursor),
    [username],
  );
  const browse = useCursorList<EventListItem>(buildPath);

  // The one answer the typed half holds, carrying the query it belongs to:
  // the words move while a request is in flight, and the rows of the query
  // before them are not the rows of this one, so the card shows an answer
  // only while its query is still the one in the field.
  const [answer, setAnswer] = useState<{
    query: string;
    items: PickableEvent[];
    total: number;
    error: string | null;
  } | null>(null);

  // The debounce the search page keeps on the same endpoint. The in-flight
  // guard rides the effect's cleanup, which runs the moment the field moves
  // on, so an answer to a query the reader has left never lands.
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
  const heldIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

  const searching = typed.length > 0;
  const found = answer?.query === typed ? answer : null;
  const results: PickableEvent[] = (
    searching ? (found?.items ?? []) : browse.items
  ).slice(0, PICKER_ROW_LIMIT);
  const error = searching ? (found?.error ?? null) : browse.error;
  const loading = searching ? found === null : browse.loading;
  // What the card is not showing. A search states the figure, since the
  // endpoint answers the pre-cap count; a browse only knows there is another
  // page, which is enough to say that the search is the way past these rows.
  //
  // A search also says what it cannot reach at all: `/search` serves its
  // located group, which requires coordinates, while the browse list serves
  // every collectable event of the analyst's. So an event carrying no
  // coordinates answers no query here, and clearing the field is the only way
  // to it.
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

  return (
    <>
      <Card as="section">
        <div className="space-y-1">
          <SectionEyebrow title="Events in this collection" margin="none" />
          <p className="text-xs text-neutral-500">
            {eventCountLabel(held.length)}, ordered by event date, earliest
            first.
          </p>
        </div>

        {held.length > 0 ? (
          <div className="space-y-2">
            {held.map((row) => (
              <CollectionItemCard
                key={row.id}
                item={row}
                action={
                  <Button
                    icon
                    variant="dangerGhost"
                    onClick={() => onRemove(row.id)}
                    aria-label={`Remove ${row.title} from this collection`}
                    title="Remove from collection"
                  >
                    <X size={14} />
                  </Button>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState variant="plain" lead="Nothing on this collection yet.">
            Add your own geolocations from the search below.
          </EmptyState>
        )}
      </Card>

      <Card as="section">
        <div className="space-y-1">
          <SectionEyebrow title="Add events" margin="none" />
          <p className="text-xs text-neutral-500">
            Your own geolocated and detected events, {PICKER_ROW_LIMIT} at a
            time.
          </p>
        </div>

        <Input
          type="search"
          icon={<Search size={14} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // The field sits inside the collection form, where Enter submits.
          // Typing words and pressing Enter has to search, not write the
          // collection the analyst is still choosing the events for: the rows
          // arrive on the debounce, so the key has nothing left to do.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="Search your geolocations by title…"
        />

        {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

        {loading && !error && (
          <p className="text-sm text-neutral-500">Loading your geolocations…</p>
        )}

        {!loading && !error && results.length === 0 && (
          <EmptyState
            variant="plain"
            lead={
              searching
                ? "Nothing of yours matches those words."
                : "No geolocations to put on a collection yet."
            }
          >
            {searching
              ? "Try fewer words, or clear the field to see your most recent."
              : "A collection holds your own geolocated and detected events."}
          </EmptyState>
        )}

        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((row) => {
              const added = heldIds.has(row.id);
              return (
                <CollectionItemCard
                  key={row.id}
                  item={row}
                  action={
                    added ? (
                      <Button
                        icon
                        variant="ghost"
                        disabled
                        aria-label="Already in this collection"
                        title="Already in this collection"
                      >
                        <Check size={14} />
                      </Button>
                    ) : (
                      <Button
                        icon
                        variant="ghost"
                        onClick={() => onAdd(row)}
                        aria-label={`Add ${row.title} to this collection`}
                        title="Add to collection"
                      >
                        <Plus size={14} />
                      </Button>
                    )
                  }
                />
              );
            })}
          </div>
        )}

        {refine && <p className="text-xs text-neutral-500">{refine}</p>}
      </Card>
    </>
  );
}
