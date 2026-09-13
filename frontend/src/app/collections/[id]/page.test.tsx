import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const replace = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "c1" }),
  usePathname: () => "/collections/c1",
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
}));

// MapLibre touches `window` at module scope, so the player's map never loads
// its real canvas under jsdom. The stub reports the pins it was handed and
// which of them is lit, which is what the step moves.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({
      points,
      selectedId,
    }: {
      points: unknown[];
      selectedId?: string | null;
    }) {
      return (
        <div
          data-testid="map"
          data-points={points.length}
          data-selected={selectedId ?? ""}
        />
      );
    },
}));

// The panel is the map page's own, covered there. Stubbed, so what the player
// is measured on is the step header it pins to the panel's top edge and the
// event it hands the panel to render.
vi.mock("@/components/map/DetailSidePanel", () => ({
  DetailSidePanel: ({
    header,
    detail,
  }: {
    header?: ReactNode;
    detail: { title: string } | null;
  }) => (
    <div data-testid="panel">
      {header}
      <p>{detail?.title ?? "Loading..."}</p>
    </div>
  ),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const removeEventFromCollection = vi.fn();
// The page walks the cursor once and hands that one sequence to the player,
// the panel and the list, so a spec picks the set it measures here.
const fetchCollectionSequence = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  removeEventFromCollection: (c: string, e: string) =>
    removeEventFromCollection(c, e),
  fetchCollectionSequence: (id: string, signal?: AbortSignal) =>
    fetchCollectionSequence(id, signal),
}));

import type { Collection } from "@/lib/collections";
import type { EventListItem } from "@/types";

import CollectionPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: OWNER,
  title: "Kupiansk rail corridor",
  description: "Three days of strikes on the eastern approach.",
  cover: [],
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
  ...over,
});

const ITEMS: EventListItem[] = [
  {
    id: "e1",
    title: "Strike on the rail junction",
    status: "geolocated",
    event_date: "2026-03-14",
    event_coords: { lat: 49.71, lng: 37.616 },
    before_closed_status: null,
    conflicts: [],
    is_graphic: false,
    media: null,
    owner: OWNER,
    tags: [],
  },
  {
    id: "e2",
    title: "Damaged locomotive shed",
    status: "detected",
    event_date: "2026-03-15",
    event_coords: { lat: 49.613, lng: 37.492 },
    before_closed_status: null,
    conflicts: [],
    is_graphic: false,
    media: null,
    owner: OWNER,
    tags: [],
  },
];

/** The paths the page reads, answered by which one is asked for: the
 *  collection itself for the header, and the current step's event for the
 *  panel. */
function mockReads(data: Collection) {
  useApiResource.mockImplementation((path: string | null) =>
    path?.startsWith("/events/")
      ? {
          data: { id: path.slice("/events/".length), title: `event ${path}` },
          error: null,
          loading: false,
          refetch: vi.fn(),
        }
      : { data, error: null, loading: false, refetch: vi.fn() },
  );
}

/** Render, then wait for the sequence walk to land: the player and the list
 *  are both drawn from it, so a measurement before it reads an empty page. */
async function renderPage() {
  render(<CollectionPage />);
  await screen.findByRole("heading", { name: "Kupiansk rail corridor" });
  await waitFor(() => expect(fetchCollectionSequence).toHaveBeenCalled());
}

beforeEach(() => {
  useAuth.mockReset();
  useApiResource.mockReset();
  removeEventFromCollection.mockReset();
  fetchCollectionSequence.mockReset();
  replace.mockReset();
  searchParams.delete("step");
  useAuth.mockReturnValue({ user: null });
  mockReads(collection());
  fetchCollectionSequence.mockResolvedValue({ items: ITEMS, capped: false });
});

