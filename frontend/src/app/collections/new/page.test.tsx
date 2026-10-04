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

// The `?event=` read: the picker's first block renders the event's own row.
/** The one-paragraph document for a line of unmarked text. */
function textDoc(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** That document as text, for the stub's seed. */
function docText(doc: Record<string, unknown> | null | undefined): string {
  const paragraph = (doc?.content as { content?: { text?: string }[] }[])?.[0];
  return paragraph?.content?.[0]?.text ?? "";
}
// The Tiptap editor boots ProseMirror once, so it is stubbed as a textarea that prints its seeded document
// and emits the one-paragraph document the real editor emits for unmarked text.
vi.mock("@/components/editor/ProofEditor", () => ({
  default: ({
    initialContent,
    onChange,
  }: {
    initialContent?: Record<string, unknown> | null;
    onChange: (doc: Record<string, unknown>) => void;
  }) => (
    <textarea
      aria-label="Description"
      defaultValue={docText(initialContent)}
      onChange={(e) => onChange(textDoc(e.target.value))}
    />
  ),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const createCollection = vi.fn();
const searchPickableEvents = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  createCollection: (
    title: string,
    description: Record<string, unknown>,
    ids: string[],
  ) => createCollection(title, description, ids),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

// The add block's list only has to render without the network (the walk is tested in `useCursorList`).
const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: () => useCursorList(),
}));

import type { Collection } from "@/lib/collections";

import NewCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

/** One of the analyst's own events, as listed and as the `?event=` read answers. */
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

/** The same event as its detail read. */
const EVENT_DETAIL = { ...EVENT, media: [] };

/** What the add block lists (`useCursorList`'s shape). */
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
  description: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Strikes on the corridor through March." }] },
    ],
  },
  description_text: "Strikes on the corridor through March.",
  cover: [],
  tags: [],
  event_count: 0,
  first_date: null,
  last_date: null,
  created_at: "2026-03-21T09:00:00Z",
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

    render(<NewCollectionPage />);

    // `replace`, so the protected page is not left in history behind the login form.
    expect(replace).toHaveBeenCalledWith("/login");
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
        textDoc("Strikes on the corridor through March."),
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
        textDoc("Strikes on the corridor through March."),
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
      textDoc("Strikes on the corridor through March."),
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
