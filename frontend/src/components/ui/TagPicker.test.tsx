import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import { useState } from "react";

import { TagPicker } from "./TagPicker";
import { ApiError, apiFetch } from "@/lib/api";
import type { Conflict, Tag } from "@/types";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));

function conflict(overrides: Partial<Conflict> & Pick<Conflict, "id" | "name">): Conflict {
  return {
    wikidata_id: null,
    start_year: null,
    end_year: null,
    is_ongoing: true,
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
    is_ongoing: false,
  }),
  conflict({
    id: "c4",
    name: "Gulf War",
    start_year: 1990,
    end_year: 1991,
    is_ongoing: false,
  }),
  conflict({ id: "c5", name: "Other" }),
];

// Stateful host so pill clicks round-trip through the selection state.
function Host({
  conflicts = CONFLICTS,
  initialTags = [],
  suggestedTags,
  suggestedConflictIds,
}: {
  conflicts?: Conflict[];
  initialTags?: Tag[];
  suggestedTags?: Tag[];
  suggestedConflictIds?: string[];
}) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>([]);
  return (
    <TagPicker
      tags={tags}
      setTags={setTags}
      suggestedTags={suggestedTags}
      selectedTagIds={selectedTagIds}
      setSelectedTagIds={setSelectedTagIds}
      conflicts={conflicts}
      selectedConflictIds={selectedConflictIds}
      setSelectedConflictIds={setSelectedConflictIds}
      suggestedConflictIds={suggestedConflictIds}
    />
  );
}

