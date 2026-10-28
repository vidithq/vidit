import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Conflict, Tag } from "@/types";

const suggest = vi.hoisted(() => ({
  authors: vi.fn(async () => [{ kind: "analyst" as const, username: "ana" }]),
}));
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  suggestAuthors: suggest.authors,
}));

import { FilterPanel, FilterSheetBar, type FilterPanelProps } from "./FilterPanel";
import { EMPTY_FILTERS, type FilterState, type Surface } from "./model";

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
  sheet = false,
  onChange,
}: {
  surface: Surface;
  initial?: FilterState;
  sheet?: boolean;
  onChange?: (state: FilterState) => void;
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
  return sheet ? <FilterSheetBar {...props} /> : <FilterPanel {...props} />;
}

const line = (name: string) => screen.getByRole("button", { name });
const editor = (name: string) => screen.getByRole("dialog", { name });

describe("<FilterPanel>", () => {
  it("leads with the two timelines, then one line per dimension under its heading", () => {
    render(<Harness surface="feed" />);

    expect(
      screen.getAllByRole("heading").map((h) => h.textContent),
    ).toEqual(["When", "What", "Source", "Where", "Who"]);
    expect(screen.getAllByRole("slider", { name: /window start/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Play timeline" })).not.toBeInTheDocument();
    for (const name of ["Show", "Conflict", "Tags", "Source kind", "Level", "Media"]) {
      expect(line(name)).toHaveAttribute("aria-haspopup", "dialog");
    }
    expect(screen.getByRole("switch", { name: "Following" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Approved only" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("leaves out what a surface's data cannot serve", () => {
    render(<Harness surface="map" />);

    expect(screen.queryByRole("button", { name: "Location guess" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Following" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where" })).not.toBeInTheDocument();
  });

  it("opens a line's editor in a popover and closes it on Escape, the line in place", () => {
    render(<Harness surface="search" />);

    fireEvent.click(line("Level"));
    expect(line("Level")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(editor("Level")).getByRole("button", { name: "Direct" }));
    expect(screen.getByRole("button", { name: "Remove Direct" })).toBeInTheDocument();

    fireEvent.keyDown(editor("Level"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Level" })).not.toBeInTheDocument();
    expect(line("Level")).toHaveFocus();
  });

  it("searches a long list, shows a short list with one Show more, and picks by name", () => {
    const onChange = vi.fn();
    render(<Harness surface="search" onChange={onChange} />);

    fireEvent.click(line("Tags"));
    const tags = editor("Tags");
    expect(within(tags).getAllByRole("button", { name: /^tag-/ })).toHaveLength(8);
    fireEvent.click(within(tags).getByRole("button", { name: "Show more" }));
    expect(within(tags).getAllByRole("button", { name: /^tag-/ })).toHaveLength(12);

    fireEvent.change(within(tags).getByRole("searchbox", { name: "Search tags" }), {
      target: { value: "tag-11" },
    });
    fireEvent.click(within(tags).getByRole("button", { name: "tag-11" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ["tag-11"] }));
    expect(within(tags).getByRole("searchbox", { name: "Search tags" })).toHaveFocus();
  });

  it("removes a value from its pill on the line, without opening the editor", () => {
    render(<Harness surface="map" initial={{ ...EMPTY_FILTERS, show: ["site"] }} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Sites" }));
    expect(screen.queryByRole("button", { name: "Remove Sites" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles a switch on its line, with no popover", () => {
    const onChange = vi.fn();
    render(<Harness surface="feed" onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch", { name: "Approved only" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ approved: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("picks an author from the account picker and closes the editor", async () => {
    const onChange = vi.fn();
    render(<Harness surface="feed" onChange={onChange} />);

    fireEvent.click(line("Author"));
    const field = within(editor("Author")).getByRole("combobox", { name: "Author" });
    fireEvent.change(field, { target: { value: "an" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    fireEvent.click(await screen.findByRole("option", { name: /ana/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ author: "ana" }));
    expect(screen.queryByRole("dialog", { name: "Author" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove ana" })).toBeInTheDocument();
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

describe("<FilterSheetBar>", () => {
  it("shows the active filters as pills and opens the panel in a sheet", () => {
    render(<Harness surface="feed" sheet initial={{ ...EMPTY_FILTERS, following: true }} />);

    expect(screen.getByTitle("Remove filter Following")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("switch", { name: "Following" })).toBeChecked();

    fireEvent.click(within(sheet).getByRole("switch", { name: "Following" }));
    expect(screen.queryByTitle("Remove filter Following")).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
  });
});
