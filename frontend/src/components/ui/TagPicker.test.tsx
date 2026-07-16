import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { TagPicker } from "./TagPicker";
import type { Conflict, Tag } from "@/types";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
}));

function conflict(overrides: Partial<Conflict> & Pick<Conflict, "id" | "name">): Conflict {
  return {
    wikidata_id: null,
    start_year: null,
    end_year: null,
    ongoing: true,
    tier: null,
    ...overrides,
  };
}

const CONFLICTS: Conflict[] = [
  conflict({
    id: "c1",
    name: "Russian invasion of Ukraine",
    start_year: 2022,
    tier: "major",
  }),
  conflict({ id: "c2", name: "Sudanese civil war", start_year: 2023, tier: "minor" }),
  conflict({
    id: "c3",
    name: "Falklands War",
    start_year: 1982,
    end_year: 1982,
    ongoing: false,
  }),
  conflict({
    id: "c4",
    name: "Gulf War",
    start_year: 1990,
    end_year: 1991,
    ongoing: false,
  }),
  conflict({ id: "c5", name: "Other" }),
];

const CURATED: Tag[] = [{ id: "cs1", name: "Drone", category: "capture_source" }];

// Stateful host so pill clicks round-trip through the selection state, the way
// the submit / edit forms wire it.
function Host({ conflicts = CONFLICTS }: { conflicts?: Conflict[] }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>([]);
  return (
    <TagPicker
      tags={tags}
      setTags={setTags}
      curatedTags={CURATED}
      selectedTagIds={selectedTagIds}
      setSelectedTagIds={setSelectedTagIds}
      conflicts={conflicts}
      selectedConflictIds={selectedConflictIds}
      setSelectedConflictIds={setSelectedConflictIds}
    />
  );
}

const searchInput = () => screen.getByLabelText("Search conflicts");
const endedSwitch = () =>
  screen.getByRole("switch", { name: /include ended conflicts/i });

