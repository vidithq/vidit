import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "c1" }),
  usePathname: () => "/collections/c1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// MapLibre touches `window` at module scope, so the coverage map never loads
// its real canvas under jsdom. The stub reports the pins it was handed, which
// is what the camera is fitted to.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({ points }: { points: unknown[] }) {
      return <div data-testid="map" data-points={points.length} />;
    },
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: (build: (cursor: string | null) => string) =>
    useCursorList(build),
}));

const removeEventFromCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  removeEventFromCollection: (c: string, e: string) =>
    removeEventFromCollection(c, e),
}));

import type { Collection } from "@/lib/collections";
import type { EventListItem } from "@/types";

import CollectionPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: OWNER,
  title: "Kupiansk rail corridor",
  cover_url: null,
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

const reload = vi.fn();

function list(items: EventListItem[] = ITEMS) {
  return {
    items,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    reload,
  };
}

beforeEach(() => {
  useAuth.mockReset();
  useApiResource.mockReset();
  useCursorList.mockReset();
  removeEventFromCollection.mockReset();
  reload.mockReset();
  useAuth.mockReturnValue({ user: null });
  useApiResource.mockReturnValue({
    data: collection(),
    error: null,
    refetch: vi.fn(),
  });
  useCursorList.mockReturnValue(list());
});

describe("CollectionPage", () => {
  it("titles itself with the collection and names its owner", () => {
    render(<CollectionPage />);

    expect(
      screen.getByRole("heading", { name: "Kupiansk rail corridor" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute(
      "href",
      "/profile/ana",
    );
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });

  it("counts the items and names the span they cover", () => {
    render(<CollectionPage />);

    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(screen.getByText("14 Mar 2026 to 16 Mar 2026")).toBeInTheDocument();
  });

  it("says one event in the singular", () => {
    useApiResource.mockReturnValue({
      data: collection({ event_count: 1, last_date: "2026-03-14" }),
      error: null,
      refetch: vi.fn(),
    });
    useCursorList.mockReturnValue(list([ITEMS[0]]));

    render(<CollectionPage />);

    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(screen.getByText("1 event on the map")).toBeInTheDocument();
  });

  it("shows no cover band when the collection has no picture", () => {
    render(<CollectionPage />);

    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens on the cover when the collection carries one", () => {
    useApiResource.mockReturnValue({
      data: collection({ cover_url: "https://media.example/cover.jpg" }),
      error: null,
      refetch: vi.fn(),
    });

    render(<CollectionPage />);

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://media.example/cover.jpg",
    );
  });

  it("maps the items' pins and lists them in order, each with its status", () => {
    render(<CollectionPage />);

    expect(screen.getByTestId("map")).toHaveAttribute("data-points", "2");
    expect(screen.getByText("2 events on the map")).toBeInTheDocument();
    const rows = screen.getAllByRole("heading", { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual([
      "Strike on the rail junction",
      "Damaged locomotive shed",
    ]);
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    expect(screen.getByText("Detected")).toBeInTheDocument();
  });

  it("repeats no byline on a row: the header already names the analyst", () => {
    render(<CollectionPage />);

    expect(screen.queryByText(/^by/)).not.toBeInTheDocument();
  });

  it("hands a visitor no owner control", () => {
    render(<CollectionPage />);

    for (const name of [
      "Rename this collection",
      "Change the cover",
      "Remove Strike on the rail junction from this collection",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("gives the owner the title, the cover, the drop and a control per item", () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    render(<CollectionPage />);

    expect(
      screen.getByRole("button", { name: "Rename this collection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change the cover" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Drop this collection (the events it holds stay)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    ).toBeInTheDocument();
  });

  it("asks twice before dropping the collection", () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    render(<CollectionPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Drop this collection (the events it holds stay)",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Confirm dropping this collection" }),
    ).toBeInTheDocument();
  });

  it("re-reads the header and the walk once an item is off", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });
    removeEventFromCollection.mockResolvedValue(undefined);

    render(<CollectionPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    );

    await waitFor(() =>
      expect(removeEventFromCollection).toHaveBeenCalledWith("c1", "e1"),
    );
    // The count, the date range and the default cover all move with the set.
    expect(reload).toHaveBeenCalled();
  });
});
