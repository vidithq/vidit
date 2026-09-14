"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

import { CollectionItemCard } from "@/components/collections/CollectionItemCard";
import { Button } from "@/components/ui/Button";
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
 *  this way, so the pending list and the collection it becomes read alike. */
function chronological(events: PickableEvent[]): PickableEvent[] {
  return [...events].sort((a, b) =>
    (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999"),
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
 * **Two blocks, and the first one is the answer.** *Events in this collection*
 * is what the collection will hold if the analyst saves now: the rows the edit
 * page opened on, the one event a `?event=` create arrived with, and everything
 * added since, under the count line and the order the collection's own page
 * takes. *Add events* is the way in, and it is deliberately short: at most
 * `PICKER_ROW_LIMIT` rows, the most recent of the analyst's own eligible events
 * with nothing typed and the first matches once something is. Neither block
 * writes anything: both move rows in and out of the pending list the form
 * holds, and the page's own submit is what reaches the server.
 *
 * **A row is `<CollectionItemCard>`**, the row every collection surface
 * renders, here in its plain mode: the title links to the event and the block's
 * own control fills the `action` slot, the same icon-button shape on both
 * blocks. On the first block that control is the red cross that takes the row
 * off, the one control that lets an item leave a collection anywhere on the
 * site. On the second it is an accent plus icon that adds the row, and a row
 * already on the first block shows a disabled check icon instead of dropping
 * out of the results: the analyst searched for that event, and answering with
 * nothing says less than answering with the row and the reason it cannot be
 * added twice.
 *
 * **Two sources, one row.** With nothing typed the add block reads the
 * analyst's catalogue newest first through `GET /events` (`view=located`,
 * `author=`, scoped to the two statuses a collection may hold), the
 * cursor-paged endpoint, whose cursor is how the block knows more stands behind
 * the rows it shows. A typed query goes to `GET /search` (`type=event`,
 * `author=`), the endpoint that reads words, which answers the pre-cap match
 * count beside its rows. Either way a row is a `PickableEvent`
 * ([`lib/collections.ts`](../../lib/collections.ts)), and either way the line
 * under the rows says how many there are and that narrowing the words is how to
 * reach them.
 */
export function EventPicker({
  username,
  events,
  onAdd,
  onRemove,
}: {
  /** Whose events the add block lists: the signed-in analyst, since a
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
  // before them are not the rows of this one, so the block shows an answer
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
  // What the block is not showing. A search states the figure, since the
  // endpoint answers the pre-cap count; a browse only knows there is another
  // page, which is enough to say that the search is the way past these rows.
  const refine = searching
    ? found !== null && found.total > results.length
      ? `Showing ${results.length} of ${found.total} matches. Refine the search to reach the rest.`
      : null
    : browse.hasMore
      ? "Showing your most recent. Search to reach the rest of your catalogue."
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <SectionEyebrow
            title="Events in this collection"
            as="h3"
            margin="none"
          />
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
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <SectionEyebrow title="Add events" as="h3" margin="none" />
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
      </div>
    </div>
  );
}
