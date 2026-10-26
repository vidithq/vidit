import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

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
import { readSelectionHandoff, type Collection } from "@/lib/collections";

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

const page = (items: Collection[]) => ({ items, total: items.length, page: 1, per_page: 100 });

const PAGE = page([shelf("c1", "Kupiansk rail corridor", 1), shelf("c2", "Dam breach", 0)]);

const row = (title: string) => screen.getByRole("button", { name: `Add to ${title}` });
const ids = { eventIds: ["e1", "e2"] };

beforeEach(() => {
  push.mockReset();
  useApiResource.mockReset();
  addEventsToCollection.mockReset();
  window.sessionStorage.clear();
  useApiResource.mockReturnValue({ data: PAGE, error: null });
});

describe("BulkAddToCollectionPanel", () => {
  it("heads the list with what it adds, and lists the owner's collections as rows that add", () => {
    render(<BulkAddToCollectionPanel username="ana" target={ids} count={2} />);

    expect(screen.getByRole("heading", { name: "Add 2 geolocations" })).toBeInTheDocument();
    expect(useApiResource).toHaveBeenCalledWith("/users/ana/collections?per_page=100");
    expect(row("Kupiansk rail corridor")).toHaveTextContent("1 event");
    expect(row("Dam breach")).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // Two collections need no finder.
    expect(screen.queryByRole("searchbox", { name: "Find a collection" })).not.toBeInTheDocument();
  });

  it("narrows a long list by title", () => {
    const titles = ["Avdiivka", "Bakhmut", "Chasiv Yar", "Dam breach", "Kupiansk", "Pokrovsk"];
    useApiResource.mockReturnValue({
      data: page(titles.map((t, i) => shelf(`c${i}`, t, i))),
      error: null,
    });
    render(<BulkAddToCollectionPanel username="ana" target={ids} count={2} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a collection" }), {
      target: { value: "  ba" },
    });

    expect(row("Bakhmut")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Add to / })).toHaveLength(1);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a collection" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No collection matches.")).toBeInTheDocument();
  });

  it("adds on a row, then marks it Added N, moves its count and says what the write did", async () => {
    addEventsToCollection.mockResolvedValue({
      added: 44,
      skipped: { already_in_collection: 3, not_collectable: 0 },
    });
    const target = { match: { q: "kakhovka", tags: ["dam"] } };

    render(<BulkAddToCollectionPanel username="ana" target={target} count={47} />);
    fireEvent.click(row("Kupiansk rail corridor"));

    expect(
      await screen.findByText(/44 added, 3 already in this collection\./),
    ).toBeInTheDocument();
    expect(addEventsToCollection).toHaveBeenCalledWith("c1", target);
    expect(screen.getByRole("link", { name: "Open the collection" })).toHaveAttribute(
      "href",
      "/collections/c1",
    );
    const done = screen.getByRole("button", { name: /Kupiansk rail corridor/ });
    expect(done).toHaveTextContent("Added 44");
    expect(done).toHaveTextContent("45 events");
    expect(done).toBeDisabled();
    expect(row("Dam breach")).toBeEnabled();
  });

  it("keeps the row actionable after a refusal and shows why", async () => {
    addEventsToCollection.mockRejectedValue(
      new ApiError("Add at most 500 events at once; narrow the selection", 422, "too_many_events"),
    );
    render(<BulkAddToCollectionPanel username="ana" target={ids} count={2} />);

    fireEvent.click(row("Dam breach"));

    expect(
      await screen.findByText("Add at most 500 events at once; narrow the selection"),
    ).toBeInTheDocument();
    expect(row("Dam breach")).toBeEnabled();
    expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
  });

  it("opens the create page carrying the selection through a session handoff", () => {
    render(<BulkAddToCollectionPanel username="ana" target={ids} count={2} />);

    fireEvent.click(screen.getByRole("button", { name: "New collection with these 2" }));

    const href = push.mock.calls[0][0] as string;
    expect(href).toMatch(/^\/collections\/new\?selection=/);
    const token = new URL(href, "http://localhost").searchParams.get("selection") as string;
    expect(readSelectionHandoff(token)).toMatchObject({ target: ids, count: 2 });
  });
});
