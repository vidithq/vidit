"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
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
 * **A row is the catalogue's own compact card** in its plain mode, with its
 * lifecycle badge, its title linking to the event and one control in the
 * `action` slot. On the first block that control is the red cross that takes
 * the row off, the one a collection's own item list carries, in the same
 * corner. On the second it is an *Add* button, and a row already on the first
 * block shows a disabled *Added* instead of dropping out of the results: the
 * analyst searched for that event, and answering with nothing says less than
 * answering with the row and the reason it cannot be added twice.
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
  // What the last request was made under, empty while nothing is typed. The
  // field moves on every keystroke and this follows it a beat later, the
  // debounce the search page keeps on the same endpoint.
  const [committed, setCommitted] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setCommitted(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const buildPath = useCallback(
    (cursor: string | null) => pickerBrowsePath(username, cursor),
    [username],
  );
  const browse = useCursorList<EventListItem>(buildPath);

  // Both answers carry the query they belong to, which is what makes a result
  // from an earlier query recognisable as stale: the words move while a
  // request is in flight, and the rows of the query before them are not the
  // rows of this one.
  const [matches, setMatches] = useState<{
    query: string;
    items: PickableEvent[];
    total: number;
  } | null>(null);
  const [searchError, setSearchError] = useState<{
    query: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!committed) return;
    // An answer that lands after the field has moved on is dropped by the
    // effect's own cleanup, the rule the list walk keeps with its abort.
    let live = true;
    searchPickableEvents(username, committed)
      .then((result) => {
        if (live) setMatches({ query: committed, ...result });
      })
      .catch((e: unknown) => {
        if (live) {
          setSearchError({
            query: committed,
            message: errorMessage(e, "Failed to search your events"),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [committed, username]);

  const held = chronological(events);
  const heldIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

  const searching = committed.length > 0;
  const found = matches?.query === committed ? matches : null;
  const failed = searchError?.query === committed ? searchError : null;
  const results: PickableEvent[] = (
    searching ? (found?.items ?? []) : browse.items
  ).slice(0, PICKER_ROW_LIMIT);
  const error = searching ? (failed?.message ?? null) : browse.error;
  const loading = searching ? found === null && failed === null : browse.loading;
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
              <PickerRow
                key={row.id}
                row={row}
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
                <PickerRow
                  key={row.id}
                  row={row}
                  action={
                    <Button
                      variant="secondary"
                      disabled={added}
                      onClick={() => onAdd(row)}
                      aria-label={`${added ? "Added" : "Add"} ${row.title} to this collection`}
                    >
                      {!added && <Plus size={14} />}
                      {added ? "Added" : "Add"}
                    </Button>
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

/** One row of either block: the catalogue's own compact card carrying the
 *  block's control. The two blocks differ by that control alone, so the slots
 *  a row fills are written once. */
function PickerRow({
  row,
  action,
}: {
  row: PickableEvent;
  action: ReactNode;
}) {
  return (
    <EntityCard
      variant="compact"
      detailHref={`/events/${row.id}`}
      title={row.title}
      badge={<StatusBadge status={row.status} />}
      media={row.media ?? undefined}
      isGraphic={row.is_graphic}
      date={row.event_date ?? undefined}
      coords={row.event_coords}
      tags={row.tags}
      // Every row carries the same two lines, since the picker drops the
      // byline the way a collection's item list does: the catalogue's height
      // floor would only print a band of nothing under each of them.
      uniformHeight={false}
      action={action}
    />
  );
}
