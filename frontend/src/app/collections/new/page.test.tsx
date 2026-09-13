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

const createCollection = vi.fn();
const addEventToCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  createCollection: (title: string, description: string) =>
    createCollection(title, description),
  addEventToCollection: (c: string, e: string) => addEventToCollection(c, e),
}));

import type { Collection } from "@/lib/collections";

import NewCollectionPage from "./page";

const USER = { id: "u1", username: "ana" };

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
  createCollection.mockReset();
  addEventToCollection.mockReset();
  searchParams.delete("event");
  useAuth.mockReturnValue({ user: USER, loading: false });
  createCollection.mockResolvedValue(created);
  addEventToCollection.mockResolvedValue(undefined);
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

  it("opens the collection it created", async () => {
    render(<NewCollectionPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    // Both fields travel, trimmed, so the server stores neither padding nor a
    // collection that says nothing about itself.
    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith(
        "March strikes",
        "Strikes on the corridor through March.",
      ),
    );
    expect(addEventToCollection).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/collections/c9");
  });

  it("shelves the event it was opened for and returns to it", async () => {
    searchParams.set("event", "e1");

    render(<NewCollectionPage />);
    expect(
      screen.getByText("The collection opens with this event on it."),
    ).toBeInTheDocument();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    await waitFor(() => expect(createCollection).toHaveBeenCalled());
    // One act: the collection is opened and the event is put on it, then the
    // reader lands back on the event they were shelving.
    expect(addEventToCollection).toHaveBeenCalledWith("c9", "e1");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e1"));
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
