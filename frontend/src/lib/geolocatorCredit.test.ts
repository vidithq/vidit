import { describe, expect, it } from "vitest";

import { creditProps, creditedAuthors } from "./geolocatorCredit";

const ana = { id: "u1", username: "ana" };
const bo = { id: "u2", username: "bo" };
const cy = { id: "u3", username: "cy" };

describe("creditedAuthors", () => {
  it("leads with the owner and keeps the other geolocators in credit order", () => {
    expect(creditedAuthors({ owner: bo, geolocators: [ana, bo, cy] })).toEqual([bo, ana, cy]);
  });

  it("credits the owner alone on a row without geolocators", () => {
    expect(creditedAuthors({ owner: ana, geolocators: [] })).toEqual([ana]);
  });

  it("splits the line into the lead and the co-authors", () => {
    expect(creditProps({ owner: ana, geolocators: [ana, bo] })).toEqual({
      author: ana,
      coAuthors: [bo],
    });
  });
});
