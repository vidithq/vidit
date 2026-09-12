import { apiFetch } from "./api";
import type { components } from "./api-types";
import { formatDate } from "./format";
import type { EventListItem, MapPoint } from "@/types";

/**
 * The collections surface: the routes, the one hand-kept cap, and the two
 * readings every collection surface prints (the meta line and the item pins).
 *
 * A collection is one analyst's own curated set of `geolocated` and `detected`
 * events, shown on their public profile. The title is the only free-text field
 * and the items order themselves by when their events happened, so there is
 * nothing else here to write.
 */

/** How long a collection title may be. Mirrors `models/event.TITLE_MAX_LENGTH`,
 *  which `schemas/collection` applies to the create and the rename alike: the
 *  field stops at the cap instead of letting the server 422 a title someone
 *  just typed out. */
export const COLLECTION_TITLE_MAX_LEN = 255;

/** One collection's header, as every read surface renders it. */
export type Collection = components["schemas"]["CollectionRead"];

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

/** An analyst's collections, newest first. `per_page` is the grid's own page
 *  size rather than the endpoint's default. */
export function userCollectionsPath(username: string, perPage: number): string {
  return `/users/${encodeURIComponent(username)}/collections?per_page=${perPage}`;
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

export function createCollection(title: string): Promise<Collection> {
  return apiFetch<Collection>("/collections", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function renameCollection(
  id: string,
  title: string,
): Promise<Collection> {
  return apiFetch<Collection>(`/collections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
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
 * Upload the collection's cover. The same pipeline the profile picture takes:
 * `FormData` rather than JSON, so `apiFetch` leaves the boundary header to the
 * browser and still attaches the CSRF token, and the backend strips the
 * image's metadata, resizes it and stores one JPEG on our own media host.
 */
export function uploadCollectionCover(
  id: string,
  file: File,
): Promise<Collection> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<Collection>(
    `/collections/${encodeURIComponent(id)}/cover`,
    { method: "PUT", body },
  );
}

/** Drop the uploaded cover; `cover_url` falls back to the first item's media. */
export function deleteCollectionCover(id: string): Promise<Collection> {
  return apiFetch<Collection>(`/collections/${encodeURIComponent(id)}/cover`, {
    method: "DELETE",
  });
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
  const segments = [`${count} event${count === 1 ? "" : "s"}`];
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
