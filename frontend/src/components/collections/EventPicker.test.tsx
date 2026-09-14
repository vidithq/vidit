import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchPickableEvents = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  searchPickableEvents: (username: string, q: string) =>
    searchPickableEvents(username, q),
}));

const useCursorList = vi.fn();
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: (buildPath: (cursor: string | null) => string) =>
    useCursorList(buildPath),
}));

import type { PickableEvent } from "@/lib/collections";

import { EventPicker } from "./EventPicker";

/** The picker's own debounce, the beat it waits before a typed query goes
 *  out. */
const DEBOUNCE_MS = 300;

const row = (
  over: Partial<PickableEvent> & Pick<PickableEvent, "id">,
): PickableEvent => ({
  title: "Strike on the rail junction",
  status: "geolocated",
  media: null,
  is_graphic: false,
  event_date: "2026-03-14",
  event_coords: { lat: 49.71, lng: 37.616 },
  tags: [],
  ...over,
});

/** The browse walk's state, as `useCursorList` hands it over. */
function mockBrowse(items: PickableEvent[], over: Record<string, unknown> = {}) {
  useCursorList.mockReturnValue({
    items,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
    ...over,
  });
}

/** The add block's control on one row. */
function addRow(title: string): HTMLElement {
  return screen.getByRole("button", { name: `Add ${title} to this collection` });
}

/** The first block's control on one row. */
function removeRow(title: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Remove ${title} from this collection`,
  });
}

/** Five rows, which is exactly the cap, plus a sixth the block has to drop. */
const sixRows = [
  row({ id: "e1", title: "One" }),
  row({ id: "e2", title: "Two" }),
  row({ id: "e3", title: "Three" }),
  row({ id: "e4", title: "Four" }),
  row({ id: "e5", title: "Five" }),
  row({ id: "e6", title: "Six" }),
];

beforeEach(() => {
  vi.useFakeTimers();
  searchPickableEvents.mockReset();
  useCursorList.mockReset();
  searchPickableEvents.mockResolvedValue({ items: [], total: 0 });
  mockBrowse([row({ id: "e1" })]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EventPicker, the events the collection holds", () => {
  it("opens on what it was handed, earliest event first", () => {
    render(
      <EventPicker
        username="ana"
        events={[
          row({ id: "e9", title: "Later strike", event_date: "2026-03-16" }),
          row({ id: "e8", title: "Earlier strike", event_date: "2026-03-14" }),
        ]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("2 events, ordered by event date, earliest first.")).toBeInTheDocument();
    // The order the collection's own page reads its items in, so the pending
    // list and the collection it becomes read alike.
    const held = screen.getAllByRole("button", { name: /^Remove/ });
    expect(held.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Remove Earlier strike from this collection",
      "Remove Later strike from this collection",
    ]);
  });

  it("hands the row's id back on the red cross", () => {
    const onRemove = vi.fn();

    render(
      <EventPicker
        username="ana"
        events={[row({ id: "e9", title: "Later strike" })]}
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(removeRow("Later strike"));

    expect(onRemove).toHaveBeenCalledWith("e9");
  });

  it("points an empty collection at the block below", () => {
    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Nothing on this collection yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add your own geolocations from the search below."),
    ).toBeInTheDocument();
  });
});

describe("EventPicker, the add block", () => {
  it("shows the analyst's most recent with nothing typed", () => {
    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    // The rows come off the browse walk, and nothing is asked of the endpoint
    // that reads words until something is typed. What that walk asks for is
    // `pickerBrowsePath`'s own spec, in `lib/collections.test.ts`.
    expect(addRow("Strike on the rail junction")).toBeInTheDocument();
    expect(searchPickableEvents).not.toHaveBeenCalled();
  });

  it("hands the whole row back on Add", () => {
    const onAdd = vi.fn();
    const only = row({ id: "e1" });
    mockBrowse([only]);

    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={onAdd}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(addRow("Strike on the rail junction"));

    // The row itself, not its id: the block above renders the catalogue card
    // for what the collection holds, and nothing else on the page has it.
    expect(onAdd).toHaveBeenCalledWith(only);
  });

  it("moves an added row up, and says so where it stood", () => {
    const added = row({ id: "e1" });
    mockBrowse([added]);

    const { rerender } = render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    rerender(
      <EventPicker
        username="ana"
        events={[added]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    // On the first block now, with the cross that takes it off again.
    expect(removeRow("Strike on the rail junction")).toBeInTheDocument();
    // And still in the results, saying why it cannot be added twice rather
    // than dropping out of an answer the analyst searched for.
    const control = screen.getByRole("button", {
      name: "Already in this collection",
    });
    expect(control).toBeDisabled();
  });

  it("shows five rows at most, and says how to reach the rest", () => {
    mockBrowse(sixRows, { hasMore: true });

    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /to this collection$/ })).toHaveLength(5);
    expect(screen.queryByText("Six")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Showing your most recent. Search to reach the rest of your catalogue.",
      ),
    ).toBeInTheDocument();
  });

  it("sends what was typed to search, once the field settles", async () => {
    searchPickableEvents.mockResolvedValue({
      items: [row({ id: "e2", title: "Kakhovka dam" })],
      total: 1,
    });

    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Kakhovka" },
    });

    // Debounced: the words go out once the typing stops, not per keystroke.
    expect(searchPickableEvents).not.toHaveBeenCalled();
    // `act` awaited, so the timer fires and the answer it starts lands
    // before the assertions below.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(searchPickableEvents).toHaveBeenCalledWith("ana", "Kakhovka");
    expect(addRow("Kakhovka dam")).toBeInTheDocument();
    // The rows are the answer to the query, so the browsed row is not under
    // them.
    expect(
      screen.queryByText("Strike on the rail junction"),
    ).not.toBeInTheDocument();
  });

  it("says what a capped search left out", async () => {
    searchPickableEvents.mockResolvedValue({
      items: sixRows.slice(0, 5),
      total: 62,
    });

    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Kakhovka" },
    });
    // `act` awaited, so the timer fires and the answer it starts lands
    // before the assertions below.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    // The search endpoint hands out no cursor, so the block states the figure
    // rather than offering a walk it cannot take.
    expect(
      screen.getByText(
        "Showing 5 of 62 matches. Refine the search to reach the rest.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the collection's own rows through a search that lists none of them", async () => {
    render(
      <EventPicker
        username="ana"
        events={[row({ id: "e9", title: "Later strike" })]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Kakhovka" },
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(removeRow("Later strike")).toBeInTheDocument();
    expect(screen.getByText("1 event, ordered by event date, earliest first.")).toBeInTheDocument();
  });

  it("says so when the analyst has nothing a collection may hold", () => {
    mockBrowse([]);

    render(
      <EventPicker
        username="ana"
        events={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No geolocations to put on a collection yet."),
    ).toBeInTheDocument();
  });
});
