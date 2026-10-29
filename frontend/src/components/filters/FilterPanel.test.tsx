import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Conflict, Tag } from "@/types";

const suggest = vi.hoisted(() => ({
  authors: vi.fn(async () => [{ kind: "analyst" as const, username: "ana" }]),
}));
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  suggestAuthors: suggest.authors,
}));

import {
  FilterCard,
  FilterPanel,
  FilterSheetBar,
  type FilterPanelProps,
  type FilterTally,
} from "./FilterPanel";
import { EMPTY_FILTERS, type FilterState, type Surface } from "./model";
import { SEARCH_DEBOUNCE_MS } from "@/hooks/useItemSearch";
import { openFilterGroups } from "@/test/filters";

const TAGS: Tag[] = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, name: `tag-${i}` }));
const CONFLICTS: Conflict[] = [
  {
    id: "c1",
    name: "Russian invasion of Ukraine",
    wikidata_id: null,
    start_year: 2022,
    end_year: null,
    is_ongoing: true,
    tier: "major",
  },
];
const DAYS = {
  eventDate: [
    { date: "2024-01-01", count: 2 },
    { date: "2024-03-01", count: 1 },
  ],
  added: [
    { date: "2024-02-01", count: 3 },
    { date: "2024-02-09", count: 1 },
  ],
};

/** The panel over live state, so a test reads what a change does to the panel. */
function Harness({
  surface,
  initial = EMPTY_FILTERS,
  shape = "panel",
  onChange,
  tally,
}: {
  surface: Surface;
  initial?: FilterState;
  shape?: "panel" | "card" | "sheet";
  onChange?: (state: FilterState) => void;
  tally?: FilterTally;
}) {
  const [state, setState] = useState(initial);
  const props: FilterPanelProps = {
    surface,
    state,
    onPatch: (patch) =>
      setState((s) => {
        const next = { ...s, ...patch };
        onChange?.(next);
        return next;
      }),
    onClear: () => setState(EMPTY_FILTERS),
    vocabulary: { tags: TAGS, conflicts: CONFLICTS },
    timelines: DAYS,
  };
  if (shape === "sheet") return <FilterSheetBar {...props} {...tally} />;
  return shape === "card" ? <FilterCard {...props} {...tally} /> : <FilterPanel {...props} />;
}

