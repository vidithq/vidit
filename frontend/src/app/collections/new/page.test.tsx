import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { textHtml } from "@/test/proofEditorStub";

const push = vi.fn();
const replace = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

vi.mock("@/components/editor/ProofEditor", () => import("@/test/proofEditorStub"));

// MapLibre needs WebGL; the Coverage map is `CollectionCoverage.test.tsx`'s subject.
vi.mock("@/components/map/Map", () => ({ default: () => <div data-testid="map" /> }));

// The `?event=` read: the picker's first block renders the event's own row.
const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const createCollection = vi.fn();
const addEventsToCollection = vi.fn();
const searchPickableEvents = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  createCollection: (
    title: string,
    description: string,
    ids: string[],
  ) => createCollection(title, description, ids),
  addEventsToCollection: (id: string, target: unknown) => addEventsToCollection(id, target),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

// The add block's list and a match's pages only have to render without the network (the walk is
// tested in `useCursorList`); the mock tells them apart by their first page's path.
const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: (
    buildPath: (cursor: string | null) => string | null,
    _rows: unknown,
    _next: unknown,
    body?: string,
  ) => useCursorList(buildPath(null), body),
}));

import { ApiError } from "@/lib/api";
import {
  newCollectionFromSelectionHref,
  type Collection,
  type PickableEvent,
  type SelectionHandoff,
} from "@/lib/collections";

import NewCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

/** One of the analyst's own events, as listed and as the `?event=` read answers. */
const EVENT = {
  id: "e1",
  title: "Strike on the rail junction",
  status: "geolocated",
  media: null,
  is_graphic: false,
  occurred_date: "2026-03-14",
  coords: { lat: 49.71, lng: 37.616 },
  tags: [],
  owner: USER,
  conflicts: [],
  before_closed_status: null,
};

/** The same event as its detail read. */
const EVENT_DETAIL = { ...EVENT, media: [] };

/** A `useCursorList` result holding `items`. */
const walkOf = (items: unknown[], more: Partial<{ hasMore: boolean; loadMore: () => void }> = {}) => ({
  items,
  error: null,
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
  reload: vi.fn(),
  ...more,
});

/** What the add block lists. */
function mockBrowse(items: unknown[]) {
  useCursorList.mockReturnValue(walkOf(items));
}

/** The pages of a search match so far, beside an empty add block. */
function mockMatchPages(items: unknown[], more: Partial<{ hasMore: boolean; loadMore: () => void }> = {}) {
  useCursorList.mockImplementation((path: string | null) =>
    path?.startsWith("/collections/collectable-events") ? walkOf(items, more) : walkOf([]),
  );
}

const created: Collection = {
  id: "c9",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "March strikes",
  description: "<p>Strikes on the corridor through March.</p>",
  description_text: "Strikes on the corridor through March.",
  cover: [],
  tags: [],
  event_count: 0,
  first_date: null,
  last_date: null,
  created_at: "2026-03-21T09:00:00Z",
  hidden_at: null,
};

/** Fill both required fields; awaits the description first (the editor loads through `next/dynamic`). */
async function fillForm() {
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "March strikes" },
  });
  fireEvent.change(await screen.findByRole("textbox", { name: "Description" }), {
    target: { value: "Strikes on the corridor through March." },
  });
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  useAuth.mockReset();
  useApiResource.mockReset();
  createCollection.mockReset();
  searchPickableEvents.mockReset();
  useCursorList.mockReset();
  searchParams.delete("event");
  searchParams.delete("selection");
  window.sessionStorage.clear();
  addEventsToCollection.mockReset();

  useAuth.mockReturnValue({ user: USER, loading: false });
  // The hook reads nothing while the path is null (every render without `?event=`).
  useApiResource.mockImplementation((path: string | null) => ({
    data: path === null ? null : EVENT_DETAIL,
    error: null,
    loading: false,
    refetch: vi.fn(),
  }));
  createCollection.mockResolvedValue(created);
  searchPickableEvents.mockResolvedValue({ items: [], total: 0 });
  mockBrowse([]);
});