const conflictField = () => screen.getByRole("combobox", { name: "Conflict" });
const optionNames = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("TagPicker conflicts", () => {
  it("shows no conflict until the field takes focus", () => {
    render(<Host />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Russian invasion of Ukraine/)).not.toBeInTheDocument();
  });

  it("lists every conflict on focus, the ongoing ones first, Other last", () => {
    render(<Host />);
    fireEvent.focus(conflictField());
    expect(optionNames()).toEqual([
      "Russian invasion of Ukraine (2022-present)",
      "Sudanese civil war (2023-present)",
      "Falklands War (1982)",
      "Gulf War (1990-1991)",
      "Other",
    ]);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("offers Other even when not flagged ongoing", () => {
    const flippedOther = [
      conflict({ id: "c1", name: "Major war", tier: "major" }),
      conflict({ id: "c5", name: "Other", is_ongoing: false }),
    ];
    render(<Host conflicts={flippedOther} />);
    fireEvent.change(conflictField(), { target: { value: "oth" } });
    expect(optionNames()).toEqual(["Other"]);
  });

  it("filters by case-insensitive substring", () => {
    render(<Host />);
    fireEvent.change(conflictField(), { target: { value: "SUDAN" } });
    expect(optionNames()).toEqual(["Sudanese civil war (2023-present)"]);
  });

  it("sorts the matches by tier then name, Other always last", () => {
    const withTiers = [
      conflict({ id: "s1", name: "War B", tier: "conflict" }),
      conflict({ id: "s2", name: "War A", tier: "conflict" }),
      conflict({ id: "s3", name: "War C", tier: "major" }),
      conflict({ id: "s4", name: "War D", tier: "minor" }),
      conflict({ id: "s5", name: "Other" }),
    ];
    render(<Host conflicts={withTiers} />);
    fireEvent.change(conflictField(), { target: { value: "r" } });
    expect(optionNames()).toEqual(["War C", "War D", "War A", "War B", "Other"]);
  });

  it("suggests conflicts in one click, in the order given", () => {
    render(<Host suggestedConflictIds={["c2", "c1", "gone"]} />);
    const group = screen.getByRole("group", { name: "Suggested conflict" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      expect.stringContaining("Sudanese civil war"),
      expect.stringContaining("Russian invasion of Ukraine"),
    ]);
    fireEvent.click(within(group).getByRole("button", { name: "Add Sudanese civil war (2023-present)" }));
    expect(
      screen.getByRole("button", { name: "Remove Sudanese civil war (2023-present)" })
    ).toBeInTheDocument();
  });

  it("finds an ended conflict by name", () => {
    render(<Host />);
    fireEvent.change(conflictField(), { target: { value: "falklands" } });
    expect(optionNames()).toEqual(["Falklands War (1982)"]);
  });

  it("says when no conflict matches", () => {
    render(<Host />);
    fireEvent.change(conflictField(), { target: { value: "zzz" } });
    expect(optionNames()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("No match.");
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
    fireEvent.focus(conflictField());
    expect(optionNames()).toEqual(["Haitian crisis (2018–present)", "Unrest in Nowhere"]);
  });

  it("picks with the arrows and Enter, and removes a pick through its chip", () => {
    render(<Host />);
    fireEvent.change(conflictField(), { target: { value: "civil" } });
    fireEvent.keyDown(conflictField(), { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Sudanese civil war (2023-present)"
    );
    fireEvent.keyDown(conflictField(), { key: "Enter" });

    const chip = screen.getByRole("button", { name: "Remove Sudanese civil war (2023-present)" });
    expect(conflictField()).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(conflictField());
    expect(optionNames()).not.toContain("Sudanese civil war (2023-present)");

    fireEvent.click(chip);
    expect(chip).not.toBeInTheDocument();
    expect(optionNames()).toContain("Sudanese civil war (2023-present)");
  });

  it("picks an ended conflict like any other", () => {
    render(<Host />);
    fireEvent.change(conflictField(), { target: { value: "falklands" } });
    fireEvent.click(screen.getByRole("option", { name: "Falklands War (1982)" }));
    expect(screen.getByRole("button", { name: "Remove Falklands War (1982)" })).toBeInTheDocument();
  });
});

const TAGS: Tag[] = [
  { id: "t1", name: "armor" },
  { id: "t2", name: "Artillery" },
  { id: "t3", name: "drone" },
];

const tagField = () => screen.getByRole("combobox", { name: "Tags" });

describe("TagPicker tags", () => {
  it("suggests the tags matching the typed text, case-insensitive", () => {
    render(<Host initialTags={TAGS} />);
    fireEvent.change(tagField(), { target: { value: "AR" } });
    expect(optionNames()).toEqual(["armor", "Artillery", 'Create "AR"']);
  });

  it("picks with the arrows and Enter, then leaves the pick out of the suggestions", () => {
    render(<Host initialTags={TAGS} />);
    fireEvent.change(tagField(), { target: { value: "ar" } });
    fireEvent.keyDown(tagField(), { key: "ArrowDown" });
    const active = screen.getByRole("option", { selected: true });
    expect(active).toHaveTextContent("Artillery");
    expect(tagField()).toHaveAttribute("aria-activedescendant", active.id);
    fireEvent.keyDown(tagField(), { key: "Enter" });

    expect(screen.getByRole("button", { name: "Remove Artillery" })).toBeInTheDocument();
    expect(tagField()).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(tagField());
    expect(optionNames()).toEqual(["armor", "drone"]);
  });

  it("removes a pick through its chip", () => {
    render(<Host initialTags={TAGS} />);
    fireEvent.focus(tagField());
    fireEvent.click(screen.getByRole("option", { name: "drone" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove drone" }));
    expect(screen.queryByRole("button", { name: "Remove drone" })).not.toBeInTheDocument();
    fireEvent.click(tagField());
    expect(optionNames()).toContain("drone");
  });

  it("closes on Escape", () => {
    render(<Host initialTags={TAGS} />);
    fireEvent.focus(tagField());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(tagField(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers no creation when a tag bears the exact name", () => {
    render(<Host initialTags={TAGS} />);
    fireEvent.change(tagField(), { target: { value: " drone " } });
    expect(optionNames()).toEqual(["drone"]);
  });

  it("creates a tag from the typed text and selects it", async () => {
    (apiFetch as unknown as Mock).mockResolvedValueOnce({ id: "t9", name: "armour" });
    render(<Host initialTags={TAGS} />);
    fireEvent.change(tagField(), { target: { value: "armour" } });
    fireEvent.click(screen.getByRole("option", { name: 'Create "armour"' }));

    expect(apiFetch).toHaveBeenCalledWith("/tags", {
      method: "POST",
      body: JSON.stringify({ name: "armour" }),
    });
    expect(await screen.findByRole("button", { name: "Remove armour" })).toBeInTheDocument();
    expect(tagField()).toHaveValue("");
  });

  it("says so when the tag already exists, until the text changes", async () => {
    (apiFetch as unknown as Mock).mockRejectedValueOnce(new ApiError("Conflict", 409));
    render(<Host initialTags={TAGS} />);
    fireEvent.change(tagField(), { target: { value: "hidden" } });
    fireEvent.keyDown(tagField(), { key: "Enter" });

    expect(await screen.findByText("That tag already exists.")).toBeInTheDocument();
    fireEvent.change(tagField(), { target: { value: "hidde" } });
    await waitFor(() =>
      expect(screen.queryByText("That tag already exists.")).not.toBeInTheDocument()
    );
  });
});

describe("TagPicker suggested tags", () => {
  const suggestions = () => screen.queryByRole("group", { name: "Suggested tags" });

  it("adds a suggestion in one click and drops it from the row", () => {
    render(<Host initialTags={TAGS} suggestedTags={[TAGS[2], TAGS[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add drone" }));

    expect(screen.getByRole("button", { name: "Remove drone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add drone" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add armor" })).toBeInTheDocument();
  });

  it("shows a picked suggestion again once it is removed", () => {
    render(<Host initialTags={TAGS} suggestedTags={[TAGS[2]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add drone" }));
    expect(suggestions()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove drone" }));
    expect(screen.getByRole("button", { name: "Add drone" })).toBeInTheDocument();
  });

  it("picks a suggestion the catalogue has not loaded yet", () => {
    render(<Host suggestedTags={[{ id: "t7", name: "convoy" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add convoy" }));
    expect(screen.getByRole("button", { name: "Remove convoy" })).toBeInTheDocument();
  });

  it("renders every suggestion with no Show more, the layout keeping two lines", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `tag${i}` }));
    render(<Host initialTags={many} suggestedTags={many} />);
    expect(screen.getAllByRole("button", { name: /^Add tag/ })).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("draws no row without suggestions", () => {
    render(<Host initialTags={TAGS} />);
    expect(suggestions()).not.toBeInTheDocument();
  });
});
