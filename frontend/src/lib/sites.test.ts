import { describe, expect, it } from "vitest";

import {
  EMPTY_OBSERVATION,
  corroborationLabel,
  formatDistance,
  observationBody,
  observationMissing,
  previousObservation,
  siteSuggestionsPath,
  sitesAsOf,
  sitesPath,
  zoneEmphasis,
  type SiteObservation,
  type Zone,
} from "./sites";

const ZONE: Zone = {
  type: "Polygon",
  coordinates: [[[30, 10], [30.1, 10], [30.1, 10.1], [30, 10]]],
};

describe("sitesAsOf", () => {
  it("reads the end of the event date window", () => {
    expect(sitesAsOf("2024-02-18", "2026-10-21")).toBe("2024-02-18");
  });

  it("leaves the date to the API when the window has no end", () => {
    expect(sitesAsOf("", "2026-10-21")).toBeNull();
  });

  it("reads an end on or past today as today", () => {
    expect(sitesAsOf("2026-10-21", "2026-10-21")).toBeNull();
    expect(sitesAsOf("2027-01-01", "2026-10-21")).toBeNull();
  });
});

describe("paths", () => {
  it("sends as_of only when set", () => {
    expect(sitesPath("1,2,3,4", null)).toBe("/sites?bbox=1%2C2%2C3%2C4");
    expect(sitesPath("1,2,3,4", "2024-01-01")).toBe("/sites?bbox=1%2C2%2C3%2C4&as_of=2024-01-01");
  });

  it("drops a blank search from the suggestions", () => {
    expect(siteSuggestionsPath("e", "  ")).toBe("/events/e/site-suggestions");
    expect(siteSuggestionsPath("e", " alpha ")).toBe("/events/e/site-suggestions?q=alpha");
  });
});

describe("labels", () => {
  it("prints metres under a kilometre and kilometres from there", () => {
    expect(formatDistance(640.4)).toBe("640 m");
    expect(formatDistance(2990.4)).toBe("3.0 km");
  });

  it("names a site linked only by its owner as not corroborated", () => {
    expect(corroborationLabel({ is_corroborated: false, corroboration_count: 1 })).toBe("Not corroborated");
    expect(corroborationLabel({ is_corroborated: true, corroboration_count: 3 })).toBe(
      "Corroborated by 3 analysts",
    );
  });

  it("colours a zone only for damage or destruction", () => {
    const link = (effect: "damage" | "destruction" | "other") => ({
      latest_link_effect: { effect, event_date: null, event_id: "e" },
    });
    expect(zoneEmphasis(link("damage"))).toBe("damage");
    expect(zoneEmphasis(link("destruction"))).toBe("destruction");
    expect(zoneEmphasis(link("other"))).toBeNull();
    expect(zoneEmphasis({ latest_link_effect: null })).toBeNull();
  });
});

describe("previousObservation", () => {
  const obs = (id: string) => ({ id }) as SiteObservation;
  it("is the observation before, in the API's order", () => {
    const list = [obs("a"), obs("b"), obs("c")];
    expect(previousObservation(list, "c")?.id).toBe("b");
    expect(previousObservation(list, "a")).toBeNull();
  });
});

describe("observationMissing", () => {
  const today = "2026-10-21";
  const complete = { ...EMPTY_OBSERVATION, provider: "sentinel_2" as const, capturedOn: "2025-06-14" };

  it("passes a complete draft with a zone", () => {
    expect(observationMissing(complete, ZONE, today)).toEqual([]);
  });

  it("asks for the zone, the provider and the date", () => {
    expect(observationMissing(EMPTY_OBSERVATION, null, today)).toEqual([
      "A closed zone",
      "Imagery provider",
      "Capture date",
    ]);
  });

  it("refuses a capture date after today", () => {
    expect(observationMissing({ ...complete, capturedOn: "2026-10-22" }, ZONE, today)).toEqual([
      "A capture date that is not in the future",
    ]);
  });

  it("requires a URL for Other, and an http one whenever given", () => {
    expect(observationMissing({ ...complete, provider: "other" }, ZONE, today)).toEqual([
      "Public URL of the image",
    ]);
    expect(observationMissing({ ...complete, url: "ftp://x" }, ZONE, today)).toEqual([
      "An http or https image URL",
    ]);
  });
});

describe("observationBody", () => {
  it("sends a blank URL and note as absent", () => {
    const body = observationBody(
      { capturedOn: "2025-06-14", provider: "landsat", url: "  ", effect: "reoccupation", note: " " },
      ZONE,
    );
    expect(body).toEqual({
      zone: ZONE,
      captured_on: "2025-06-14",
      imagery_provider: "landsat",
      imagery_url: null,
      effect: "reoccupation",
      note: null,
    });
  });
});