describe("CollectionPage", () => {
  it("titles itself with the collection and names its owner", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute(
      "href",
      "/profile/ana",
    );
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });

  it("prints the description whole, in its own Description card", async () => {
    mockReads(
      collection({
        description: "Three days of strikes.\nThe eastern approach.",
      }),
    );

    await renderPage();

    expect(screen.getByText("Description")).toBeInTheDocument();
    // One node, so the paragraph breaks the owner typed are kept rather than
    // collapsed into a run of text.
    const description = screen.getByText(
      "Three days of strikes. The eastern approach.",
    );
    expect(description).toHaveClass("whitespace-pre-line");
  });

  it("counts the items and names the span they cover", async () => {
    await renderPage();

    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(screen.getByText("14 Mar 2026 to 16 Mar 2026")).toBeInTheDocument();
  });

  it("says one event in the singular", async () => {
    mockReads(collection({ event_count: 1, last_date: "2026-03-14" }));
    fetchCollectionSequence.mockResolvedValue({
      items: [ITEMS[0]],
      capped: false,
    });

    await renderPage();

    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(await screen.findByText("1 event on the map")).toBeInTheDocument();
  });

  it("keeps the mosaic off the header: it is the profile card's picture", async () => {
    mockReads(
      collection({
        cover: [{ url: "https://media.example/item.jpg", media_type: "image" }],
      }),
    );

    await renderPage();

    expect(document.querySelector("header img")).toBeNull();
    expect(document.querySelector("header video")).toBeNull();
  });

  it("maps the items' pins and lists them in order, each with its status", async () => {
    await renderPage();

    expect(await screen.findByTestId("map")).toHaveAttribute("data-points", "2");
    expect(screen.getByText("2 events on the map")).toBeInTheDocument();
    const rows = screen.getAllByRole("heading", { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual([
      "Strike on the rail junction",
      "Damaged locomotive shed",
    ]);
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    expect(screen.getByText("Detected")).toBeInTheDocument();
  });

  it("opens on the first item and lights it on the map and in the list", async () => {
    await renderPage();

    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "e1");
    expect(useApiResource).toHaveBeenCalledWith("/events/e1");
    expect(
      screen.getByRole("button", {
        name: "Read this collection from Strike on the rail junction",
      }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("opens on the step a shared link carries", async () => {
    searchParams.set("step", "2");

    await renderPage();

    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "e2");
  });

  it("clamps a step the collection does not hold", async () => {
    searchParams.set("step", "99");

    await renderPage();

    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
  });

  it("moves to the row a reader picks, and says so in the URL", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Read this collection from Damaged locomotive shed",
      }),
    );

    // `replace`, so the back button leaves the page rather than walking back
    // through every step taken on it.
    expect(replace).toHaveBeenCalledWith("/collections/c1?step=2", {
      scroll: false,
    });
  });

  it("keeps the way to the event's own page on the row", async () => {
    await renderPage();

    expect(
      screen.getByRole("link", { name: "Strike on the rail junction" }),
    ).toHaveAttribute("href", "/events/e1");
  });

  it("offers no player for a collection with nothing on it", async () => {
    mockReads(collection({ event_count: 0, first_date: null, last_date: null }));
    fetchCollectionSequence.mockResolvedValue({ items: [], capped: false });

    await renderPage();

    await waitFor(() =>
      expect(screen.getByText("Nothing on this collection yet.")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
  });

  it("repeats no byline on a row: the header already names the analyst", async () => {
    await renderPage();

    expect(screen.queryByText(/^by/)).not.toBeInTheDocument();
  });

  it("hands a visitor no owner control", async () => {
    await renderPage();

    for (const name of [
      "Edit this collection's details",
      "Remove Strike on the rail junction from this collection",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("gives the owner the details, the drop and a control per item", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    await renderPage();

    expect(
      screen.getByRole("button", { name: "Edit this collection's details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Drop this collection (the events it holds stay)",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    ).toBeInTheDocument();
  });

  it("hands the owner no picture control: the card reads the items", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    await renderPage();

    // Nothing is uploaded for a collection, so the header cluster carries the
    // title and the drop alone and the page offers no file input anywhere.
    expect(
      screen.queryByRole("button", { name: /picture|cover/i }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("asks twice before dropping the collection", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Drop this collection (the events it holds stay)",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Confirm dropping this collection" }),
    ).toBeInTheDocument();
  });

  it("re-reads the header and the sequence once an item is off", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });
    removeEventFromCollection.mockResolvedValue(undefined);

    await renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    );

    await waitFor(() =>
      expect(removeEventFromCollection).toHaveBeenCalledWith("c1", "e1"),
    );
    // The count, the date range and the mosaic all move with the set, and so
    // does the sequence the three sections read.
    await waitFor(() =>
      expect(fetchCollectionSequence).toHaveBeenCalledTimes(2),
    );
  });
});
