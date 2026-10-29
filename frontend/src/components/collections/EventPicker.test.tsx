import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchPickableEvents = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

const apiFetchPage = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetchPage: (path: string) => apiFetchPage(path),
}));

import type { PickableEvent } from "@/lib/collections";

import { SEARCH_DEBOUNCE_MS as DEBOUNCE_MS } from "@/components/ui/ItemSearch";

import { EventPicker } from "./EventPicker";

const row = (
  over: Partial<PickableEvent> & Pick<PickableEvent, "id">,
): PickableEvent => ({
  title: "Strike on the rail junction",
  status: "geolocated",
  media: null,
  is_graphic: false,
  occurred_date: "2026-03-14",
  coords: { lat: 49.71, lng: 37.616 },
  tags: [],
  ...over,
});

/** The first page of the analyst's events, and whether another stands behind it. */
function mockBrowse(items: PickableEvent[], { hasMore = false } = {}) {
  apiFetchPage.mockResolvedValue({ items, nextCursor: hasMore ? "next" : null });
}

/** The add block's field. */
const field = () => screen.getByRole("combobox", { name: "Add events" });

/** Focuses the empty field and lets the browse answer land. */
async function openList() {
  fireEvent.focus(field());
  await act(() => vi.advanceTimersByTimeAsync(0));
}

function renderPicker(props: Partial<ComponentProps<typeof EventPicker>> = {}) {
  return render(<EventPicker username="ana" events={[]} onAdd={vi.fn()} onRemove={vi.fn()} {...props} />);
}

/** Types into the add block's field and lets the debounced search answer land. */
async function searchFor(words: string) {
  fireEvent.change(field(), { target: { value: words } });
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE_MS);
  });
}

/** One row of the add block's open list, named by its title, date and status. */
function addRow(title: string): HTMLElement {
  return screen.getByRole("option", { name: new RegExp(`^${title}`) });
}

