import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  addEventToCollection,
  collectionEventsPath,
  collectionHref,
  collectionMetaSegments,
  collectionPoints,
  createCollection,
  deleteCollection,
  deleteCollectionCover,
  eventCollectionsPath,
  removeEventFromCollection,
  renameCollection,
  uploadCollectionCover,
  userCollectionsPath,
  type Collection,
} from "./collections";
import { apiFetch } from "./api";
import type { EventListItem } from "@/types";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const mockFetch = apiFetch as unknown as Mock;

/** The path and options of the last request. */
function lastCall(): [string, RequestInit] {
  return mockFetch.mock.calls.at(-1) as [string, RequestInit];
}

const COLLECTION: Collection = {
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  cover_url: null,
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
};

const item = (
  over: Partial<EventListItem> & Pick<EventListItem, "id">,
): EventListItem => ({
  title: "Strike on the rail junction",
  status: "geolocated",
  event_date: "2026-03-14",
  event_coords: { lat: 49.71, lng: 37.616 },
  before_closed_status: null,
  conflicts: [],
  is_graphic: false,
  media: null,
  owner: { id: "u1", username: "ana", avatar_url: null },
  tags: [],
  ...over,
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(COLLECTION);
});

describe("collection paths", () => {
  it("escapes the id it puts in a path", () => {
    expect(collectionHref("c 1")).toBe("/collections/c%201");
    expect(collectionEventsPath("c 1", null)).toBe("/collections/c%201/events");
    expect(eventCollectionsPath("e/1")).toBe("/events/e%2F1/collections");
  });

  it("carries the cursor only past the first page", () => {
    expect(collectionEventsPath("c1", null)).toBe("/collections/c1/events");
    expect(collectionEventsPath("c1", "a b")).toBe(
      "/collections/c1/events?cursor=a%20b",
    );
  });

  it("asks the profile endpoint for the grid's own page size", () => {
    expect(userCollectionsPath("ana", 6)).toBe(
      "/users/ana/collections?per_page=6",
    );
  });
});

describe("collection writes", () => {
  it("opens a collection with the title alone", async () => {
    await createCollection("Kupiansk rail corridor");

    const [path, options] = lastCall();
    expect(path).toBe("/collections");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      title: "Kupiansk rail corridor",
    });
  });

  it("retitles through PATCH", async () => {
    await renameCollection("c1", "Operation reconstruction");

    const [path, options] = lastCall();
    expect(path).toBe("/collections/c1");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body as string)).toEqual({
      title: "Operation reconstruction",
    });
  });

  it("drops a collection through DELETE", async () => {
    await deleteCollection("c1");

    expect(lastCall()).toEqual(["/collections/c1", { method: "DELETE" }]);
  });

  it("puts an event on and takes it off the same address", async () => {
    await addEventToCollection("c1", "e1");
    expect(lastCall()).toEqual([
      "/collections/c1/events/e1",
      { method: "PUT" },
    ]);

    await removeEventFromCollection("c1", "e1");
    expect(lastCall()).toEqual([
      "/collections/c1/events/e1",
      { method: "DELETE" },
    ]);
  });

  it("uploads a cover as multipart, the avatar's own shape", async () => {
    const file = new File(["x"], "cover.png", { type: "image/png" });

    await uploadCollectionCover("c1", file);

    const [path, options] = lastCall();
    expect(path).toBe("/collections/c1/cover");
    expect(options.method).toBe("PUT");
    // FormData, not JSON: `apiFetch` leaves the boundary header to the browser.
    const body = options.body as FormData;
    expect(body.get("file")).toBe(file);
  });

  it("clears the cover through DELETE", async () => {
    await deleteCollectionCover("c1");

    expect(lastCall()).toEqual([
      "/collections/c1/cover",
      { method: "DELETE" },
    ]);
  });
});

describe("collectionMetaSegments", () => {
  it("counts the items and names the span they cover", () => {
    expect(collectionMetaSegments(COLLECTION)).toEqual([
      "5 events",
      "14 Mar 2026 to 16 Mar 2026",
    ]);
  });

  it("says one event in the singular", () => {
    expect(
      collectionMetaSegments({ ...COLLECTION, event_count: 1 }),
    ).toContain("1 event");
  });

  it("prints one day once rather than as a range from itself", () => {
    expect(
      collectionMetaSegments({
        ...COLLECTION,
        first_date: "2026-03-14",
        last_date: "2026-03-14",
      }),
    ).toEqual(["5 events", "14 Mar 2026"]);
  });

  it("states the count alone when the items carry no dates", () => {
    expect(
      collectionMetaSegments({
        ...COLLECTION,
        event_count: 0,
        first_date: null,
        last_date: null,
      }),
    ).toEqual(["0 events"]);
  });
});

describe("collectionPoints", () => {
  it("reads the pins off the rows the list already holds", () => {
    const points = collectionPoints([
      item({ id: "e1" }),
      item({ id: "e2", status: "detected" }),
    ]);

    // [id, lat, lng, event_date, added_date, detected]
    expect(points).toEqual([
      ["e1", 49.71, 37.616, "2026-03-14", "2026-03-14", 0],
      ["e2", 49.71, 37.616, "2026-03-14", "2026-03-14", 1],
    ]);
  });

  it("drops an item that carries no coordinates", () => {
    expect(collectionPoints([item({ id: "e1", event_coords: null })])).toEqual(
      [],
    );
  });
});
