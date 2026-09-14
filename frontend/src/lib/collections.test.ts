import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  addEventToCollection,
  collectionEventsPath,
  collectionHref,
  collectionMetaSegments,
  collectionPoints,
  collectionStepHref,
  createCollection,
  deleteCollection,
  eventCollectionsPath,
  fetchCollectionSequence,
  PICKER_ROW_LIMIT,
  pickerBrowsePath,
  READER_MAX_ITEMS,
  readerStep,
  removeEventFromCollection,
  pickableFromDetail,
  searchPickableEvents,
  updateCollection,
  userCollectionsPath,
  type Collection,
} from "./collections";
import { apiFetch, apiFetchPage } from "./api";
import type { EventListItem } from "@/types";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiFetchPage: vi.fn() }));

const mockFetch = apiFetch as unknown as Mock;
const mockFetchPage = apiFetchPage as unknown as Mock;

/** The path and options of the last request. */
function lastCall(): [string, RequestInit] {
  return mockFetch.mock.calls.at(-1) as [string, RequestInit];
}

const COLLECTION: Collection = {
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: "Three days of strikes on the eastern approach.",
  cover: [],
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
  mockFetchPage.mockReset();
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

  it("asks the profile endpoint for one page at the grid's own size", () => {
    expect(userCollectionsPath("ana", 4, 1)).toBe(
      "/users/ana/collections?page=1&per_page=4",
    );
    expect(userCollectionsPath("ana", 4, 2)).toBe(
      "/users/ana/collections?page=2&per_page=4",
    );
  });
});

