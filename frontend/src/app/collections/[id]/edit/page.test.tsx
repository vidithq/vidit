import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signedInAs, signedOut } from "@/test/auth";
import { textHtml } from "@/test/proofEditorStub";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "c1" }),
  usePathname: () => "/collections/c1/edit",
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

vi.mock("@/components/editor/ProofEditor", () => import("@/test/proofEditorStub"));

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
  updateCollection: (
    id: string,
    title: string,
    description: string,
  ) => updateCollection(id, title, description),
  fetchCollectionSequence: (id: string) => fetchCollectionSequence(id),
  addEventToCollection: (c: string, e: string) => addEventToCollection(c, e),
  removeEventFromCollection: (c: string, e: string) =>
    removeEventFromCollection(c, e),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

// The add block's first page of the analyst's events.
const apiFetchPage = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetchPage: () => apiFetchPage(),
}));

// The add block's list is held empty: these specs lock in the diff the save writes.
const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: () => useCursorList(),
}));

import type { Collection } from "@/lib/collections";

import EditCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

/** One of the analyst's own events. */
const event = (id: string, title: string) => ({
  id,
  title,
  status: "geolocated",
  media: null,
  is_graphic: false,
  occurred_date: "2026-03-15",
  coords: { lat: 49.71, lng: 37.616 },
  tags: [],
  owner: USER,
  conflicts: [],
  before_closed_status: null,
});

/** What the add block lists. */
function mockBrowse(items: unknown[]) {
  useCursorList.mockReturnValue({
    items: [],
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
  });
  apiFetchPage.mockResolvedValue({ items, nextCursor: null });
}

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: "<p>Three days of strikes on the eastern approach.</p>",
  description_text: "Three days of strikes on the eastern approach.",
  cover: [],
  tags: [],
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
  hidden_at: null,
  ...over,
});

/** The page's read: the collection it edits. */
function mockRead(data: Collection | null, error: string | null = null) {
  useApiResource.mockReturnValue({
    data,
    error,
    loading: false,
    refetch: vi.fn(),
  });
}

/** The collection the page opens on: the picker's first-block rows and the save's baseline. */
const sequenceOf = (...ids: string[]) =>
  ids.map((id) => event(id, `Strike ${id}`));

/** Render, then wait for the two reads the form needs. */
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
  useAuth.mockReturnValue(signedInAs("ana", { id: "u1" }));
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
    useAuth.mockReturnValue(signedOut());
    window.history.replaceState(null, "", "/collections/c1/edit");

    render(<EditCollectionPage />);

    expect(replace).toHaveBeenCalledWith("/login?next=%2Fcollections%2Fc1%2Fedit");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("opens on what the collection currently says about itself", async () => {
    await renderPage();

    expect(useApiResource).toHaveBeenCalledWith("/collections/c1");
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Kupiansk rail corridor",
    );
    // Seeded with the collection's description; `find` because the form loads it through `next/dynamic`.
    expect(
      await screen.findByRole("textbox", { name: "Description" }),
    ).toHaveValue("Three days of strikes on the eastern approach.");
  });

  it("carries no subtitle naming the collection, the Title field says it", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Edit collection" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Kupiansk rail corridor" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Kupiansk rail corridor");
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
    // Dropping lives on the collection page's header.
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

    // Both fields ride every write, so a rename cannot leave the old description.
    await waitFor(() =>
      expect(updateCollection).toHaveBeenCalledWith(
        "c1",
        "Kupiansk rail corridor, March",
        textHtml("Three days of strikes on the eastern approach."),
      ),
    );
    expect(push).toHaveBeenCalledWith("/collections/c1");
  });

  it("opens the picker on what the collection holds", async () => {
    await renderPage();

    expect(fetchCollectionSequence).toHaveBeenCalledWith("c1");
    // The first block is the current items, each with a remove cross.
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
    // Opens holding `e3` (removed below) and `e2` (kept); `e4` is added.
    fetchCollectionSequence.mockResolvedValue(sequenceOf("e2", "e3"));

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Strike e3 from this collection",
      }),
    );
    fireEvent.focus(screen.getByRole("combobox", { name: "Add events" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Strike on the depot/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save collection" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/collections/c1"));
    // Details first, then only what moved: a write per row would flood a long shelf.
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
    useAuth.mockReturnValue(signedInAs("bo", { id: "u2" }));

    render(<EditCollectionPage />);

    // The backend's 403 gate, stated before the form, with the way to the collection.
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
