import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const addEventsToCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  addEventsToCollection: (c: string, t: unknown) => addEventsToCollection(c, t),
}));

import { ApiError } from "@/lib/api";
import type { Collection } from "@/lib/collections";

import { BulkAddToCollectionPanel } from "./BulkAddToCollectionPanel";

const shelf = (id: string, title: string, event_count: number): Collection => ({
  id,
  owner: { id: "u1", username: "ana", avatar_url: null },
  title,
  description: "<p>x</p>",
  description_text: "x",
  cover: [],
  tags: [],
  event_count,
  first_date: null,
  last_date: null,
  created_at: "2026-06-20T09:00:00Z",
});

const PAGE = {
  items: [shelf("c1", "Kupiansk rail corridor", 1), shelf("c2", "Dam breach", 0)],
  total: 2,
  page: 1,
  per_page: 100,
};

const add = (title: string) => screen.getByRole("button", { name: `Add to ${title}` });
const queryAdd = (title: string) => screen.queryByRole("button", { name: `Add to ${title}` });

beforeEach(() => {
  useApiResource.mockReset();
  addEventsToCollection.mockReset();
  useApiResource.mockReturnValue({ data: PAGE, error: null });
});

describe("BulkAddToCollectionPanel", () => {
  it("lists the owner's collections, empty ones included, each with an Add action", () => {
    render(<BulkAddToCollectionPanel username="ana" target={{ eventIds: ["e1"] }} />);

    expect(useApiResource).toHaveBeenCalledWith("/users/ana/collections?per_page=100");
    expect(add("Kupiansk rail corridor")).toBeEnabled();
    expect(add("Dam breach")).toBeEnabled();
    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // A row acts through its button alone: the only link is New collection.
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["New collection"]);
    expect(screen.getByRole("link", { name: "New collection" })).toHaveAttribute(
      "href",
      "/collections/new",
    );
  });

  it("adds the selection on Add, then marks the row Added and says what the write did", async () => {
    addEventsToCollection.mockResolvedValue({
      added: 44,
      skipped: { already_in_collection: 3, not_collectable: 0 },
    });
    const target = { match: { q: "kakhovka", tags: ["dam"] } };

    render(<BulkAddToCollectionPanel username="ana" target={target} />);
    fireEvent.click(add("Kupiansk rail corridor"));

    expect(
      await screen.findByText(/44 added, 3 already in this collection\./),
    ).toBeInTheDocument();
    expect(addEventsToCollection).toHaveBeenCalledWith("c1", target);
    expect(screen.getByRole("link", { name: "Open the collection" })).toHaveAttribute(
      "href",
      "/collections/c1",
    );
    // The action gives way to a static state: nothing left to click on that row.
    expect(queryAdd("Kupiansk rail corridor")).not.toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("45 events")).toBeInTheDocument();
    expect(add("Dam breach")).toBeEnabled();
  });

  it("keeps the Add action after a refusal and shows why", async () => {
    addEventsToCollection.mockRejectedValue(
      new ApiError("Add at most 500 events at once; narrow the selection", 422, "too_many_events"),
    );
    render(<BulkAddToCollectionPanel username="ana" target={{ eventIds: ["e1"] }} />);

    fireEvent.click(add("Dam breach"));

    expect(
      await screen.findByText("Add at most 500 events at once; narrow the selection"),
    ).toBeInTheDocument();
    expect(add("Dam breach")).toBeEnabled();
    expect(screen.queryByText("Added")).not.toBeInTheDocument();
  });
});
