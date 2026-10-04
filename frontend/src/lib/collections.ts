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

/** The collections surface: routes, the hand-kept caps, and the meta line and item pins
 *  every collection surface prints. */

/** Mirrors `models/event.TITLE_MAX_LENGTH`, which `schemas/collection` applies to create
 *  and update alike; change both. */
export const COLLECTION_TITLE_MAX_LEN = 255;

/** Counted on the plain-text projection of the document (`lib/proof.tsx::tiptapDocText`),
 *  so bolding a word costs no characters. Mirrors `schemas/collection.DESCRIPTION_MAX_LENGTH`,
 *  which `services/collections` applies to the same projection; change both. */
export const COLLECTION_DESCRIPTION_MAX_LEN = 500;

export type Collection = components["schemas"]["CollectionRead"];

/** A Tiptap document like an event's proof body, minus images. A read carries it beside
 *  `description_text`, its plain-text projection. */
export type CollectionDescription = Collection["description"];

/** One mosaic tile: an item's media url, its file kind (picks the rendering element) and
 *  its role (a proof image has no display derivatives, see `lib/mediaUrls.ts`). */
export type CollectionCoverTile =
  components["schemas"]["CollectionCoverTile"];

export type CollectionPage = components["schemas"]["CollectionList"];

export type CollectionMembership =
  components["schemas"]["CollectionMembershipRead"];

export type CollectionMemberships =
  components["schemas"]["CollectionMembershipList"];

/** The mark that names a collection wherever a surface says what kind of thing it is.
 *  The profile card wears none: its mosaic tells collections apart. */
export const CollectionIcon = Layers;

export function collectionHref(id: string): string {
  return `/collections/${encodeURIComponent(id)}`;
}

export function collectionEditHref(id: string): string {
  return `${collectionHref(id)}/edit`;
}

export const NEW_COLLECTION_EVENT_PARAM = "event";

/** The create page. `eventId` puts that event on the new collection and returns to the
 *  event afterwards. */
export function newCollectionHref(eventId?: string): string {
  return eventId
    ? `/collections/new?${NEW_COLLECTION_EVENT_PARAM}=${encodeURIComponent(eventId)}`
    : "/collections/new";
}

/** An analyst's collections, newest first. `perPage` is the profile grid's own size. */
export function userCollectionsPath(username: string, perPage: number): string {
  return `/users/${encodeURIComponent(username)}/collections?per_page=${perPage}`;
}

export function eventCollectionsPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/collections`;
}

/** One page of a collection's items, oldest event first; `cursor` is null for the first. */
export function collectionEventsPath(
  id: string,
  cursor: string | null,
): string {
  const base = `/collections/${encodeURIComponent(id)}/events`;
  return cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
}

/** The collection's page opened on a 1-based `?step=`. */
export function collectionStepHref(id: string, step: number): string {
  return `${collectionHref(id)}?step=${step}`;
}

/** Ceiling on a runaway read, not a page size. Past it the page holds the earliest 500
 *  items by event date, and nothing on the page marks the cut. */
export const READER_MAX_ITEMS = 500;

/** Every page of a collection's items in one read, following the `Link: rel="next"`
 *  cursor: the page needs the whole sequence for `N of M`, and one read keeps the pins,
 *  the panel and the list describing the same collection. Bounded by `READER_MAX_ITEMS`. */
export async function fetchCollectionSequence(
  id: string,
  signal?: AbortSignal,
): Promise<EventListItem[]> {
  const items: EventListItem[] = [];
  let cursor: string | null = null;
  for (;;) {
    // Annotated: TypeScript cannot resolve `cursor` from the call alone.
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

/** Step a reader link opens on, read off `?step=`: 1-based, clamped into the sequence;
 *  anything but a positive whole number is step 1. */
export function readerStep(raw: string | null, total: number): number {
  if (total <= 0) return 1;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.min(Math.max(Number.parseInt(raw, 10), 1), total);
}

/** Statuses a collection may hold. Mirrors `services/event_filters.collectable_events`, the
 *  one predicate the list, count, date range, mosaic and add verb read; a status it drops
 *  would invite a tick the add verb refuses with a 409. */
export const COLLECTABLE_STATUSES: EventStatus[] = ["geolocated", "detected"];

/** One row of the event picker: the slots a compact `<EntityCard>` fills. */
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

/** Rows the picker's add block ever shows, whichever source answers: a way to reach one
 *  event, not a second catalogue. */
export const PICKER_ROW_LIMIT = 5;

/** The analyst's collectable events, newest first. The cursor-paged list endpoint serves
 *  this half so the block knows from the cursor whether more stand behind its rows. */
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

/** An event's own read as a picker row. Uses the detail's `thumbnail` (source attachment,
 *  else first proof image) since `media` carries source attachments alone. */
export function pickableFromDetail(event: EventDetail): PickableEvent {
  return {
    id: event.id,
    title: event.title,
    status: event.status,
    media: event.thumbnail,
    is_graphic: event.is_graphic,
    event_date: event.event_date,
    event_coords: event.event_coords,
    tags: event.tags,
  };
}

/** A search hit as a picker row (the hit's thumbnail list of at most one is the `media`). */
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

/** The analyst's collectable events matching a query, via `/search` (the endpoint that
 *  reads words). `total` is the pre-cap match count. */
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

/** Open a collection with a required title and description. `eventIds` rides the create so
 *  one refusal rolls back the whole transaction, never a partly filled collection. */
export function createCollection(
  title: string,
  description: CollectionDescription,
  eventIds: string[] = [],
): Promise<Collection> {
  return apiFetch<Collection>("/collections", {
    method: "POST",
    body: JSON.stringify({ title, description, event_ids: eventIds }),
  });
}

/** Both fields ride every edit, so a renamed collection cannot keep describing the old one. */
export function updateCollection(
  id: string,
  title: string,
  description: CollectionDescription,
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

/** `POST /collections/{id}/report`. Twin of `reportEvent`: open to anyone, per-IP capped,
 *  and `apiFetch` omits the CSRF header with no session cookie. */
export function reportCollection(
  id: string,
  body: components["schemas"]["ContentReportCreate"],
): Promise<ContentReport> {
  return apiFetch<ContentReport>(
    `/collections/${encodeURIComponent(id)}/report`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** Idempotent server-side, so the panel can re-send an uncertain row. */
export function addEventToCollection(
  collectionId: string,
  eventId: string,
): Promise<void> {
  return apiFetch<void>(
    `/collections/${encodeURIComponent(collectionId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PUT" },
  );
}

/** Idempotent; never re-checks the event's state, so a membership whose event has since
 *  closed still clears. */
export function removeEventFromCollection(
  collectionId: string,
  eventId: string,
): Promise<void> {
  return apiFetch<void>(
    `/collections/${encodeURIComponent(collectionId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

/** One phrasing for the page meta line, the profile card and the panel row. */
export function eventCountLabel(count: number): string {
  return `${count} event${count === 1 ? "" : "s"}`;
}

/** The meta line the page and profile card print: the count (zero included), then the span
 *  of item dates when they carry any (one day prints once, not as a range). */
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

/** The items as map points for `<Map>`. Read off the already loaded rows (there is no
 *  points endpoint per collection, and a second read could frame a different set). No
 *  coordinates, no pin. The two date slots are the map page's scrubber payload, unused by
 *  an embedded map. */
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