describe("collection writes", () => {
  it("opens a collection under a title and a description", async () => {
    await createCollection("Kupiansk rail corridor", "Three days of strikes.");

    const [path, options] = lastCall();
    expect(path).toBe("/collections");
    expect(options.method).toBe("POST");
    // The ids ride every create, empty for a collection opened on its two
    // fields alone.
    expect(JSON.parse(options.body as string)).toEqual({
      title: "Kupiansk rail corridor",
      description: "Three days of strikes.",
      event_ids: [],
    });
  });

  it("opens a collection holding what the picker ticked", async () => {
    await createCollection("March strikes", "Strikes through March.", [
      "e1",
      "e2",
    ]);

    // One request, so a refusal on any id takes the whole create with it and
    // no half-filled collection lands.
    const [path, options] = lastCall();
    expect(path).toBe("/collections");
    expect(JSON.parse(options.body as string)).toEqual({
      title: "March strikes",
      description: "Strikes through March.",
      event_ids: ["e1", "e2"],
    });
  });

  it("writes both details through one PATCH", async () => {
    await updateCollection(
      "c1",
      "Operation reconstruction",
      "Every strike of the operation.",
    );

    const [path, options] = lastCall();
    expect(path).toBe("/collections/c1");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body as string)).toEqual({
      title: "Operation reconstruction",
      description: "Every strike of the operation.",
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
});

describe("the step link", () => {
  it("is the collection's own page, carrying the step, 1-based", () => {
    expect(collectionStepHref("c1", 1)).toBe("/collections/c1?step=1");
    expect(collectionStepHref("c 1", 3)).toBe("/collections/c%201?step=3");
  });
});

describe("readerStep", () => {
  it("reads the step out of the query", () => {
    expect(readerStep("3", 12)).toBe(3);
  });

  it("opens on the first item when the link carries no step", () => {
    expect(readerStep(null, 12)).toBe(1);
  });

  it("clamps a step the collection does not hold", () => {
    expect(readerStep("99", 12)).toBe(12);
    expect(readerStep("0", 12)).toBe(1);
    expect(readerStep("-4", 12)).toBe(1);
  });

  it("answers 1 for a value that is not a whole number of steps", () => {
    // A hand-edited or truncated link reads as its first step rather than as
    // no step at all.
    expect(readerStep("two", 12)).toBe(1);
    expect(readerStep("2.5", 12)).toBe(1);
    expect(readerStep("", 12)).toBe(1);
  });

  it("answers 1 with nothing to step through", () => {
    expect(readerStep("3", 0)).toBe(1);
  });
});

describe("fetchCollectionSequence", () => {
  /** One page of items, the shape `apiFetchPage` hands back. */
  const page = (items: EventListItem[], nextCursor: string | null) => ({
    items,
    nextCursor,
  });

  it("walks the cursor to the end and keeps the order it read", async () => {
    mockFetchPage
      .mockResolvedValueOnce(page([item({ id: "e1" })], "c2"))
      .mockResolvedValueOnce(page([item({ id: "e2" })], null));

    const sequence = await fetchCollectionSequence("c1");

    expect(sequence.items.map((i) => i.id)).toEqual(["e1", "e2"]);
    expect(sequence.capped).toBe(false);
    expect(mockFetchPage.mock.calls.map((call) => call[0])).toEqual([
      "/collections/c1/events",
      "/collections/c1/events?cursor=c2",
    ]);
  });

  it("stops at the ceiling and says the collection holds more", async () => {
    const many = Array.from({ length: READER_MAX_ITEMS }, (_, i) =>
      item({ id: `e${i}` }),
    );
    mockFetchPage
      .mockResolvedValueOnce(page(many, "c2"))
      .mockResolvedValueOnce(page([item({ id: "over" })], null));

    const sequence = await fetchCollectionSequence("c1");

    expect(sequence.items).toHaveLength(READER_MAX_ITEMS);
    expect(sequence.capped).toBe(true);
    // The walk stopped rather than reading the page behind the ceiling.
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
  });

  it("reads a collection that ends exactly on the ceiling as whole", async () => {
    const many = Array.from({ length: READER_MAX_ITEMS }, (_, i) =>
      item({ id: `e${i}` }),
    );
    mockFetchPage.mockResolvedValueOnce(page(many, null));

    expect((await fetchCollectionSequence("c1")).capped).toBe(false);
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

describe("the event picker's two sources", () => {
  it("browses the analyst's own collectable events, newest first", () => {
    // The cursor-paged list endpoint, scoped to the owner, to the two statuses
    // a collection may hold, so no row the add verb would refuse is offered,
    // and to the rows the block shows.
    expect(pickerBrowsePath("ana", null)).toBe(
      "/events?view=located&status=geolocated&status=detected&author=ana&limit=5",
    );
    expect(pickerBrowsePath("ana", "c2")).toBe(
      "/events?view=located&status=geolocated&status=detected&author=ana&limit=5&cursor=c2",
    );
  });

  it("sends a typed query to search, scoped the same way", async () => {
    mockFetch.mockResolvedValue({
      geolocations: [],
      requests: [],
      collections: [],
      users: [],
      total: { geolocations: 0, requests: 0, collections: 0, users: 0 },
      query: "kakhovka",
      type: "event",
    });

    await searchPickableEvents("ana", "kakhovka");

    const [path] = lastCall();
    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.get("q")).toBe("kakhovka");
    expect(query.get("type")).toBe("event");
    expect(query.get("author")).toBe("ana");
    expect(query.getAll("status")).toEqual(["geolocated", "detected"]);
    expect(query.get("limit")).toBe(String(PICKER_ROW_LIMIT));
  });

  it("turns a hit into the row the browse list renders", async () => {
    mockFetch.mockResolvedValue({
      geolocations: [
        {
          id: "e1",
          title: "Kakhovka dam",
          title_highlight: "Kakhovka dam",
          lat: 46.77,
          lng: 33.37,
          event_date: "2026-03-14",
          is_graphic: false,
          status: "detected",
          owner: { id: "u1", username: "ana", avatar_url: null },
          media: [],
          tags: [],
        },
      ],
      requests: [],
      collections: [],
      users: [],
      total: { geolocations: 62, requests: 0, collections: 0, users: 0 },
      query: "kakhovka",
      type: "event",
    });

    const found = await searchPickableEvents("ana", "kakhovka");

    // The hit carries its coordinates flat and its thumbnail as a list of at
    // most one; a picker row carries the card's own pair.
    expect(found.items).toEqual([
      {
        id: "e1",
        title: "Kakhovka dam",
        status: "detected",
        media: null,
        is_graphic: false,
        event_date: "2026-03-14",
        event_coords: { lat: 46.77, lng: 33.37 },
        tags: [],
      },
    ]);
    // The pre-cap count, so the picker can say what its list leaves out.
    expect(found.total).toBe(62);
  });
});

describe("pickableFromDetail", () => {
  it("turns an event's own read into the row both blocks render", () => {
    const detail = {
      id: "e1",
      title: "Kakhovka dam",
      status: "geolocated",
      media: [
        { id: "m1", storage_url: "https://media/one.jpg", media_type: "image" },
        { id: "m2", storage_url: "https://media/two.jpg", media_type: "image" },
      ],
      is_graphic: true,
      event_date: "2026-03-14",
      event_coords: { lat: 46.77, lng: 33.37 },
      tags: [{ id: "t1", name: "dam" }],
    } as unknown as Parameters<typeof pickableFromDetail>[0];

    // The detail carries all of its media and the card slot takes one, which
    // is the first, the order the gallery renders.
    expect(pickableFromDetail(detail)).toEqual({
      id: "e1",
      title: "Kakhovka dam",
      status: "geolocated",
      media: {
        id: "m1",
        storage_url: "https://media/one.jpg",
        media_type: "image",
      },
      is_graphic: true,
      event_date: "2026-03-14",
      event_coords: { lat: 46.77, lng: 33.37 },
      tags: [{ id: "t1", name: "dam" }],
    });
  });

  it("carries no media for an event that has none", () => {
    const detail = {
      id: "e2",
      title: "Sourceless detection",
      status: "detected",
      media: [],
      is_graphic: false,
      event_date: null,
      event_coords: null,
      tags: [],
    } as unknown as Parameters<typeof pickableFromDetail>[0];

    expect(pickableFromDetail(detail).media).toBeNull();
  });
});
