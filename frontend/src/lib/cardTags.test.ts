import { describe, expect, it } from "vitest";

import { cardTags } from "./cardTags";

const conflict = (id: string, name: string) => ({
  id,
  name,
  wikidata_id: null,
  start_year: null,
  end_year: null,
  ongoing: true,
  tier: "major" as const,
});

describe("cardTags", () => {
  it("keys conflicts then capture sources, leaves free tags plain, and drops Unknown", () => {
    expect(
      cardTags({
        conflicts: [conflict("c1", "Russo-Ukrainian war")],
        tags: [
          { id: "t1", name: "airstrike", category: "free" },
          { id: "t2", name: "Unknown", category: "capture_source" },
          { id: "t3", name: "Drone", category: "capture_source" },
        ],
      }),
    ).toEqual([
      { id: "c1", name: "Russo-Ukrainian war", label: "Conflict" },
      { id: "t3", name: "Drone", label: "Capture source" },
      { id: "t1", name: "airstrike" },
    ]);
  });

  it("keeps a free tag named Unknown, which carries its own meaning", () => {
    expect(
      cardTags({ conflicts: [], tags: [{ id: "t1", name: "Unknown", category: "free" }] }),
    ).toEqual([{ id: "t1", name: "Unknown" }]);
  });
});