const group = (name: string) => screen.getByRole("button", { name });

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("<FilterPanel> groups", () => {
  it("starts with every group collapsed, What first, then When", () => {
    render(<Harness surface="feed" />);

    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "What",
      "When",
      "Source",
      "Where",
      "Who",
    ]);
    for (const name of ["What", "When", "Source", "Where", "Who"]) {
      expect(group(name)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByRole("combobox", { name: "Show" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /window start/ })).not.toBeInTheDocument();
  });

  it("opens a group from its heading and remembers it for the next panel", () => {
    const { unmount } = render(<Harness surface="feed" />);

    fireEvent.click(group("Source"));
    expect(group("Source")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Level" })).toBeInTheDocument();
    unmount();

    render(<Harness surface="search" />);
    expect(group("Source")).toHaveAttribute("aria-expanded", "true");
    expect(group("What")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a collapsed group's active filters on show as removable pills", () => {
    render(
      <Harness
        surface="search"
        initial={{ ...EMPTY_FILTERS, levels: ["direct"], eventFrom: "2024-01-01" }}
      />,
    );

    expect(screen.getByTitle("Remove filter Event date: From 1 Jan 2024")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Remove filter Level: Direct"));
    expect(screen.queryByTitle("Remove filter Level: Direct")).not.toBeInTheDocument();

    fireEvent.click(group("When"));
    expect(screen.queryByTitle(/Remove filter Event date/)).not.toBeInTheDocument();
  });
});

describe("<FilterPanel>", () => {
  beforeEach(openFilterGroups);

  it("draws one line per dimension under its heading, the timelines under When", () => {
    render(<Harness surface="feed" />);

    expect(screen.getAllByRole("slider", { name: /window start/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Play timeline" })).not.toBeInTheDocument();
    for (const name of ["Show", "Conflict", "Tags", "Source kind", "Level", "Media", "Author"]) {
      expect(screen.getByRole("combobox", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("switch", { name: "Following" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Approved only" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("leaves out what a surface's data cannot serve", () => {
    render(<Harness surface="map" />);

    expect(screen.queryByRole("combobox", { name: "Location guess" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Following" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where" })).not.toBeInTheDocument();
  });

  it("lists a short list whole on focus, and closes after a pick", () => {
    render(<Harness surface="search" />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Level" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Direct",
      "Indirect",
      "Context",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Direct" }));
    expect(screen.getByRole("button", { name: "Remove Direct" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("searches a long list in its line, and shows each pick as a pill under it", () => {
    const onChange = vi.fn();
    render(<Harness surface="search" onChange={onChange} />);

    const field = screen.getByRole("combobox", { name: "Tags" });
    fireEvent.change(field, { target: { value: "tag-1" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "tag-1",
      "tag-10",
      "tag-11",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "tag-11" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ["tag-11"] }));
    expect(field).toHaveValue("");
    fireEvent.focus(field);
    expect(screen.queryByRole("option", { name: "tag-11" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove tag-11" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tags: [] }));
    expect(screen.queryByRole("button", { name: "Remove tag-11" })).not.toBeInTheDocument();
  });

  it("removes a value from its pill under the line", () => {
    render(<Harness surface="map" initial={{ ...EMPTY_FILTERS, show: ["site"] }} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Sites" }));
    expect(screen.queryByRole("button", { name: "Remove Sites" })).not.toBeInTheDocument();
  });

  it("toggles a switch on its line", () => {
    const onChange = vi.fn();
    render(<Harness surface="feed" onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch", { name: "Approved only" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ approved: true }));
  });

  it("picks an author from the search in its line", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<Harness surface="feed" onChange={onChange} />);

    const field = screen.getByRole("combobox", { name: "Author" });
    fireEvent.change(field, { target: { value: "an" } });
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS));
    fireEvent.click(screen.getByRole("option", { name: /ana/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ author: "ana" }));
    expect(screen.getByRole("button", { name: "Remove ana" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Author" })).toHaveValue("");
  });

  it("offers Clear all once a filter is on, and it clears every filter", () => {
    render(
      <Harness
        surface="search"
        initial={{ ...EMPTY_FILTERS, levels: ["direct"], eventFrom: "2024-01-01" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.queryByRole("button", { name: "Remove Direct" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });
});

describe("<FilterCard>", () => {
  const header = () => screen.getByRole("button", { name: "Filters" });

  it("opens in a list's rail and starts closed on the map", () => {
    const { unmount } = render(<Harness surface="search" shape="card" />);
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "What" })).toBeInTheDocument();
    unmount();

    render(<Harness surface="map" shape="card" />);
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "What" })).not.toBeInTheDocument();
  });

  it("remembers the viewer's choice per surface", () => {
    const { unmount } = render(<Harness surface="feed" shape="card" />);
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");
    unmount();

    const again = render(<Harness surface="feed" shape="card" />);
    expect(header()).toHaveAttribute("aria-expanded", "false");
    again.unmount();
    render(<Harness surface="search" shape="card" />);
    expect(header()).toHaveAttribute("aria-expanded", "true");
  });

  it("names the result count beside the header, keeps the header's name, and marks a fetch", () => {
    const { rerender } = render(<Harness surface="feed" shape="card" />);
    expect(header()).not.toHaveAccessibleDescription();
    expect(screen.queryByText(/result/)).not.toBeInTheDocument();

    rerender(<Harness surface="feed" shape="card" tally={{ count: 1 }} />);
    expect(header()).toHaveAccessibleDescription("1 result");
    expect(header()).toHaveAttribute("aria-busy", "false");

    rerender(<Harness surface="feed" shape="card" tally={{ count: 0, loading: true }} />);
    expect(header()).toHaveAccessibleDescription("0 results");
    expect(header()).toHaveAttribute("aria-busy", "true");
  });

  it("shows the active filters once: under the header closed, in their groups open", () => {
    render(<Harness surface="map" shape="card" initial={{ ...EMPTY_FILTERS, levels: ["direct"] }} />);
    const pill = () => screen.queryAllByTitle("Remove filter Level: Direct");

    expect(pill()).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Source" })).not.toBeInTheDocument();

    fireEvent.click(header());
    expect(pill()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("<FilterSheetBar>", () => {
  beforeEach(openFilterGroups);

  it("shows the active filters as pills and opens the panel in a sheet", () => {
    render(<Harness surface="feed" shape="sheet" initial={{ ...EMPTY_FILTERS, following: true }} />);

    expect(screen.getByTitle("Remove filter Following")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("switch", { name: "Following" })).toBeChecked();

    fireEvent.click(within(sheet).getByRole("switch", { name: "Following" }));
    expect(screen.queryByTitle("Remove filter Following")).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("names the result count beside the Filters button", () => {
    render(<Harness surface="feed" shape="sheet" tally={{ count: 1284, loading: true }} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAccessibleDescription("1,284 results");
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
