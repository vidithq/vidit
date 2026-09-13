import { apiFetch, apiFetchPage } from "./api";
import type { components } from "./api-types";
import { formatDate } from "./format";
import type { EventListItem, MapPoint } from "@/types";

/**
 * The collections surface: the routes, the one hand-kept cap, and the two
 * readings every collection surface prints (the meta line and the item pins).
 *
 * A collection is one analyst's own curated set of `geolocated` and `detected`
 * events, shown on their public profile. The title and a short description are
 * its free-text fields and the items order themselves by when their events
 * happened, so there is nothing else here to write.
 */

/** How long a collection title may be. Mirrors `models/event.TITLE_MAX_LENGTH`,
 *  which `schemas/collection` applies to the create and the update alike: the
 *  field stops at the cap instead of letting the server 422 a title someone
 *  just typed out. */
export const COLLECTION_TITLE_MAX_LEN = 255;

/** How long a collection description may be. Mirrors
 *  `schemas/collection.DESCRIPTION_MAX_LENGTH`, which the create and the update
 *  both apply: the field stops at the cap instead of letting the server 422 a
 *  paragraph someone just typed out. The profile bio's figure for the same
 *  class of text, kept as its own constant because the two are separate
 *  concepts. */
export const COLLECTION_DESCRIPTION_MAX_LEN = 500;

/** One collection's header, as every read surface renders it. */
export type Collection = components["schemas"]["CollectionRead"];

/** One tile of the mosaic a collection's profile card wears: the url of one
 *  item's media and the kind of file it is. The kind picks the element that can
 *  render it, since most source media are clips. */
export type CollectionCoverTile =
  components["schemas"]["CollectionCoverTile"];

/** One page of `GET /users/{username}/collections`, offset-paged. */
export type CollectionPage = components["schemas"]["CollectionList"];

/** One row of the add-to-collection panel: a collection and whether this event
 *  is already on it. */
export type CollectionMembership =
  components["schemas"]["CollectionMembershipRead"];

/** The panel's whole read, `GET /events/{id}/collections`. */
export type CollectionMemberships =
  components["schemas"]["CollectionMembershipList"];

/** The collection's page. */
export function collectionHref(id: string): string {
  return `/collections/${encodeURIComponent(id)}`;
}

/** An analyst's collections, newest first. The endpoint is offset-paged, and
 *  the profile grid walks it a page at a time: `perPage` is the grid's own page
 *  size rather than the endpoint's default, and `page` is the one the reader
 *  asked for. */
export function userCollectionsPath(
  username: string,
  perPage: number,
  page: number,
): string {
  return `/users/${encodeURIComponent(username)}/collections?page=${page}&per_page=${perPage}`;
}

/** One page of an analyst's collections. The profile grid reads its first page
 *  declaratively and calls this for each page the reader then asks for. */
export function fetchUserCollections(
  username: string,
  perPage: number,
  page: number,
): Promise<CollectionPage> {
  return apiFetch<CollectionPage>(
    userCollectionsPath(username, perPage, page),
  );
}

