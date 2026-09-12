import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const addEventToCollection = vi.fn();
const removeEventFromCollection = vi.fn();
const createCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  addEventToCollection: (c: string, e: string) => addEventToCollection(c, e),
  removeEventFromCollection: (c: string, e: string) =>
    removeEventFromCollection(c, e),
  createCollection: (title: string) => createCollection(title),
}));

import type { CollectionMemberships } from "@/lib/collections";

import { AddToCollectionPanel } from "./AddToCollectionPanel";

const MEMBERSHIPS: CollectionMemberships = {
  items: [
    { id: "c1", title: "Kupiansk rail corridor", in_collection: false },
    { id: "c2", title: "Zaporizhzhia plant perimeter", in_collection: true },
  ],
};

/** The row for one collection, which carries the switch and its state. */
function row(title: string): HTMLElement {
  return screen.getByRole("switch", { name: title });
}

beforeEach(() => {
  useApiResource.mockReset();
  addEventToCollection.mockReset();
  removeEventFromCollection.mockReset();
  createCollection.mockReset();
  useApiResource.mockReturnValue({ data: MEMBERSHIPS, error: null });
});

describe("AddToCollectionPanel", () => {
  it("reads the owner's collections with this event's state on each", () => {
    render(<AddToCollectionPanel eventId="e1" />);

    expect(useApiResource).toHaveBeenCalledWith("/events/e1/collections");
    expect(row("Kupiansk rail corridor")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(row("Zaporizhzhia plant perimeter")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("flips the row on the click and writes behind it", async () => {
    addEventToCollection.mockResolvedValue(undefined);

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Kupiansk rail corridor"));

    // Optimistic: the row is on before the write has answered.
    expect(row("Kupiansk rail corridor")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await waitFor(() =>
      expect(addEventToCollection).toHaveBeenCalledWith("c1", "e1"),
    );
    expect(row("Kupiansk rail corridor")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("takes the event off a collection it is already on", async () => {
    removeEventFromCollection.mockResolvedValue(undefined);

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Zaporizhzhia plant perimeter"));

    await waitFor(() =>
      expect(removeEventFromCollection).toHaveBeenCalledWith("c2", "e1"),
    );
    expect(row("Zaporizhzhia plant perimeter")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("puts the bit back and says why when the write is refused", async () => {
    addEventToCollection.mockRejectedValue(
      new Error("This geolocation cannot be shelved."),
    );

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Kupiansk rail corridor"));

    await waitFor(() =>
      expect(
        screen.getByText("This geolocation cannot be shelved."),
      ).toBeInTheDocument(),
    );
    // Rolled back to what the server still holds.
    expect(row("Kupiansk rail corridor")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("rolls a removal back to on when it is refused", async () => {
    removeEventFromCollection.mockRejectedValue(new Error("Nope."));

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Zaporizhzhia plant perimeter"));

    await waitFor(() => expect(screen.getByText("Nope.")).toBeInTheDocument());
    expect(row("Zaporizhzhia plant perimeter")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("opens a collection and puts the event on it in one act", async () => {
    createCollection.mockResolvedValue({
      id: "c9",
      owner: { id: "u1", username: "ana", avatar_url: null },
      title: "March strikes",
      cover_url: null,
      event_count: 1,
      first_date: null,
      last_date: null,
      created_at: "2026-03-21T09:00:00Z",
    });
    addEventToCollection.mockResolvedValue(undefined);

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "March strikes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith("March strikes"),
    );
    expect(addEventToCollection).toHaveBeenCalledWith("c9", "e1");
    // The new row is appended already on, since it holds this event alone.
    await waitFor(() =>
      expect(row("March strikes")).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("offers to open the first one when the analyst holds none", () => {
    useApiResource.mockReturnValue({ data: { items: [] }, error: null });

    render(<AddToCollectionPanel eventId="e1" />);

    expect(screen.getByText("No collections yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New collection" }),
    ).toBeInTheDocument();
  });

  it("says so when the read itself fails", () => {
    useApiResource.mockReturnValue({ data: null, error: "Request failed" });

    render(<AddToCollectionPanel eventId="e1" />);

    expect(screen.getByText("Request failed")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
