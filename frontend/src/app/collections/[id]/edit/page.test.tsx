import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "c1" }),
  usePathname: () => "/collections/c1/edit",
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const updateCollection = vi.fn();
const fetchCollectionSequence = vi.fn();
const addEventToCollection = vi.fn();
const removeEventFromCollection = vi.fn();
const searchPickableEvents = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  updateCollection: (id: string, title: string, description: string) =>
    updateCollection(id, title, description),
  fetchCollectionSequence: (id: string) => fetchCollectionSequence(id),
  addEventToCollection: (c: string, e: string) => addEventToCollection(c, e),
  removeEventFromCollection: (c: string, e: string) =>
    removeEventFromCollection(c, e),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

// The add block's list, held empty: what these lock in is the diff the save
// writes, which is what the picker holds against the items the page opened
// on.
const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: () => useCursorList(),
}));

import type { Collection } from "@/lib/collections";

import EditCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

/** One of the analyst's own events, as the sequence walk and the add block
 *  both hand it over. */
const event = (id: string, title: string) => ({
  id,
  title,
  status: "geolocated",
  media: null,
  is_graphic: false,
  event_date: "2026-03-15",
  event_coords: { lat: 49.71, lng: 37.616 },
  tags: [],
  owner: USER,
  conflicts: [],
  before_closed_status: null,
});

/** What the add block lists, `useCursorList`'s own shape. */
function mockBrowse(items: unknown[]) {
  useCursorList.mockReturnValue({
    items,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
  });
}

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: "Three days of strikes on the eastern approach.",
  cover: [],
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
  ...over,
});

/** The read the page makes: the collection it edits. */
function mockRead(data: Collection | null, error: string | null = null) {
  useApiResource.mockReturnValue({
    data,
    error,
    loading: false,
    refetch: vi.fn(),
  });
}

/** The collection the page opens on, as the sequence walk hands it over: the
 *  rows the picker's first block renders, and the baseline the save diffs
 *  against. */
const sequenceOf = (...ids: string[]) =>
  ids.map((id) => event(id, `Strike ${id}`));

/** Render, then wait for the two reads the form needs before it mounts. */
async function renderPage() {
  render(<EditCollectionPage />);
  await screen.findByLabelText("Title");
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  useAuth.mockReset();
  useApiResource.mockReset();
  updateCollection.mockReset();
  fetchCollectionSequence.mockReset();
  addEventToCollection.mockReset();
  removeEventFromCollection.mockReset();
  searchPickableEvents.mockReset();
  useCursorList.mockReset();
  useAuth.mockReturnValue({ user: USER, loading: false });
  mockRead(collection());
  updateCollection.mockResolvedValue(collection());
  fetchCollectionSequence.mockResolvedValue(sequenceOf("e1", "e2"));
  addEventToCollection.mockResolvedValue(undefined);
  removeEventFromCollection.mockResolvedValue(undefined);
  searchPickableEvents.mockResolvedValue({ items: [], total: 0 });
  mockBrowse([]);
});

describe("EditCollectionPage", () => {
  it("bounces a signed-out visitor to the login form", () => {
    useAuth.mockReturnValue({ user: null, loading: false });

    render(<EditCollectionPage />);

    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("opens on what the collection currently says about itself", async () => {
    await renderPage();

    expect(useApiResource).toHaveBeenCalledWith("/collections/c1");
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Kupiansk rail corridor",
    );
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Three days of strikes on the eastern approach.",
    );
  });

  it("carries no subtitle naming the collection, the Title field says it", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Edit collection" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Kupiansk rail corridor")).not.toBeInTheDocument();
  });

  it("splits the form into a Details card, an Events in this collection card, and an Add events card", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Events in this collection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add events" }),
    ).toBeInTheDocument();
    // No drop card here: dropping the collection lives on its own page header.
    expect(
      screen.queryByRole("heading", { name: "Drop this collection" }),
    ).not.toBeInTheDocument();
  });

  it("writes both details and returns to the collection", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Kupiansk rail corridor, March" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));

    // Both fields ride every write, so a renamed collection cannot be left
    // describing the old one.
    await waitFor(() =>
      expect(updateCollection).toHaveBeenCalledWith(
        "c1",
        "Kupiansk rail corridor, March",
        "Three days of strikes on the eastern approach.",
      ),
    );
    expect(push).toHaveBeenCalledWith("/collections/c1");
  });

  it("opens the picker on what the collection holds", async () => {
    await renderPage();

    expect(fetchCollectionSequence).toHaveBeenCalledWith("c1");
    // The first block is the collection's current items, each with the cross
    // that takes it off, so the edit starts on the collection rather than on
    // nothing.
    expect(
      screen.getByText("2 events, ordered by event date, earliest first."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove Strike e1 from this collection",
      }),
    ).toBeInTheDocument();
  });

  it("writes the difference the picker made, after the details", async () => {
    mockBrowse([event("e4", "Strike on the depot")]);
    // The collection opens holding `e3`, which the cross below takes off, and
    // `e2`, which it keeps. `e4` is added from the block under them.
    fetchCollectionSequence.mockResolvedValue(sequenceOf("e2", "e3"));

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Strike e3 from this collection",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Strike on the depot to this collection",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/collections/c1"));
    // The details first, then only what moved: the row the picker still holds
    // is left alone, since both membership routes are idempotent but a write
    // per row would be a request for every item on a long shelf.
    expect(updateCollection).toHaveBeenCalled();
    expect(addEventToCollection).toHaveBeenCalledWith("c1", "e4");
    expect(removeEventFromCollection).toHaveBeenCalledWith("c1", "e3");
    expect(removeEventFromCollection).toHaveBeenCalledTimes(1);
  });

  it("stops at the first refusal the difference meets", async () => {
    fetchCollectionSequence.mockResolvedValue(sequenceOf("e1"));
    removeEventFromCollection.mockRejectedValue(new Error("Nope."));

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Strike e1 from this collection",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));

    await waitFor(() =>
      expect(screen.getByText("Nope.")).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("stays on the page and says why when the save is refused", async () => {
    updateCollection.mockRejectedValue(new Error("Title already used."));

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));

    await waitFor(() =>
      expect(screen.getByText("Title already used.")).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("cancels back to the collection, writing nothing", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateCollection).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/collections/c1");
  });

  it("refuses an analyst who does not own the collection", () => {
    useAuth.mockReturnValue({ user: { id: "u2", username: "bo" } });

    render(<EditCollectionPage />);

    // The gate the backend enforces with a 403, stated before the form rather
    // than after a bounced write, with the way to the collection itself.
    expect(
      screen.getByText(/You can only edit your own collections/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View this collection" }),
    ).toHaveAttribute("href", "/collections/c1");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("says so when the read itself fails", () => {
    mockRead(null, "Not found");

    render(<EditCollectionPage />);

    expect(screen.getByText("Not found")).toBeInTheDocument();
  });
});
