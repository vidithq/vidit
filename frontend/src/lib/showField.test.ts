import { describe, expect, it } from "vitest";

import { showFieldScope } from "./showField";

describe("showFieldScope", () => {
  it("shows every event and every other kind while no chip is selected", () => {
    expect(showFieldScope([], false)).toEqual({ events: true, others: true });
  });

  it("shows only what the selected chips name", () => {
    expect(showFieldScope(["geolocated"], false)).toEqual({ events: true, others: false });
    expect(showFieldScope([], true)).toEqual({ events: false, others: true });
    expect(showFieldScope(["requested"], true)).toEqual({ events: true, others: true });
  });
});
