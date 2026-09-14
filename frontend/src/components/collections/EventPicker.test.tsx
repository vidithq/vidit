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

const row = (over: Partial<PickableEvent> & Pick<PickableEvent, "id">): PickableEvent => ({
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

/** The row's stretched control, which is what ticks it. */
function pickRow(title: string): HTMLElement {
  return screen.getByRole("button", { name: `Put ${title} on this collection` });
}

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

describe("EventPicker", () => {
  it("browses the analyst's own catalogue with nothing typed", () => {
    render(
      <EventPicker
        username="ana"
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );

    // The cursor-paged list endpoint, scoped to the owner and to the two
    // statuses a collection may hold.
    const buildPath = useCursorList.mock.calls[0][0] as (
      cursor: string | null,
    ) => string;
    expect(buildPath(null)).toBe(
      "/events?view=located&status=geolocated&status=detected&author=ana",
    );
    expect(screen.getByText("Strike on the rail junction")).toBeInTheDocument();
    expect(searchPickableEvents).not.toHaveBeenCalled();
  });

  it("sends what was typed to search, once the field settles", async () => {
    searchPickableEvents.mockResolvedValue({
      items: [row({ id: "e2", title: "Kakhovka dam" })],
      total: 1,
    });

    render(
      <EventPicker
        username="ana"
        selectedIds={new Set()}
        onToggle={vi.fn()}
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
    expect(screen.getByText("Kakhovka dam")).toBeInTheDocument();
    // The list is the answer to the query, so the browsed row is not under it.
    expect(
      screen.queryByText("Strike on the rail junction"),
    ).not.toBeInTheDocument();
  });

  it("hands the row's id back on a click, and marks a ticked row", () => {
    const onToggle = vi.fn();

    const { rerender } = render(
      <EventPicker username="ana" selectedIds={new Set()} onToggle={onToggle} />,
    );
    fireEvent.click(pickRow("Strike on the rail junction"));

    expect(onToggle).toHaveBeenCalledWith("e1");

    // Ticked, the same row offers the act that undoes it.
    rerender(
      <EventPicker
        username="ana"
        selectedIds={new Set(["e1"])}
        onToggle={onToggle}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Take Strike on the rail junction off this collection",
      }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("counts what stands, whatever the list below is showing", async () => {
    render(
      <EventPicker
        username="ana"
        selectedIds={new Set(["e1", "e7"])}
        onToggle={vi.fn()}
      />,
    );

    // Two ticked, one of them a row no list here shows: the count is the
    // selection's, not the page's.
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Kakhovka" },
    });
    // `act` awaited, so the timer fires and the answer it starts lands
    // before the assertions below.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("walks the catalogue a page at a time while browsing", () => {
    const loadMore = vi.fn();
    mockBrowse([row({ id: "e1" })], { hasMore: true, loadMore });

    render(
      <EventPicker
        username="ana"
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(loadMore).toHaveBeenCalled();
  });

  it("says what a capped search left out", async () => {
    searchPickableEvents.mockResolvedValue({
      items: [row({ id: "e2", title: "Kakhovka dam" })],
      total: 62,
    });

    render(
      <EventPicker
        username="ana"
        selectedIds={new Set()}
        onToggle={vi.fn()}
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
      screen.getByText(/Showing the first 50 of 62 matches/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });

  it("says so when the analyst has nothing a collection may hold", () => {
    mockBrowse([]);

    render(
      <EventPicker
        username="ana"
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No geolocations to put on a collection yet."),
    ).toBeInTheDocument();
  });
});
