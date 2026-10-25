import { describe, expect, it } from "vitest";

import { cardTags } from "./cardTags";

const conflict = (id: string, name: string) => ({
  id,
  name,
  wikidata_id: null,
  start_year: null,
  end_year: null,
  is_ongoing: true,
  tier: "major" as const,
});

describe("cardTags", () => {
  it("keys conflicts and leaves tags plain", () => {
    expect(
      cardTags({
        conflicts: [conflict("c1", "Russo-Ukrainian war")],
        tags: [
          { id: "t1", name: "airstrike" },
          { id: "t2", name: "Unknown" },
        ],
      }),
    ).toEqual([
      { id: "c1", name: "Russo-Ukrainian war", label: "Conflict" },
      { id: "t1", name: "airstrike" },
      { id: "t2", name: "Unknown" },
    ]);
  });
});
