import { Layers } from "lucide-react";

import { apiFetch, apiFetchPage } from "./api";
import type { components } from "./api-types";
import { eventListPath, type ContentReport } from "./events";
import { formatDate } from "./format";
import { search } from "./search";
import type {
  EventDetail,
  EventListItem,
  EventStatus,
  MapPoint,
  SearchEventHit,
} from "@/types";

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

/**
 * The mark that names the type wherever a surface has to say what kind of thing
 * it is: the `Collection` pill on the page, the search scope chip, the profile
 * section's first-run state, and the shelving control on an event page.
 *
 * One export for all of them, so the glyph changes in one line. The profile
 * card wears none: its mosaic is what tells one collection from the next, and a
 * mark beside the title only narrows the column the title renders in.
 */
export const CollectionIcon = Layers;

/** The collection's page. */
export function collectionHref(id: string): string {
  return `/collections/${encodeURIComponent(id)}`;
}

/** The owner's edit page: the two details, and the one control that drops the
 *  collection. */
export function collectionEditHref(id: string): string {
  return `${collectionHref(id)}/edit`;
}

/** The query parameter the create page reads the event to shelve from. */
export const NEW_COLLECTION_EVENT_PARAM = "event";

/**
 * The create page.
 *
 * `eventId` asks it to put that event on the collection it opens and to return
 * to the event afterwards, which is how the add-to-collection panel opens a
 * collection without losing the event the analyst was shelving.
 */
export function newCollectionHref(eventId?: string): string {
  return eventId
    ? `/collections/new?${NEW_COLLECTION_EVENT_PARAM}=${encodeURIComponent(eventId)}`
    : "/collections/new";
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
 *  page holds the first 500 items. */
export const READER_MAX_ITEMS = 500;

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
): Promise<EventListItem[]> {
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
    if (items.length >= READER_MAX_ITEMS) return items.slice(0, READER_MAX_ITEMS);
    if (page.nextCursor === null) return items;
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

/**
 * The two statuses a collection may hold, as the picker asks the read surfaces
 * for them. Mirrors `services/event_filters.collectable_events`, the one
 * predicate the item list, the count, the date range, the mosaic and the add
 * verb all read: a picker offering a row the add verb then refuses hands the
 * analyst a 409 on something they were invited to tick.
 */
export const COLLECTABLE_STATUSES: EventStatus[] = ["geolocated", "detected"];

/** One row of the event picker, on either of its blocks: the slots a compact
 *  `<EntityCard>` fills. A catalogue row (`EventListItem`) already is one; a
 *  search hit becomes one through `pickableFromHit` and an event's own read
 *  through `pickableFromDetail`, so every source the picker reads renders as
 *  the same row. */
export type PickableEvent = Pick<
  EventListItem,
  | "id"
  | "title"
  | "status"
  | "media"
  | "is_graphic"
  | "event_date"
  | "event_coords"
  | "tags"
>;

/** How many rows the picker's add block ever shows, whichever source answers
 *  it. The block is a way to reach one event, not a second catalogue, so both
 *  halves ask their endpoint for this many and the block says how to reach
 *  what it left out. */
export const PICKER_ROW_LIMIT = 5;

/** The analyst's own collectable events, newest first: what the add block
 *  shows with nothing typed. The list endpoint serves this half because it is
 *  the cursor-paged one, so the block knows from the cursor whether more of
 *  the catalogue stands behind the rows it shows. */
export function pickerBrowsePath(
  username: string,
  cursor: string | null,
): string {
  return eventListPath({
    view: "located",
    status: COLLECTABLE_STATUSES,
    author: username,
    limit: PICKER_ROW_LIMIT,
    cursor,
  });
}

/** An event's own read as a picker row. The create page reads the one event a
 *  `?event=` link carries this way, so the row it opens holding renders like
 *  every other row on the page. The detail carries all of its media and the
 *  card slot takes one, which is the first, the order the gallery renders. */
export function pickableFromDetail(event: EventDetail): PickableEvent {
  return {
    id: event.id,
    title: event.title,
    status: event.status,
    media: event.media[0] ?? null,
    is_graphic: event.is_graphic,
    event_date: event.event_date,
    event_coords: event.event_coords,
    tags: event.tags,
  };
}

/** A search hit as a picker row: the hit carries its coordinates flat and its
 *  picked thumbnail as a list of at most one, which is the card's `media`. */
function pickableFromHit(hit: SearchEventHit): PickableEvent {
  return {
    id: hit.id,
    title: hit.title,
    status: hit.status,
    media: hit.media[0] ?? null,
    is_graphic: hit.is_graphic,
    event_date: hit.event_date,
    event_coords: { lat: hit.lat, lng: hit.lng },
    tags: hit.tags,
  };
}

/**
 * The analyst's own collectable events matching a typed query, and how many
 * matched in all.
 *
 * `/search` serves the typed half because it is the endpoint that reads the
 * words: `type=event` for the located group and `author=` for their own
 * catalogue, the pair every profile link into search already carries. `total`
 * is the pre-cap match count, so the block can say what its rows leave out.
 */
export async function searchPickableEvents(
  username: string,
  q: string,
): Promise<{ items: PickableEvent[]; total: number }> {
  const response = await search({
    q,
    type: "event",
    author: username,
    status: COLLECTABLE_STATUSES,
    limit: PICKER_ROW_LIMIT,
  });
  return {
    items: response.geolocations.map(pickableFromHit),
    total: response.total.geolocations,
  };
}

/**
 * Open a collection under a title and a description, both required, holding
 * the events the create page's picker ticked.
 *
 * `eventIds` rides the create rather than following it as a request per row:
 * the server puts them on inside the same transaction, so a refusal on any one
 * of them takes the whole create with it and the analyst is never left with a
 * collection holding part of what they picked.
 */
export function createCollection(
  title: string,
  description: string,
  eventIds: string[] = [],
): Promise<Collection> {
  return apiFetch<Collection>("/collections", {
    method: "POST",
    body: JSON.stringify({ title, description, event_ids: eventIds }),
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

/**
 * Report a collection: `POST /collections/{id}/report`. The event report's
 * twin (`reportEvent`), down to the body and the per-IP cap: open to anyone,
 * signed in or not, because the reader who notices a shelf misrepresenting
 * what it holds is rarely the one who holds an account here. `apiFetch` omits
 * the CSRF header when no session cookie is present, so the same call works
 * logged out.
 */
export function reportCollection(
  id: string,
  body: components["schemas"]["ContentReportCreate"],
): Promise<ContentReport> {
  return apiFetch<ContentReport>(
    `/collections/${encodeURIComponent(id)}/report`,
    { method: "POST", body: JSON.stringify(body) },
  );
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
