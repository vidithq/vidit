import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signedInAs } from "@/test/auth";
import { collection, eventRow } from "@/test/collection";
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
vi.mock("@/components/map/Map", () => import("@/test/mapStub"));

// The `?event=` read: the picker's first block renders the event's own row.
import { useApiResource } from "@/test/apiResourceStub";
vi.mock("@/hooks/useApiResource", () => import("@/test/apiResourceStub"));

vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  createCollection: vi.fn(),
  addEventsToCollection: vi.fn(),
  searchPickableEvents: vi.fn(),
}));

// The add block's first page of the analyst's events.
import { apiFetchPage } from "@/test/apiStub";
vi.mock("@/lib/api", () => import("@/test/apiStub"));

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
  addEventsToCollection,
  createCollection,
  newCollectionFromSelectionHref,
  searchPickableEvents,
  type SelectionHandoff,
} from "@/lib/collections";

import NewCollectionPage from "./page";

/** One of the analyst's own events, as listed and as the `?event=` read answers. */
const EVENT = eventRow("e1", "Strike on the rail junction");

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
  useCursorList.mockReturnValue(walkOf([]));
  apiFetchPage.mockResolvedValue({ items, nextCursor: null });
}

/** The pages of the search match posted as `body` so far, beside an empty add block. */
function mockMatchPages(
  body: string,
  items: unknown[],
  more: Partial<{ hasMore: boolean; loadMore: () => void }> = {},
) {
  useCursorList.mockImplementation((path: string | null, sent?: string) =>
    path === "/collections/collectable-events?limit=20" && sent === body
      ? walkOf(items, more)
      : walkOf([]),
  );
}

const created = collection({
  id: "c9",
  title: "March strikes",
  description: "<p>Strikes on the corridor through March.</p>",
  description_text: "Strikes on the corridor through March.",
  event_count: 0,
  first_date: null,
  last_date: null,
});

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
  searchParams.delete("event");
  searchParams.delete("selection");
  window.sessionStorage.clear();

  useAuth.mockReturnValue(signedInAs("ana", { id: "u1" }));
  // Only the `?event=e1` read answers; the hook reads nothing while the path is null.
  useApiResource.mockImplementation((path: string | null) => ({
    data: path === "/events/e1" ? EVENT_DETAIL : null,
    error: null,
    loading: false,
    refetch: vi.fn(),
  }));
  vi.mocked(createCollection).mockResolvedValue(created);
  vi.mocked(searchPickableEvents).mockResolvedValue({ items: [], total: 0 });
  mockBrowse([]);
});


describe("NewCollectionPage", () => {
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
      await screen.findByRole("option", { name: /^Strike on the rail junction/ }),
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
    vi.mocked(createCollection).mockRejectedValue(new Error("Title already used."));

    render(<NewCollectionPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    await waitFor(() =>
      expect(screen.getByText("Title already used.")).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
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
    handOff({
      target: { eventIds: ["e7", "e8"] },
      rows: [eventRow("e7", "Depot fire"), eventRow("e8", "Bridge strike")],
      count: 2,
      from: "/search?q=dam",
    });
    render(<NewCollectionPage />);

    // The rows came with the selection: nothing to read, and no count card.
    expect(useApiResource).not.toHaveBeenCalledWith(expect.stringMatching(/^\/events\//));
    expect(screen.getByText("Depot fire")).toBeInTheDocument();
    expect(screen.getByText("Bridge strike")).toBeInTheDocument();
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
    // The match's own search, posted as the walk's body.
    mockMatchPages(
      JSON.stringify({ q: "dam", filters: { tag: ["flood"] } }),
      [eventRow("m1", "Dam breach"), eventRow("m2", "Flooded village")],
      { hasMore: true, loadMore },
    );
    vi.mocked(addEventsToCollection).mockResolvedValue({
      added: 43,
      skipped: { already_in_collection: 0, not_collectable: 0 },
    });
    render(<NewCollectionPage />);

    // No count card any more.
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
    vi.mocked(addEventsToCollection).mockRejectedValueOnce(
      new ApiError("Add at most 500 events at once; narrow the selection", 422, "too_many_events"),
    );
    render(<NewCollectionPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    expect(
      await screen.findByText(/The collection is created, but the geolocations were not added/),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    vi.mocked(addEventsToCollection).mockResolvedValueOnce({
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

    expect(screen.getByRole("button", { name: "Create collection" })).toBeInTheDocument();
  });
});