/** The first block's control on one row. */
function removeRow(title: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Remove ${title} from this collection`,
  });
}

/** A full page: the cap. */
const fiveRows = [
  row({ id: "e1", title: "One" }),
  row({ id: "e2", title: "Two" }),
  row({ id: "e3", title: "Three" }),
  row({ id: "e4", title: "Four" }),
  row({ id: "e5", title: "Five" }),
];

beforeEach(() => {
  vi.useFakeTimers();
  searchPickableEvents.mockReset();
  apiFetchPage.mockReset();
  searchPickableEvents.mockResolvedValue({ items: [], total: 0 });
  mockBrowse([row({ id: "e1" })]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EventPicker, the events the collection holds", () => {
  it("opens on what it was handed, earliest event first", () => {
    renderPicker({
      events: [
        row({ id: "e9", title: "Later strike", occurred_date: "2026-03-16" }),
        row({ id: "e8", title: "Earlier strike", occurred_date: "2026-03-14" }),
      ],
    });

    expect(screen.getByText("2 events, ordered by event date, earliest first.")).toBeInTheDocument();
    // Chronological, as the collection page reads its items.
    const held = screen.getAllByRole("button", { name: /^Remove/ });
    expect(held.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Remove Earlier strike from this collection",
      "Remove Later strike from this collection",
    ]);
  });

  it("orders two same-day rows the way the server will", () => {
    renderPicker({
      events: [
        row({ id: "e9", title: "Picked first", occurred_date: "2026-03-14" }),
        row({ id: "e2", title: "Picked second", occurred_date: "2026-03-14" }),
      ],
    });

    // The id is the server's last sort key, so a shared date matches the saved order.
    const held = screen.getAllByRole("button", { name: /^Remove/ });
    expect(held.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Remove Picked second from this collection",
      "Remove Picked first from this collection",
    ]);
  });

  it("hands the row's id back on Remove", () => {
    const onRemove = vi.fn();
    renderPicker({ events: [row({ id: "e9", title: "Later strike" })], onRemove });
    fireEvent.click(removeRow("Later strike"));

    expect(onRemove).toHaveBeenCalledWith("e9");
  });

  it("points an empty collection at the block above", () => {
    renderPicker();

    expect(screen.getByText("Nothing on this collection yet.")).toBeInTheDocument();
    expect(screen.getByText("Add your own geolocations from the search above.")).toBeInTheDocument();
  });
});

describe("EventPicker, the held list", () => {
  it("puts the add block first, then lists the held events as compact rows that open the event", () => {
    renderPicker({
      events: [row({ id: "e9", title: "Later strike", occurred_date: "2026-03-16" })],
    });

    const add = screen.getByRole("heading", { name: "Add events" });
    const held = screen.getByRole("heading", { name: "Events in this collection" });
    expect(add.compareDocumentPosition(held)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const list = screen.getByRole("list", { name: "Events in this collection" });
    const [item] = within(list).getAllByRole("listitem");
    expect(within(item).getByRole("link", { name: "Later strike" })).toHaveAttribute(
      "href",
      "/events/e9",
    );
    expect(
      within(item).getByRole("button", { name: "Remove Later strike from this collection" }),
    ).toBeInTheDocument();
  });

  it("scrolls a picked row into view where the date order puts it", async () => {
    const picked = row({ id: "e1", title: "Picked strike" });
    mockBrowse([picked]);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onAdd = vi.fn();
    const { rerender } = renderPicker({ onAdd });
    await openList();
    fireEvent.click(addRow("Picked strike"));
    expect(onAdd).toHaveBeenCalledWith(picked);

    rerender(<EventPicker username="ana" events={[picked]} onAdd={onAdd} onRemove={vi.fn()} />);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("lists a match's loaded rows with the picks, and pages it with Show more", () => {
    const loadMore = vi.fn();
    const onMatchRemove = vi.fn();
    renderPicker({
      matched: {
        rows: [row({ id: "m1", title: "Dam breach" })],
        total: 30,
        walk: { hasMore: true, loadingMore: false, loadMore, error: null, loading: false },
        onRemove: onMatchRemove,
      },
    });

    expect(screen.getByText("30 events, ordered by event date, earliest first.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(loadMore).toHaveBeenCalledOnce();
    fireEvent.click(removeRow("Dam breach"));
    expect(onMatchRemove).toHaveBeenCalledWith("m1");
  });
});

describe("EventPicker, the add block", () => {
  it("lists the analyst's most recent on focus, with nothing typed", async () => {
    renderPicker();
    expect(screen.queryByRole("listbox")).toBeNull();
    await openList();

    // Rows come off the browse walk; `/search` is asked nothing until something is
    // typed (the walk's spec is `pickerBrowsePath`'s, in `lib/collections.test.ts`).
    expect(addRow("Strike on the rail junction")).toBeInTheDocument();
    expect(searchPickableEvents).not.toHaveBeenCalled();
  });

  it("hands the whole row back on a pick, and keeps the list open", async () => {
    const onAdd = vi.fn();
    const only = row({ id: "e1" });
    mockBrowse([only, row({ id: "e2", title: "Second strike" })]);

    renderPicker({ onAdd });
    await openList();
    fireEvent.click(addRow("Strike on the rail junction"));

    // The row itself: the first block also renders the catalogue card for held rows.
    expect(onAdd).toHaveBeenCalledWith(only);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("moves an added row up, out of the list", async () => {
    const added = row({ id: "e1" });
    mockBrowse([added, row({ id: "e2", title: "Second strike" })]);

    const { rerender } = renderPicker();
    rerender(<EventPicker username="ana" events={[added]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    await openList();

    expect(removeRow("Strike on the rail junction")).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /^Strike on the rail junction/ }),
    ).toBeNull();
    expect(addRow("Second strike")).toBeInTheDocument();
  });

  it.each([
    {
      name: "every row on show is already held",
      held: [row({ id: "e1" })],
      browse: [row({ id: "e1" })],
      hasMore: false,
      note: "Every event on show is already in this collection.",
    },
    {
      name: "the first page is not the whole catalogue",
      held: [],
      browse: fiveRows,
      hasMore: true,
      note: "Showing your most recent. Search to reach the rest of your catalogue.",
    },
    {
      name: "the analyst has nothing a collection may hold",
      held: [],
      browse: [],
      hasMore: false,
      note: /^No geolocations to put on a collection yet\./,
    },
  ])("says so when $name", async ({ held, browse, hasMore, note }) => {
    mockBrowse(browse, { hasMore });

    renderPicker({ events: held });
    await openList();

    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("sends what was typed to search, once the field settles", async () => {
    searchPickableEvents.mockResolvedValue({
      items: [row({ id: "e2", title: "Kakhovka dam" })],
      total: 1,
    });

    renderPicker();
    fireEvent.change(field(), { target: { value: "Kakhovka" } });

    // Debounced: the words go out once typing stops.
    expect(searchPickableEvents).not.toHaveBeenCalled();
    await searchFor("Kakhovka");

    expect(searchPickableEvents).toHaveBeenCalledWith("ana", "Kakhovka");
    expect(addRow("Kakhovka dam")).toBeInTheDocument();
    expect(screen.queryByText("Strike on the rail junction")).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "what a capped search left out",
      items: fiveRows,
      total: 62,
      note: /Showing 5 of 62 matches\. Refine the search/,
    },
    {
      name: "that a search reaches no event without coordinates",
      items: [row({ id: "e2", title: "Kakhovka dam" })],
      total: 1,
      note: "Search reaches your events that carry coordinates; clear the field to see the rest.",
    },
  ])("says $name", async ({ items, total, note }) => {
    searchPickableEvents.mockResolvedValue({ items, total });

    renderPicker();
    await searchFor("Kakhovka");

    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("takes the highlighted row on Enter instead of submitting the collection form", async () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    const onAdd = vi.fn();

    render(
      <form onSubmit={onSubmit}>
        <EventPicker username="ana" events={[]} onAdd={onAdd} onRemove={vi.fn()} />
      </form>,
    );
    await openList();
    const defaultPrevented = !fireEvent.keyDown(field(), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    // The picker sits inside the collection form: Enter in the field must not
    // write a collection the analyst is still choosing the events for.
    expect(defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("keeps the collection's own rows through a search that lists none of them", async () => {
    renderPicker({ events: [row({ id: "e9", title: "Later strike" })] });
    await searchFor("Kakhovka");

    expect(removeRow("Later strike")).toBeInTheDocument();
    expect(screen.getByText("1 event, ordered by event date, earliest first.")).toBeInTheDocument();
  });
});
