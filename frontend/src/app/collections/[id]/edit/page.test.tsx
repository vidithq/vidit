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
const deleteCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  updateCollection: (id: string, title: string, description: string) =>
    updateCollection(id, title, description),
  deleteCollection: (id: string) => deleteCollection(id),
}));

import type { Collection } from "@/lib/collections";

import EditCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

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

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  useAuth.mockReset();
  useApiResource.mockReset();
  updateCollection.mockReset();
  deleteCollection.mockReset();
  useAuth.mockReturnValue({ user: USER, loading: false });
  mockRead(collection());
  updateCollection.mockResolvedValue(collection());
  deleteCollection.mockResolvedValue(undefined);
});

describe("EditCollectionPage", () => {
  it("bounces a signed-out visitor to the login form", () => {
    useAuth.mockReturnValue({ user: null, loading: false });

    render(<EditCollectionPage />);

    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("opens on what the collection currently says about itself", () => {
    render(<EditCollectionPage />);

    expect(useApiResource).toHaveBeenCalledWith("/collections/c1");
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Kupiansk rail corridor",
    );
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Three days of strikes on the eastern approach.",
    );
  });

  it("writes both details and returns to the collection", async () => {
    render(<EditCollectionPage />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Kupiansk rail corridor, March" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

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

  it("stays on the page and says why when the save is refused", async () => {
    updateCollection.mockRejectedValue(new Error("Title already used."));

    render(<EditCollectionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() =>
      expect(screen.getByText("Title already used.")).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("cancels back to the collection, writing nothing", () => {
    render(<EditCollectionPage />);
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

  it("asks twice before dropping the collection, then returns to the profile", async () => {
    render(<EditCollectionPage />);

    // The sentence beside the control says what survives the act, since that
    // is the part a reader hesitates over.
    expect(
      screen.getByText(/The events it holds stay exactly as they are/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Drop this collection" }),
    );
    expect(deleteCollection).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm dropping this collection" }),
    );

    await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith("c1"));
    // Where the owner's other collections are.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile/ana"));
  });

  it("stays on the page and says why when the drop is refused", async () => {
    deleteCollection.mockRejectedValue(new Error("Nope."));

    render(<EditCollectionPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Drop this collection" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm dropping this collection" }),
    );

    await waitFor(() => expect(screen.getByText("Nope.")).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });
});