/** The owner's collections, each carrying whether this event is on it. */
export function eventCollectionsPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/collections`;
}

/** One page of a collection's items, oldest event first. `cursor` is null for
 *  the first page, then the value out of the `Link: rel="next"` header. */
export function collectionEventsPath(
  id: string,
  cursor: string | null,
): string {
  const base = `/collections/${encodeURIComponent(id)}/events`;
  return cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
}

/** The collection's page, opened on one step of its sequence. The step is
 *  1-based and rides the query string of the page itself, so a link says which
 *  event the sender was on and opens the page there. */
export function collectionStepHref(id: string, step: number): string {
  return `${collectionHref(id)}?step=${step}`;
}

/** How many items the page ever steps through. A collection is a curated set,
 *  so this is a ceiling on a runaway read rather than a page size: past it the
 *  page holds the first 500 items and says on screen that it stopped there. */
export const READER_MAX_ITEMS = 500;

/** A collection's items in reading order, and whether the walk hit the
 *  ceiling. */
export interface CollectionSequence {
  items: EventListItem[];
  /** True when the collection holds more than the page walks. */
  capped: boolean;
}

/**
 * Every page of a collection's items, in one read.
 *
 * The page needs the whole sequence before it can say `N of M`, so it follows
 * the `Link: rel="next"` cursor to the end rather than paging as the reader
 * steps. One read serves the pins, the panel's sequence and the list, which is
 * what keeps the three describing the same collection. A collection is a
 * curated set, and `READER_MAX_ITEMS` bounds the walk for the one that is not.
 */
export async function fetchCollectionSequence(
  id: string,
  signal?: AbortSignal,
): Promise<CollectionSequence> {
  const items: EventListItem[] = [];
  let cursor: string | null = null;
  for (;;) {
    // Annotated: `cursor` is written from this page and read to build the
    // next one, which TypeScript cannot resolve from the call alone.
    const page: { items: EventListItem[]; nextCursor: string | null } =
      await apiFetchPage<EventListItem[]>(collectionEventsPath(id, cursor), {
        signal,
      });
    items.push(...page.items);
    if (items.length >= READER_MAX_ITEMS) {
      return {
        items: items.slice(0, READER_MAX_ITEMS),
        // The last page can land exactly on the ceiling with nothing behind
        // it, which is a whole collection rather than a truncated one.
        capped: items.length > READER_MAX_ITEMS || page.nextCursor !== null,
      };
    }
    if (page.nextCursor === null) return { items, capped: false };
    cursor = page.nextCursor;
  }
}

/**
 * Which step a reader link opens on, read off `?step=`.
 *
 * The value is 1-based and clamped into the sequence, so a link to a step the
 * collection no longer holds opens on its nearest real one instead of on
 * nothing. Anything that is not a positive whole number is step 1, the same
 * answer a link carrying no step at all gets.
 */
export function readerStep(raw: string | null, total: number): number {
  if (total <= 0) return 1;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.min(Math.max(Number.parseInt(raw, 10), 1), total);
}

/** Open a collection under a title and a description, both required. */
export function createCollection(
  title: string,
  description: string,
): Promise<Collection> {
  return apiFetch<Collection>("/collections", {
    method: "POST",
    body: JSON.stringify({ title, description }),
  });
}

/** Write a collection's title and description. Both ride every edit, so one
 *  request states what the collection is and a renamed collection cannot be
 *  left describing the old one. */
export function updateCollection(
  id: string,
  title: string,
  description: string,
): Promise<Collection> {
  return apiFetch<Collection>(`/collections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title, description }),
  });
}

export function deleteCollection(id: string): Promise<void> {
  return apiFetch<void>(`/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Put one of the analyst's own events on one of their collections. Idempotent
 *  server-side, so the panel can re-send a row it is unsure about. */
export function addEventToCollection(
  collectionId: string,
  eventId: string,
): Promise<void> {
  return apiFetch<void>(
    `/collections/${encodeURIComponent(collectionId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PUT" },
  );
}

/** Take one event off a collection. Idempotent, and it never re-checks the
 *  event's state, so a membership whose event has since closed still clears. */
export function removeEventFromCollection(
  collectionId: string,
  eventId: string,
): Promise<void> {
  return apiFetch<void>(
    `/collections/${encodeURIComponent(collectionId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

/**
 * How much a collection holds, as every surface says it.
 *
 * One phrasing for the three that state it: the collection page's meta line,
 * the profile card's, and the add-to-collection panel's row, so the same
 * collection never reads as `12 events` on one surface and `12` on another.
 */
export function eventCountLabel(count: number): string {
  return `${count} event${count === 1 ? "" : "s"}`;
}

/**
 * The meta line both the page and the profile card print: how much the
 * collection holds, then the span its items cover.
 *
 * One builder for the two surfaces, so a card and the page it opens cannot
 * count or date the same collection differently. The count is always stated,
 * zero included, because an empty collection is a real thing its owner reads.
 * The span is stated only when the items carry dates (`first_date` and
 * `last_date` are both null for an empty collection and for one whose items
 * all lack a date), and a collection whose items fall on one day prints that
 * day once rather than as a range from itself to itself.
 */
export function collectionMetaSegments(collection: Collection): string[] {
  const { event_count: count, first_date: first, last_date: last } = collection;
  const segments = [eventCountLabel(count)];
  if (first && last) {
    segments.push(
      first === last
        ? formatDate(first)
        : `${formatDate(first)} to ${formatDate(last)}`,
    );
  }
  return segments;
}

/**
 * The collection's items as map points, for the shared `<Map>`.
 *
 * The items already arrived as `EventList` rows, so the pins are read off them
 * rather than fetched again: there is no points endpoint scoped to a
 * collection, and a second read would frame the map on a set the list below it
 * might not hold. An item with no coordinates carries no pin.
 *
 * The tuple's `event_date` and `added_date` slots are filled from the row's own
 * event date: `<Map>` reads the id, the pair and the `detected` flag, and the
 * two date slots are the map page's scrubber payload, which no embedded map
 * renders.
 */
export function collectionPoints(items: EventListItem[]): MapPoint[] {
  return items.flatMap((item) =>
    item.event_coords
      ? [
          [
            item.id,
            item.event_coords.lat,
            item.event_coords.lng,
            item.event_date,
            item.event_date ?? "",
            item.status === "detected" ? 1 : 0,
          ] as MapPoint,
        ]
      : [],
  );
}