describe("TagPicker conflict typeahead", () => {
  it("defaults to major ongoing conflicts plus Other pinned last", () => {
    render(<Host />);
    // Ongoing conflicts carry their years too, ending in "present".
    expect(
      screen.getByText("Russian invasion of Ukraine (2022-present)")
    ).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    // Minor-tier ongoing and ended conflicts stay behind the search.
    expect(screen.queryByText(/Sudanese civil war/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Falklands War/)).not.toBeInTheDocument();
    // Other is the last pill.
    const pills = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t === "Other" || t?.includes("(2022-present)"));
    expect(pills[pills.length - 1]).toBe("Other");
  });

  it("offers the Other escape in the default list even when not flagged ongoing", () => {
    const flippedOther = [
      conflict({ id: "c1", name: "Major war", tier: "major" }),
      conflict({ id: "c5", name: "Other", ongoing: false }),
    ];
    render(<Host conflicts={flippedOther} />);
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("suppresses the type-to-search hint when the default list is empty", () => {
    // No major ongoing conflict and no Other: the empty state renders alone,
    // never alongside the "type to search" hint.
    const noDefaults = [
      conflict({ id: "n1", name: "Minor ongoing war", tier: "minor" }),
    ];
    render(<Host conflicts={noDefaults} />);
    expect(screen.getByText(/No conflicts match/)).toBeInTheDocument();
    expect(screen.queryByText(/type to search/)).not.toBeInTheDocument();
  });

  it("counts the rest of the searchable set and reacts to the switch", () => {
    render(<Host />);
    // 3 ongoing total, 2 shown by default (the major + Other): 1 left.
    expect(
      screen.getByText("1 more ongoing conflict, type to search.")
    ).toBeInTheDocument();
    fireEvent.click(endedSwitch());
    // The default pills stay majors + Other; only the count widens.
    expect(
      screen.getByText("3 more conflicts, type to search.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Russian invasion of Ukraine (2022-present)")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Falklands War/)).not.toBeInTheDocument();
  });

  it("filters by case-insensitive substring", () => {
    render(<Host />);
    fireEvent.change(searchInput(), { target: { value: "sudan" } });
    expect(
      screen.getByText("Sudanese civil war (2023-present)")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Russian invasion of Ukraine/)
    ).not.toBeInTheDocument();
  });

  it("sorts search results by tier then name, Other always last", () => {
    const withTiers = [
      conflict({ id: "s1", name: "War B", tier: "conflict" }),
      conflict({ id: "s2", name: "War A", tier: "conflict" }),
      conflict({ id: "s3", name: "War C", tier: "major" }),
      conflict({ id: "s4", name: "War D", tier: "minor" }),
      conflict({ id: "s5", name: "Other" }),
    ];
    render(<Host conflicts={withTiers} />);
    fireEvent.change(searchInput(), { target: { value: "r" } });
    const names = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t === "Other" || t?.startsWith("War"));
    expect(names).toEqual(["War C", "War D", "War A", "War B", "Other"]);
  });

  it("keeps ended conflicts out of the search until the switch is on", () => {
    render(<Host />);
    fireEvent.change(searchInput(), { target: { value: "falklands" } });
    expect(screen.queryByText(/Falklands War/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/No conflicts match; try including ended conflicts\./)
    ).toBeInTheDocument();

    fireEvent.click(endedSwitch());
    // An ended conflict displays its years for disambiguation.
    expect(screen.getByText("Falklands War (1982)")).toBeInTheDocument();
  });

  it("renders a multi-year ended conflict with its range", () => {
    render(<Host />);
    fireEvent.click(endedSwitch());
    fireEvent.change(searchInput(), { target: { value: "gulf" } });
    expect(screen.getByText("Gulf War (1990-1991)")).toBeInTheDocument();
  });

  it("skips the year suffix when the start year is unknown or already in the name", () => {
    const guards = [
      conflict({ id: "g1", name: "Unrest in Nowhere", tier: "major" }),
      conflict({
        id: "g2",
        name: "Haitian crisis (2018–present)",
        start_year: 2018,
        tier: "major",
      }),
    ];
    render(<Host conflicts={guards} />);
    expect(screen.getByText("Unrest in Nowhere")).toBeInTheDocument();
    // No doubled years for names that already carry them.
    expect(
      screen.getByText("Haitian crisis (2018–present)")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/\(2018–present\) \(2018/)
    ).not.toBeInTheDocument();
  });

  it("selects and deselects conflicts as pills", () => {
    render(<Host />);
    fireEvent.change(searchInput(), { target: { value: "sudan" } });
    fireEvent.click(screen.getByText("Sudanese civil war (2023-present)"));
    // Selected: rendered once as the accent pill, out of the result list.
    expect(
      screen.getAllByText("Sudanese civil war (2023-present)")
    ).toHaveLength(1);

    // A selected ended conflict stays visible with the switch back off.
    fireEvent.click(endedSwitch());
    fireEvent.change(searchInput(), { target: { value: "falklands" } });
    fireEvent.click(screen.getByText("Falklands War (1982)"));
    fireEvent.click(endedSwitch());
    fireEvent.change(searchInput(), { target: { value: "" } });
    expect(screen.getByText("Falklands War (1982)")).toBeInTheDocument();

    // Clicking a selected pill deselects it.
    fireEvent.click(screen.getByText("Falklands War (1982)"));
    expect(screen.queryByText("Falklands War (1982)")).not.toBeInTheDocument();
  });

  it("caps the visible list and hints to type when it overflows", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      conflict({ id: `m${i}`, name: `Conflict ${String(i).padStart(2, "0")}` })
    );
    render(<Host conflicts={many} />);
    fireEvent.change(searchInput(), { target: { value: "conflict" } });
    expect(screen.getByText("Conflict 00")).toBeInTheDocument();
    expect(screen.getByText("Conflict 29")).toBeInTheDocument();
    expect(screen.queryByText("Conflict 30")).not.toBeInTheDocument();
    expect(screen.getByText(/10 more\. Type to narrow/)).toBeInTheDocument();
  });
});