describe("NewCollectionPage", () => {
  it("bounces a signed-out visitor to the login form", () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    window.history.replaceState(null, "", "/collections/new");

    render(<NewCollectionPage />);

    // `replace`, so the protected page is not left in history behind the login form.
    expect(replace).toHaveBeenCalledWith("/login?next=%2Fcollections%2Fnew");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("waits on the session rather than bouncing while it resolves", () => {
    useAuth.mockReturnValue({ user: null, loading: true });

    render(<NewCollectionPage />);

    expect(replace).not.toHaveBeenCalled();
  });

  it("splits the form into a Details card, an Events in this collection card, and an Add events card", () => {
    render(<NewCollectionPage />);

    expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Events in this collection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add events" }),
    ).toBeInTheDocument();
    // Nothing to drop yet.
    expect(
      screen.queryByRole("heading", { name: "Drop this collection" }),
    ).not.toBeInTheDocument();
  });

  it("opens the collection it created", async () => {
    render(<NewCollectionPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    // Both fields travel trimmed; nothing ticked, so the collection opens empty.
    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith(
        "March strikes",
        textHtml("Strikes on the corridor through March."),
        [],
      ),
    );
    expect(push).toHaveBeenCalledWith("/collections/c9");
  });

  it("carries the event it was opened for and returns to it", async () => {
    searchParams.set("event", "e1");

    render(<NewCollectionPage />);
    // Details counts what the create holds.
    expect(screen.getByText("1 event")).toBeInTheDocument();
    // The event's own row, read off `/events/{id}`.
    expect(useApiResource).toHaveBeenCalledWith("/events/e1");
    expect(
      screen.getByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    ).toBeInTheDocument();
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    // `?event=` rides the create like any added row (one refusal takes the whole act), then back to the event.
    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith(
        "March strikes",
        textHtml("Strikes on the corridor through March."),
        ["e1"],
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e1"));
  });

  it("opens empty, and an added row is what the create carries", async () => {
    mockBrowse([EVENT]);

    render(<NewCollectionPage />);
    await fillForm();
    expect(
      screen.getByText("0 events, ordered by event date, earliest first."),
    ).toBeInTheDocument();

    fireEvent.focus(screen.getByRole("combobox", { name: "Add events" }));
    fireEvent.click(
      screen.getByRole("option", { name: /^Strike on the rail junction/ }),
    );
    // The row moved onto the block above, which is what the create writes.
    expect(
      screen.getByText("1 event, ordered by event date, earliest first."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(createCollection).toHaveBeenCalledWith(
      "March strikes",
      textHtml("Strikes on the corridor through March."),
      ["e1"],
    );
  });

  it("stays on the page and says why when the create is refused", async () => {
    createCollection.mockRejectedValue(new Error("Title already used."));

    render(<NewCollectionPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    await waitFor(() =>
      expect(screen.getByText("Title already used.")).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("refuses a collection with no description", () => {
    render(<NewCollectionPage />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "March strikes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    expect(screen.getByText(/^Fill in the required fields/)).toHaveTextContent("Description");
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("cancels back to the profile the section that offers it lives on", () => {
    render(<NewCollectionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(push).toHaveBeenCalledWith("/profile/ana");
  });

  it("cancels back to the event, when it came from one", () => {
    searchParams.set("event", "e1");

    render(<NewCollectionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(push).toHaveBeenCalledWith("/events/e1");
  });
});

describe("NewCollectionPage with a search selection", () => {
  /** Park a selection the way the search page does and point the page at its token. */
  function handOff(handoff: SelectionHandoff) {
    const href = newCollectionFromSelectionHref(handoff);
    const token = new URL(href, "http://localhost").searchParams.get("selection");
    expect(token).toBeTruthy();
    searchParams.set("selection", token as string);
  }

  it("holds the checked rows it was handed, removable, and the create sends what is left", async () => {
    const row = (id: string, title: string): PickableEvent => ({
      ...EVENT,
      id,
      title,
      status: "geolocated",
      media: null,
    });
    handOff({
      target: { eventIds: ["e7", "e8"] },
      rows: [row("e7", "Depot fire"), row("e8", "Bridge strike")],
      count: 2,
      from: "/search?q=dam",
    });
    render(<NewCollectionPage />);

    // The rows came with the selection: nothing to read, and no count card.
    expect(useApiResource).not.toHaveBeenCalledWith(expect.stringMatching(/^\/events\//));
    expect(screen.getByText("Depot fire")).toBeInTheDocument();
    expect(screen.getByText("Bridge strike")).toBeInTheDocument();
    expect(screen.queryByText(/will be added/)).not.toBeInTheDocument();
    expect(await screen.findByText("2 events")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Depot fire from this collection" }));
    expect(screen.getByText("1 event")).toBeInTheDocument();

    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/collections/c9"));
    expect(createCollection).toHaveBeenCalledWith("March strikes", expect.any(String), ["e8"]);
    expect(addEventsToCollection).not.toHaveBeenCalled();
    // Spent: Back to this page opens the plain form.
    expect(window.sessionStorage.length).toBe(0);
  });

  it("shows a match's events a page at a time, and the save adds the match less the removed", async () => {
    const match = { q: "dam", tags: ["flood"] };
    handOff({ target: { match }, rows: [], count: 44, from: "/search?q=dam" });
    const loadMore = vi.fn();
    const row = (id: string, title: string): PickableEvent => ({
      ...EVENT,
      id,
      title,
      status: "geolocated",
      media: null,
    });
    mockMatchPages([row("m1", "Dam breach"), row("m2", "Flooded village")], {
      hasMore: true,
      loadMore,
    });
    addEventsToCollection.mockResolvedValue({
      added: 43,
      skipped: { already_in_collection: 0, not_collectable: 0 },
    });
    render(<NewCollectionPage />);

    // The match's own search, posted as the walk's body; no count card any more.
    expect(useCursorList).toHaveBeenCalledWith(
      "/collections/collectable-events?limit=20",
      JSON.stringify({ q: "dam", filters: { tag: ["flood"] } }),
    );
    expect(screen.queryByText(/will be added/)).not.toBeInTheDocument();
    expect(screen.getByText("Dam breach")).toBeInTheDocument();
    expect(screen.getByText("44 events, ordered by event date, earliest first.")).toBeInTheDocument();
    expect(screen.getByText("44 events")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(loadMore).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Remove Dam breach from this collection" }));
    expect(screen.queryByText("Dam breach")).not.toBeInTheDocument();
    expect(screen.getByText("43 events")).toBeInTheDocument();

    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/collections/c9"));
    expect(createCollection).toHaveBeenCalledWith("March strikes", expect.any(String), []);
    expect(addEventsToCollection).toHaveBeenCalledWith("c9", { match, excludeEventIds: ["m1"] });
  });

  it("keeps the collection it made when the match add fails, and a retry only adds", async () => {
    handOff({ target: { match: { q: "dam" } }, rows: [], count: 600, from: "/search?q=dam" });
    mockMatchPages([]);
    addEventsToCollection.mockRejectedValueOnce(
      new ApiError("Add at most 500 events at once; narrow the selection", 422, "too_many_events"),
    );
    render(<NewCollectionPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    expect(
      await screen.findByText(/The collection is created, but the geolocations were not added/),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    addEventsToCollection.mockResolvedValueOnce({
      added: 1,
      skipped: { already_in_collection: 0, not_collectable: 0 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/collections/c9"));
    expect(createCollection).toHaveBeenCalledOnce();
  });

  it("cancels back to the search the selection came from", () => {
    handOff({ target: { eventIds: ["e7"] }, rows: [], count: 1, from: "/search?q=dam" });
    render(<NewCollectionPage />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenCalledWith("/search?q=dam");
  });

  it("opens the plain form on an unknown token", () => {
    searchParams.set("selection", "gone");
    render(<NewCollectionPage />);

    expect(screen.queryByText(/will be added/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create collection" })).toBeInTheDocument();
  });
});
