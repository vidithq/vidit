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

/** Debounce before a typed query is sent, as on the search page. */
const DEBOUNCE_MS = 300;

/** The rows in the order the collection's page reads them: event date, earliest
 *  first, undated last, then id. Mirrors `services/collections.chronological_key`,
 *  except its middle keys (`event_time`, `created_at`), which are not on the
 *  card shapes the picker reads, so same-date rows can swap places on save. */
function chronological(events: PickableEvent[]): PickableEvent[] {
  return [...events].sort(
    (a, b) =>
      (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The events a collection is being written to hold, and the search that adds to
 * them. Both the create and the edit page use it.
 *
 * **Two cards.** *Events in this collection* is what the collection holds if
 * saved now (the rows the page opened on, a `?event=` arrival, and everything
 * added since), in the collection page's order. *Add events* is the way in, at
 * most `PICKER_ROW_LIMIT` rows: the analyst's most recent eligible events, or
 * the first matches once something is typed. Neither card writes anything; the
 * page's submit does.
 *
 * **A row is `<CollectionItemCard>`** with its `action` slot: a red cross
 * removes it from the first card; an accent plus adds it on the second. A row
 * already held shows a disabled check instead of dropping out of the results.
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
}: {
  /** Whose events the add card lists: the signed-in analyst (a collection
   *  holds its owner's own work only). */
  username: string;
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
  const heldIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

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
          // The field sits in the collection form, where Enter would submit.
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
