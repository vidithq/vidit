"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { Input } from "@/components/ui/Input";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { errorMessage } from "@/lib/api";
import {
  PICKER_SEARCH_LIMIT,
  pickerBrowsePath,
  searchPickableEvents,
  selectedCountLabel,
  type PickableEvent,
} from "@/lib/collections";
import { useCursorList } from "@/hooks/useCursorList";
import type { EventListItem } from "@/types";

/** How long the field waits before a typed query is sent, the debounce the
 *  search page uses on the same endpoint. */
const DEBOUNCE_MS = 300;

/**
 * The analyst's own events, to pick the ones a collection holds.
 *
 * Both collection writes carry it, opening one and editing one, so the set a
 * collection holds is chosen where its title and description are written
 * rather than one event at a time afterwards.
 *
 * **Two sources, one row.** With nothing typed the block browses the analyst's
 * catalogue newest first through `GET /events` (`view=located`, `author=`,
 * scoped to the two statuses a collection may hold), which is the cursor-paged
 * endpoint, so `Show more` walks the whole catalogue a page at a time. A typed
 * query goes to `GET /search` (`type=event`, `author=`), the endpoint that
 * reads words, which answers one capped group and hands out no cursor: the
 * block says how many matched when it is showing fewer, and narrowing the
 * words is how a reader reaches the rest. Either way a row is a `PickableEvent`
 * ([`lib/collections.ts`](../../lib/collections.ts)), so the two sources render
 * as one list.
 *
 * **A row is the catalogue's own compact card**, with its lifecycle badge, and
 * ticking one is `<EntityCard>`'s `selected` / `onSelect`: the stretched
 * surface becomes the button that picks the row and the title renders as
 * plain text, a row carrying one gesture, the shape the collection page's step
 * list already takes. So the picker grows no checkbox of its own, and a row
 * here reads as the same object as the same event in a search result or on a
 * profile.
 *
 * **The selection is ids, and it survives the query.** The parent holds them,
 * so a row ticked while browsing is still ticked after a search that does not
 * list it, and the count line above the list says how many stand, whatever the
 * list below is showing.
 */
export function EventPicker({
  username,
  selectedIds,
  onToggle,
}: {
  /** Whose events the picker lists: the signed-in analyst, since a collection
   *  holds its owner's own work and nothing else. */
  username: string;
  /** The ids ticked so far, held by the form that submits them. */
  selectedIds: Set<string>;
  onToggle: (eventId: string) => void;
}) {
  const [query, setQuery] = useState("");
  // What the last request was made under, `null` while nothing is typed. The
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

  const searching = committed.length > 0;
  const found = matches?.query === committed ? matches : null;
  const failed = searchError?.query === committed ? searchError : null;
  const rows: PickableEvent[] = searching ? (found?.items ?? []) : browse.items;
  const error = searching ? (failed?.message ?? null) : browse.error;
  const loading = searching ? found === null && failed === null : browse.loading;
  // How many matched past what the group carries. The search endpoint caps its
  // group and offers no next page, so the block states the figure instead of
  // offering a walk it cannot take.
  const beyondTheCap = found === null ? 0 : found.total - found.items.length;

  return (
    <div className="space-y-3">
      <span className="flex items-center justify-between gap-2">
        <span className={FORM_LABEL}>Events</span>
        <span className="text-xs text-neutral-500">
          {selectedCountLabel(selectedIds.size)}
        </span>
      </span>

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

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          variant="plain"
          lead={
            searching
              ? "Nothing of yours matches those words."
              : "No geolocations to put on a collection yet."
          }
        >
          {searching
            ? "Try fewer words, or clear the field to browse everything you have."
            : "A collection holds your own geolocated and detected events."}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => {
            const picked = selectedIds.has(row.id);
            return (
              <EntityCard
                key={row.id}
                variant="compact"
                detailHref={`/events/${row.id}`}
                title={row.title}
                badge={<StatusBadge status={row.status} />}
                media={row.media ?? undefined}
                isGraphic={row.is_graphic}
                date={row.event_date ?? undefined}
                coords={row.event_coords}
                tags={row.tags}
                selected={picked}
                onSelect={() => onToggle(row.id)}
                selectLabel={
                  picked
                    ? `Take ${row.title} off this collection`
                    : `Put ${row.title} on this collection`
                }
                // Every row carries the same two lines, since the picker drops
                // the byline the way a collection's item list does: the
                // catalogue's height floor would only print a band of nothing
                // under each of them.
                uniformHeight={false}
              />
            );
          })}
        </div>
      )}

      {beyondTheCap > 0 && (
        <p className="text-xs text-neutral-500">
          {`Showing the first ${PICKER_SEARCH_LIMIT} of ${found?.total} matches. Narrow the words to reach the rest.`}
        </p>
      )}

      {!searching && browse.hasMore && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={browse.loadingMore}
            onClick={browse.loadMore}
          >
            {browse.loadingMore ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
