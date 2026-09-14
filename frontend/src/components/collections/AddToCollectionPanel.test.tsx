import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const addEventToCollection = vi.fn();
const removeEventFromCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  addEventToCollection: (c: string, e: string) => addEventToCollection(c, e),
  removeEventFromCollection: (c: string, e: string) =>
    removeEventFromCollection(c, e),
}));

import type { CollectionMemberships } from "@/lib/collections";

import { AddToCollectionPanel } from "./AddToCollectionPanel";

const MEMBERSHIPS: CollectionMemberships = {
  items: [
    {
      id: "c1",
      title: "Kupiansk rail corridor",
      event_count: 1,
      in_collection: false,
    },
    {
      id: "c2",
      title: "Zaporizhzhia plant perimeter",
      event_count: 12,
      in_collection: true,
    },
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

  it("gives each row the reading-size shape, with what the collection holds", () => {
    render(<AddToCollectionPanel eventId="e1" />);

    // A described `<ToggleRow>` is the label at reading size over its line,
    // which is the shape an analyst's own title needs; the count is that line.
    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(screen.getByText("12 events")).toBeInTheDocument();
    // The accessible name stays the title alone, never the count under it.
    expect(row("Kupiansk rail corridor")).toBeInTheDocument();
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

  it("counts the event onto the collection as the row flips", async () => {
    addEventToCollection.mockResolvedValue(undefined);

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Kupiansk rail corridor"));

    // The line says what the collection holds, so it moves with the bit.
    expect(screen.getByText("2 events")).toBeInTheDocument();
    await waitFor(() =>
      expect(addEventToCollection).toHaveBeenCalledWith("c1", "e1"),
    );
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });

  it("counts the event off a collection it leaves", async () => {
    removeEventFromCollection.mockResolvedValue(undefined);

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Zaporizhzhia plant perimeter"));

    await waitFor(() =>
      expect(removeEventFromCollection).toHaveBeenCalledWith("c2", "e1"),
    );
    expect(screen.getByText("11 events")).toBeInTheDocument();
  });

  it("rolls the count back with the bit", async () => {
    addEventToCollection.mockRejectedValue(new Error("Nope."));

    render(<AddToCollectionPanel eventId="e1" />);
    fireEvent.click(row("Kupiansk rail corridor"));

    await waitFor(() => expect(screen.getByText("Nope.")).toBeInTheDocument());
    // Both halves of the optimistic flip are undone, not just the switch.
    expect(row("Kupiansk rail corridor")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText("1 event")).toBeInTheDocument();
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

  it("sends a new collection to the create page, carrying this event", () => {
    render(<AddToCollectionPanel eventId="e1" />);

    // The page opens the collection with this event on it and comes back, so
    // the panel writes no form of its own over the event being read.
    expect(
      screen.getByRole("link", { name: "New collection" }),
    ).toHaveAttribute("href", "/collections/new?event=e1");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("offers to open the first one when the analyst holds none", () => {
    useApiResource.mockReturnValue({ data: { items: [] }, error: null });

    render(<AddToCollectionPanel eventId="e1" />);

    expect(screen.getByText("No collections yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "New collection" }),
    ).toHaveAttribute("href", "/collections/new?event=e1");
  });

  it("says so when the read itself fails", () => {
    useApiResource.mockReturnValue({ data: null, error: "Request failed" });

    render(<AddToCollectionPanel eventId="e1" />);

    expect(screen.getByText("Request failed")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
