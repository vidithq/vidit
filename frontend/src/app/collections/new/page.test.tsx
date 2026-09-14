import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

// The read behind `?event=`: the page renders the event's own row on the
// picker's first block, so it reads the event rather than only its id.
const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const createCollection = vi.fn();
const searchPickableEvents = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  createCollection: (title: string, description: string, ids: string[]) =>
    createCollection(title, description, ids),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

// The add block's list. The walk itself is `useCursorList`'s own test and the
// picker's; here it only has to render without reaching the network, so the
// page's own acts are what these assert.
const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: () => useCursorList(),
}));

import type { Collection } from "@/lib/collections";

import NewCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

/** One of the analyst's own events, as the add block lists it and as the
 *  `?event=` read answers. */
const EVENT = {
  id: "e1",
  title: "Strike on the rail junction",
  status: "geolocated",
  media: null,
  is_graphic: false,
  event_date: "2026-03-14",
  event_coords: { lat: 49.71, lng: 37.616 },
  tags: [],
  owner: USER,
  conflicts: [],
  before_closed_status: null,
};

/** The same event as its own detail read, whose media is a list. */
const EVENT_DETAIL = { ...EVENT, media: [] };

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

const created: Collection = {
  id: "c9",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "March strikes",
  description: "Strikes on the corridor through March.",
  cover: [],
  event_count: 0,
  first_date: null,
  last_date: null,
  created_at: "2026-03-21T09:00:00Z",
};

/** Fill both required fields, which is what unlocks the submit. */
function fillForm() {
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "March strikes" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "  Strikes on the corridor through March.  " },
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
  useAuth.mockReturnValue({ user: USER, loading: false });
  // The hook's own contract: it reads nothing while the path is null, which
  // is every render without `?event=`.
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

    render(<NewCollectionPage />);

    // `replace`, so the protected page does not sit in history behind the
    // login form, and nothing of the form renders while the bounce is in
    // flight.
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("waits on the session rather than bouncing while it resolves", () => {
    useAuth.mockReturnValue({ user: null, loading: true });

    render(<NewCollectionPage />);

    expect(replace).not.toHaveBeenCalled();
  });

  it("splits the form into a Details card and an Events card", () => {
    render(<NewCollectionPage />);

    expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Events in this collection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add events" }),
    ).toBeInTheDocument();
    // The create page has no collection to drop yet.
    expect(
      screen.queryByRole("heading", { name: "Drop this collection" }),
    ).not.toBeInTheDocument();
  });

  it("opens the collection it created", async () => {
    render(<NewCollectionPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    // Both fields travel, trimmed, so the server stores neither padding nor a
    // collection that says nothing about itself. Nothing was ticked, so the
    // collection opens empty.
    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith(
        "March strikes",
        "Strikes on the corridor through March.",
        [],
      ),
    );
    expect(push).toHaveBeenCalledWith("/collections/c9");
  });

  it("carries the event it was opened for and returns to it", async () => {
    searchParams.set("event", "e1");

    render(<NewCollectionPage />);
    expect(
      screen.getByText("The collection opens with this event on it."),
    ).toBeInTheDocument();
    // The event's own row, on the block that says what the collection will
    // hold, read off `/events/{id}` rather than guessed from the id.
    expect(useApiResource).toHaveBeenCalledWith("/events/e1");
    expect(
      screen.getByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    ).toBeInTheDocument();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    // `?event=` puts the event on the picker's first block, so it rides the
    // create like every other row the analyst adds, and one refusal takes the
    // whole act with it. Then the reader lands back on the event.
    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith(
        "March strikes",
        "Strikes on the corridor through March.",
        ["e1"],
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e1"));
  });

  it("opens empty, and an added row is what the create carries", () => {
    mockBrowse([EVENT]);

    render(<NewCollectionPage />);
    fillForm();
    expect(
      screen.getByText("0 events, ordered by event date, earliest first."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Strike on the rail junction to this collection",
      }),
    );
    // The row moved onto the block above, which is what the create writes.
    expect(
      screen.getByText("1 event, ordered by event date, earliest first."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(createCollection).toHaveBeenCalledWith(
      "March strikes",
      "Strikes on the corridor through March.",
      ["e1"],
    );
  });

  it("stays on the page and says why when the create is refused", async () => {
    createCollection.mockRejectedValue(new Error("Title already used."));

    render(<NewCollectionPage />);
    fillForm();
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

    expect(
      screen.getByRole("button", { name: "Create collection" }),
    ).toBeDisabled();
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
