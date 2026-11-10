import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signedInAs, signedOut } from "@/test/auth";
import { collection, eventRow } from "@/test/collection";
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

import { useApiResource } from "@/test/apiResourceStub";
vi.mock("@/hooks/useApiResource", () => import("@/test/apiResourceStub"));

vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  updateCollection: vi.fn(),
  fetchCollectionSequence: vi.fn(),
  addEventToCollection: vi.fn(),
  removeEventFromCollection: vi.fn(),
  searchPickableEvents: vi.fn(),
}));

// The add block's first page of the analyst's events.
import { apiFetchPage } from "@/test/apiStub";
vi.mock("@/lib/api", () => import("@/test/apiStub"));

// The add block's list is held empty: these specs lock in the diff the save writes.
const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: () => useCursorList(),
}));

import {
  addEventToCollection,
  fetchCollectionSequence,
  removeEventFromCollection,
  searchPickableEvents,
  updateCollection,
  type Collection,
} from "@/lib/collections";

import EditCollectionPage from "./page";

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

/** The page's read: the collection it edits, served at its own path only. */
function mockRead(data: Collection | null, error: string | null = null) {
  useApiResource.mockImplementation((path: string | null) => ({
    data: path === "/collections/c1" ? data : null,
    error: path === "/collections/c1" ? error : null,
    loading: false,
    refetch: vi.fn(),
  }));
}

/** The collection the page opens on, served for `c1` only: the picker's first-block rows and the
 *  save's baseline. */
function mockSequence(...ids: string[]) {
  vi.mocked(fetchCollectionSequence).mockImplementation(async (id) =>
    id === "c1" ? ids.map((e) => eventRow(e, `Strike ${e}`)) : [],
  );
}

/** Render, then wait for the two reads the form needs. */
async function renderPage() {
  render(<EditCollectionPage />);
  await screen.findByLabelText("Title");
}

beforeEach(() => {
  useAuth.mockReturnValue(signedInAs("ana", { id: "u1" }));
  mockRead(collection());
  vi.mocked(updateCollection).mockResolvedValue(collection());
  mockSequence("e1", "e2");
  vi.mocked(addEventToCollection).mockResolvedValue(undefined);
  vi.mocked(removeEventFromCollection).mockResolvedValue(undefined);
  vi.mocked(searchPickableEvents).mockResolvedValue({ items: [], total: 0 });
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

  it("opens on what the collection currently says about itself, under a bare heading", async () => {
    await renderPage();

    expect(screen.getByLabelText("Title")).toHaveValue(
      "Kupiansk rail corridor",
    );
    // No subtitle naming the collection: the Title field says it.
    expect(
      screen.getByRole("heading", { name: "Edit collection" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Kupiansk rail corridor" }),
    ).not.toBeInTheDocument();
    // Seeded with the collection's description; `find` because the form loads it through `next/dynamic`.
    expect(
      await screen.findByRole("textbox", { name: "Description" }),
    ).toHaveValue("Three days of strikes on the eastern approach.");
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
    mockBrowse([eventRow("e4", "Strike on the depot")]);
    // Opens holding `e3` (removed below) and `e2` (kept); `e4` is added.
    mockSequence("e2", "e3");

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
    mockSequence("e1");
    vi.mocked(removeEventFromCollection).mockRejectedValue(new Error("Nope."));

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
    vi.mocked(updateCollection).mockRejectedValue(new Error("Title already used."));

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
