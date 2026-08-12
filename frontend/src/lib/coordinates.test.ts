import { describe, expect, it } from "vitest";

import {
  cleanNumber,
  coordinatePair,
  formatCoordinates,
  inBounds,
  mapsUrl,
  parsePastedCoordinates,
} from "./coordinates";

describe("cleanNumber", () => {
  it("parses a whole numeric string", () => {
    expect(cleanNumber("48.015883")).toBe(48.015883);
    expect(cleanNumber("-37")).toBe(-37);
  });

  it("rejects blank and partially-numeric input", () => {
    expect(cleanNumber("")).toBeNull();
    expect(cleanNumber("   ")).toBeNull();
    expect(cleanNumber("48.85abc")).toBeNull();
  });
});

describe("inBounds", () => {
  it("accepts the extremes and rejects past them", () => {
    expect(inBounds(-90, -180)).toBe(true);
    expect(inBounds(90, 180)).toBe(true);
    expect(inBounds(90.1, 0)).toBe(false);
    expect(inBounds(0, -180.1)).toBe(false);
  });
});

describe("coordinatePair", () => {
  it("returns the pair when both halves are in-bounds numbers", () => {
    expect(coordinatePair("48.015883", "37.802411")).toEqual({
      lat: 48.015883,
      lng: 37.802411,
    });
  });

  it("returns null while the pair is empty, half-typed, or malformed", () => {
    expect(coordinatePair("", "")).toBeNull();
    expect(coordinatePair("48.01", "")).toBeNull();
    expect(coordinatePair("48.01abc", "37.8")).toBeNull();
  });

  it("returns null out of bounds", () => {
    expect(coordinatePair("91", "37.8")).toBeNull();
    expect(coordinatePair("48.01", "181")).toBeNull();
  });
});

describe("parsePastedCoordinates", () => {
  it("reads a comma-separated decimal pair", () => {
    expect(parsePastedCoordinates("48.015883, 37.802411")).toEqual({
      lat: 48.015883,
      lng: 37.802411,
    });
  });

  it("reads a whitespace-separated pair and tolerates surrounding space", () => {
    expect(parsePastedCoordinates("  48.015883 37.802411\n")).toEqual({
      lat: 48.015883,
      lng: 37.802411,
    });
  });

  it("reads degree signs and negative values", () => {
    expect(parsePastedCoordinates("-33.9249°, 18.4241°")).toEqual({
      lat: -33.9249,
      lng: 18.4241,
    });
  });

  it("reads whole degrees with no decimal part", () => {
    expect(parsePastedCoordinates("48,37")).toEqual({ lat: 48, lng: 37 });
  });

  it("reads a Google Maps URL centre", () => {
    expect(
      parsePastedCoordinates(
        "https://www.google.com/maps/place/Donetsk/@48.015883,37.802411,17z/data=!3m1"
      )
    ).toEqual({ lat: 48.015883, lng: 37.802411 });
  });

  it("reads a Google Maps q= / query= parameter, encoded comma included", () => {
    expect(
      parsePastedCoordinates("https://www.google.com/maps?q=48.015883,37.802411")
    ).toEqual({ lat: 48.015883, lng: 37.802411 });
    expect(
      parsePastedCoordinates(
        "https://www.google.com/maps/search/?api=1&query=48.015883%2C37.802411"
      )
    ).toEqual({ lat: 48.015883, lng: 37.802411 });
  });

  it("prefers the explicit query over the viewport centre when both are present", () => {
    expect(
      parsePastedCoordinates(
        "https://www.google.com/maps/@10.5,20.5,12z?q=48.015883,37.802411"
      )
    ).toEqual({ lat: 48.015883, lng: 37.802411 });
  });

  it("returns null for prose that merely contains a pair", () => {
    expect(
      parsePastedCoordinates("the strike landed at 48.015883, 37.802411 yesterday")
    ).toBeNull();
  });

  it("reads the URL forms only out of a paste that is itself a URL", () => {
    // The two map patterns match mid-string, so anything but a URL paste must
    // not reach them: prose keeps landing as prose.
    expect(
      parsePastedCoordinates("shot from @48.015883,37.802411 looking north")
    ).toBeNull();
    expect(parsePastedCoordinates("@48.015883,37.802411")).toBeNull();
    expect(
      parsePastedCoordinates("filter by q=48.015883,37.802411 in the search")
    ).toBeNull();
    expect(parsePastedCoordinates("maps.google.com/?q=48.015883,37.802411")).toBeNull();
  });

  it("reads a whole-degree comma pair as two values, not one decimal comma", () => {
    // European notation is unresolvable here: "48,015" is the pair 48 / 15.
    expect(parsePastedCoordinates("48,015")).toEqual({ lat: 48, lng: 15 });
  });

  it("returns null for a single number, three numbers, or prose", () => {
    expect(parsePastedCoordinates("48.015883")).toBeNull();
    expect(parsePastedCoordinates("48.015883, 37.802411, 12")).toBeNull();
    expect(parsePastedCoordinates("Donetsk")).toBeNull();
  });

  it("returns null when the pair is out of bounds", () => {
    expect(parsePastedCoordinates("91.5, 37.8")).toBeNull();
    expect(parsePastedCoordinates("48.01, -200.4")).toBeNull();
  });
});

describe("formatCoordinates", () => {
  it("renders six decimals, comma-separated, so it pastes back in", () => {
    const text = formatCoordinates(48.0159, 37.8);
    expect(text).toBe("48.015900, 37.800000");
    expect(parsePastedCoordinates(text)).toEqual({ lat: 48.0159, lng: 37.8 });
  });
});

describe("mapsUrl", () => {
  it("builds the external map link", () => {
    expect(mapsUrl(48.015883, 37.802411)).toBe(
      "https://www.google.com/maps?q=48.015883,37.802411"
    );
  });
});
