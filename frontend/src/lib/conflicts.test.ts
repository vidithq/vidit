import { describe, expect, it } from "vitest";

import { conflictLabel, sortConflicts } from "./conflicts";
import type { Conflict } from "@/types";

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

describe("conflictLabel", () => {
  it("appends start-present to ongoing conflicts", () => {
    expect(
      conflictLabel(conflict({ id: "1", name: "Sudanese civil war", start_year: 2023 }))
    ).toBe("Sudanese civil war (2023-present)");
  });

  it("appends a single year to a one-year ended conflict", () => {
    expect(
      conflictLabel(
        conflict({
          id: "1",
          name: "Falklands War",
          start_year: 1982,
          end_year: 1982,
          ongoing: false,
        })
      )
    ).toBe("Falklands War (1982)");
  });

  it("appends a plain-hyphen range to a multi-year ended conflict", () => {
    expect(
      conflictLabel(
        conflict({
          id: "1",
          name: "Gulf War",
          start_year: 1990,
          end_year: 1991,
          ongoing: false,
        })
      )
    ).toBe("Gulf War (1990-1991)");
  });

  it("skips the suffix when the start year is unknown", () => {
    expect(conflictLabel(conflict({ id: "1", name: "Other" }))).toBe("Other");
  });

  it("skips the suffix when the name already carries a 4-digit year", () => {
    expect(
      conflictLabel(
        conflict({
          id: "1",
          name: "Haitian crisis (2018–present)",
          start_year: 2018,
        })
      )
    ).toBe("Haitian crisis (2018–present)");
    expect(
      conflictLabel(
        conflict({
          id: "2",
          name: "Anglo-Turkish War (1918–1923)",
          start_year: 1918,
          end_year: 1923,
          ongoing: false,
        })
      )
    ).toBe("Anglo-Turkish War (1918–1923)");
  });
});

describe("sortConflicts", () => {
  it("orders by tier rank then name, Other pinned last", () => {
    const sorted = sortConflicts([
      conflict({ id: "1", name: "Zeta", tier: "minor" }),
      conflict({ id: "2", name: "Other" }),
      conflict({ id: "3", name: "Beta", tier: "conflict" }),
      conflict({ id: "4", name: "Alpha" }),
      conflict({ id: "5", name: "Gamma", tier: "major" }),
      conflict({ id: "6", name: "Delta", tier: "major" }),
    ]);
    expect(sorted.map((c) => c.name)).toEqual([
      "Delta",
      "Gamma",
      "Zeta",
      "Beta",
      "Alpha",
      "Other",
    ]);
  });
});
