import { ACTION_ICONS } from "@/components/ui/Button";

import { apiFetch, apiFetchPage } from "./api";
import type { components } from "./api-types";
import { EVENT_TITLE_MAX_LEN, eventListPath, type ContentReport } from "./events";
import { countLabel, formatDate } from "./format";
import { eventFilterFields, hitsOf, search, type EventFilterParams } from "./search";
import type {
  EventDetail,
  EventListItem,
  EventStatus,
  MapPoint,
  SearchEventHit,
} from "@/types";
import { withCursor } from "./pagination";

/** The collections surface: routes, the hand-kept caps, and the meta line and item pins
 *  every collection surface prints. */

/** The event title cap, which `schemas/collection` applies to create and update alike. */
export const COLLECTION_TITLE_MAX_LEN = EVENT_TITLE_MAX_LEN;

/** Counted on the plain-text projection of the description HTML (`lib/proof.tsx::htmlText`),
 *  so bolding a word costs no characters. Mirrors `schemas/collection.DESCRIPTION_MAX_LENGTH`,
 *  which `services/collections` applies to the same projection; change both. */
export const COLLECTION_DESCRIPTION_MAX_LEN = 500;

export type Collection = components["schemas"]["CollectionRead"];

/** Sanitized HTML like an event's proof body, minus images. A read carries it beside
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
export const CollectionIcon = ACTION_ICONS.collect;

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
  return withCursor(`/collections/${encodeURIComponent(id)}/events`, cursor);
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

/** One row of the event picker: the slots a compact `<Item>` fills. */
export type PickableEvent = Pick<
  EventListItem,
  | "id"
  | "title"
  | "status"
  | "media"
  | "is_graphic"
  | "occurred_date"
  | "coords"
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
    show: COLLECTABLE_STATUSES,
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
    occurred_date: event.occurred_date,
    coords: event.coords,
    tags: event.tags,
  };
}

/** A search hit as a picker row (the hit's thumbnail list of at most one is the `media`). */
export function pickableFromHit(hit: SearchEventHit): PickableEvent {
  return {
    id: hit.id,
    title: hit.title,
    status: hit.status,
    media: hit.media[0] ?? null,
    is_graphic: hit.is_graphic,
    occurred_date: hit.occurred_date,
    coords: hit.lat !== null && hit.lng !== null ? { lat: hit.lat, lng: hit.lng } : null,
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
    types: ["event"],
    author: username,
    show: COLLECTABLE_STATUSES,
    limit: PICKER_ROW_LIMIT,
  });
  return {
    items: hitsOf(response.hits, "event").map(pickableFromHit),
    total: response.total,
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

export type BulkAddResult = components["schemas"]["CollectionBulkAddResult"];

/** Events one bulk add (or one create) may shelve; past it the server answers 422
 *  `too_many_events`. Mirrors `schemas/collection.MAX_CREATE_EVENTS`; change both. */
export const BULK_ADD_MAX_EVENTS = 500;

/** One search as the server resolves it: the query and the search page's filters. */
export type SearchMatchParams = { q: string } & EventFilterParams;

/** What a bulk add shelves: explicit event ids, or every collectable event a search matches
 *  less `excludeEventIds`. */
export type BulkTarget =
  | { eventIds: string[] }
  | { match: SearchMatchParams; excludeEventIds?: string[] };

/** A selection handed from the search page to `/collections/new`: what to add, how many
 *  geolocations that is, the page to return to on Cancel, and, for checked rows, the rows
 *  themselves (loaded search hits as picker rows), so the create page reads no event. A match
 *  carries none. About a kilobyte a row, so the 500-event cap keeps an entry well under the few
 *  megabytes `sessionStorage` holds. */
export interface SelectionHandoff {
  target: BulkTarget;
  count: number;
  from: string;
  rows: PickableEvent[];
}

export const NEW_COLLECTION_SELECTION_PARAM = "selection";

const HANDOFF_PREFIX = "vidit:collection-selection:";

/** A handoff older than this reads as missing: the create page opens an empty form. */
const HANDOFF_TTL_MS = 30 * 60 * 1000;

/** Park a selection in `sessionStorage` under a fresh token and return the create page's URL
 *  carrying the token, so no id list rides the URL. Storage that throws (a private window,
 *  blocked site data) yields the plain create page. */
export function newCollectionFromSelectionHref(handoff: SelectionHandoff): string {
  const token = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(
      HANDOFF_PREFIX + token,
      JSON.stringify({ ...handoff, at: Date.now() }),
    );
  } catch {
    return newCollectionHref();
  }
  return `/collections/new?${NEW_COLLECTION_SELECTION_PARAM}=${encodeURIComponent(token)}`;
}

