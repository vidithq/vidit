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
import {
  readSelectionHandoff,
  type Collection,
  type PickableEvent,
} from "@/lib/collections";

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
  hidden_at: null,
});

const page = (items: Collection[]) => ({ items, total: items.length, page: 1, per_page: 100 });

const PAGE = page([shelf("c1", "Kupiansk rail corridor", 1), shelf("c2", "Dam breach", 0)]);

const row = (title: string) => screen.getByRole("button", { name: `Add to ${title}` });
/** The item that names a collection, its count and its action. */
const itemOf = (title: string) => screen.getByText(title).parentElement!.parentElement!;
const ids = { eventIds: ["e1", "e2"] };
const pickable = (id: string, title: string): PickableEvent => ({
  id,
  title,
  status: "geolocated",
  media: null,
  is_graphic: false,
  occurred_date: "2026-06-06",
  coords: { lat: 46.77, lng: 33.37 },
  tags: [],
});
const ROWS = [pickable("e1", "Kakhovka spillway"), pickable("e2", "Nova Kakhovka quay")];

beforeEach(() => {
  push.mockReset();
  useApiResource.mockReset();
  addEventsToCollection.mockReset();
  window.sessionStorage.clear();
  useApiResource.mockReturnValue({ data: PAGE, error: null });
});

describe("BulkAddToCollectionPanel", () => {
  it("lists the owner's collections as rows that add, under no heading of its own", () => {
    render(<BulkAddToCollectionPanel username="ana" target={ids} rows={ROWS} count={2} />);

    // The search page's head row already says how many are selected.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(useApiResource).toHaveBeenCalledWith("/users/ana/collections?per_page=100");
    expect(itemOf("Kupiansk rail corridor")).toHaveTextContent("1 event");
    expect(itemOf("Kupiansk rail corridor")).toContainElement(row("Kupiansk rail corridor"));
    expect(row("Dam breach")).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // Two collections need no finder.
    expect(screen.queryByRole("combobox", { name: "Find a collection" })).not.toBeInTheDocument();
  });

  it("finds a collection by title", () => {
    const titles = ["Avdiivka", "Bakhmut", "Chasiv Yar", "Dam breach", "Kupiansk", "Pokrovsk"];
    useApiResource.mockReturnValue({
      data: page(titles.map((t, i) => shelf(`c${i}`, t, i))),
      error: null,
    });
    render(<BulkAddToCollectionPanel username="ana" target={ids} rows={ROWS} count={2} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Find a collection" }), {
      target: { value: "  ba" },
    });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Bakhmut/),
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Find a collection" }), {
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

    render(<BulkAddToCollectionPanel username="ana" target={target} rows={[]} count={47} />);
    fireEvent.click(row("Kupiansk rail corridor"));

    expect(
      await screen.findByText(/44 added, 3 already in this collection\./),
    ).toBeInTheDocument();
    expect(addEventsToCollection).toHaveBeenCalledWith("c1", target);
    expect(screen.getByRole("link", { name: "Open the collection" })).toHaveAttribute(
      "href",
      "/collections/c1",
    );
    const done = itemOf("Kupiansk rail corridor");
    expect(done).toHaveTextContent("Added 44");
    expect(done).toHaveTextContent("45 events");
    expect(screen.queryByRole("button", { name: "Add to Kupiansk rail corridor" })).toBeNull();
    expect(row("Dam breach")).toBeEnabled();
  });

  it("keeps the row actionable after a refusal and shows why", async () => {
    addEventsToCollection.mockRejectedValue(
      new ApiError("Add at most 500 events at once; narrow the selection", 422, "too_many_events"),
    );
    render(<BulkAddToCollectionPanel username="ana" target={ids} rows={ROWS} count={2} />);

    fireEvent.click(row("Dam breach"));

    expect(
      await screen.findByText("Add at most 500 events at once; narrow the selection"),
    ).toBeInTheDocument();
    expect(row("Dam breach")).toBeEnabled();
    expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
  });

  it("opens the create page carrying the selection and its rows through a session handoff", () => {
    render(<BulkAddToCollectionPanel username="ana" target={ids} rows={ROWS} count={2} />);

    fireEvent.click(screen.getByRole("button", { name: "New collection" }));

    const href = push.mock.calls[0][0] as string;
    expect(href).toMatch(/^\/collections\/new\?selection=/);
    const token = new URL(href, "http://localhost").searchParams.get("selection") as string;
    // The checked rows travel with it, so the create page reads no event.
    expect(readSelectionHandoff(token)).toMatchObject({ target: ids, rows: ROWS, count: 2 });
  });
});