/** The handoff a token names, or `null` when it is missing, malformed or past its TTL. */
export function readSelectionHandoff(token: string): SelectionHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_PREFIX + token);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectionHandoff & { at?: number };
    const target = parsed.target as Partial<{ eventIds: unknown; match: unknown }> | undefined;
    const shaped =
      !!target &&
      (Array.isArray(target.eventIds) || (typeof target.match === "object" && target.match !== null));
    if (!shaped || typeof parsed.count !== "number" || typeof parsed.at !== "number") return null;
    if (!Array.isArray(parsed.rows)) return null;
    const rows = parsed.rows.filter(
      (row): row is PickableEvent =>
        typeof row === "object" && row !== null && typeof row.id === "string" && typeof row.title === "string",
    );
    if (Date.now() - parsed.at > HANDOFF_TTL_MS) return null;
    // An in-app path only, so a planted entry cannot send Cancel off the site.
    const from =
      typeof parsed.from === "string" && /^\/(?!\/)/.test(parsed.from) ? parsed.from : "/search";
    return { target: parsed.target, count: parsed.count, from, rows };
  } catch {
    return null;
  }
}

/** Drop a handoff once its collection exists, so Back to the create page cannot add it twice. */
export function clearSelectionHandoff(token: string): void {
  try {
    window.sessionStorage.removeItem(HANDOFF_PREFIX + token);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

function searchMatchBody({ q, ...filters }: SearchMatchParams) {
  return { q, filters: eventFilterFields(filters) };
}

/** Rows a page of a match's events holds on the create page, one **Show more** at a time. */
const MATCH_PAGE_SIZE = 20;

/** One page of the caller's collectable events a match names, newest first:
 *  `POST /collections/collectable-events`, the set the bulk add shelves. Pair with
 *  `collectableEventsBody` as `useCursorList`'s body. */
export function collectableEventsPath(cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(MATCH_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return `/collections/collectable-events?${params}`;
}

export function collectableEventsBody(match: SearchMatchParams): string {
  return JSON.stringify(searchMatchBody(match));
}

/** `POST /collections/{id}/events`: many events in one write, by id or by the search that
 *  lists them. Idempotent; at most 500 events, else a 422 `too_many_events`. */
export function addEventsToCollection(
  collectionId: string,
  target: BulkTarget,
): Promise<BulkAddResult> {
  const body =
    "eventIds" in target
      ? { event_ids: target.eventIds }
      : {
          match: searchMatchBody(target.match),
          exclude_event_ids: target.excludeEventIds ?? [],
        };
  return apiFetch<BulkAddResult>(
    `/collections/${encodeURIComponent(collectionId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** How many of the caller's events `match` lists in the Geolocations group that a collection
 *  can hold: the set `addEventsToCollection` shelves for the same match. */
export async function countCollectableMatches(
  match: SearchMatchParams,
  signal?: AbortSignal,
): Promise<number> {
  const res = await apiFetch<components["schemas"]["CollectableCount"]>(
    "/collections/collectable-count",
    { method: "POST", body: JSON.stringify(searchMatchBody(match)), signal },
  );
  return res.total;
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
  return countLabel(count, "event");
}

/** The meta line the profile card and the share texts print: the count (zero included), then
 *  the span of item dates when they carry any. */
export function collectionMetaSegments(collection: Collection): string[] {
  const span = collectionSpanLabel(collection.first_date, collection.last_date);
  return [eventCountLabel(collection.event_count), ...(span ? [span] : [])];
}

/** The span the item dates cover, null without a date; one day prints once, not as a range. */
export function collectionSpanLabel(first: string | null, last: string | null): string | null {
  if (!first || !last) return null;
  return first === last ? formatDate(first) : `${formatDate(first)} to ${formatDate(last)}`;
}

/** The items as map points for `<Map>`. Read off the already loaded rows (there is no
 *  points endpoint per collection, and a second read could frame a different set). No
 *  coordinates, no pin. The two date slots are the map page's scrubber payload, unused by
 *  an embedded map. */
export function collectionPoints(
  items: Pick<EventListItem, "id" | "coords" | "occurred_date" | "status">[],
): MapPoint[] {
  return items.flatMap((item) =>
    item.coords
      ? [
          [
            item.id,
            item.coords.lat,
            item.coords.lng,
            item.occurred_date,
            item.occurred_date ?? "",
            item.status === "detected" ? 1 : 0,
          ] as MapPoint,
        ]
      : [],
  );
}
