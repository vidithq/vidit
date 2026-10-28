import { describe, expect, it } from "vitest";
import {
  appendEventFilterParams,
  exactProfile,
  readEventFilterParams,
  readShowPick,
  searchPageParams,
  searchTypes,
  splitHighlights,
} from "./search";
import type { SearchHit } from "@/types";

const STX = "";
const ETX = "";

describe("splitHighlights", () => {
  it("returns one unhighlighted segment for sentinel-free text", () => {
    expect(splitHighlights("plain text")).toEqual([
      { text: "plain text", highlighted: false },
    ]);
  });

  it("marks the segment between STX and ETX as highlighted", () => {
    expect(splitHighlights(`foo ${STX}bar${ETX} baz`)).toEqual([
      { text: "foo ", highlighted: false },
      { text: "bar", highlighted: true },
      { text: " baz", highlighted: false },
    ]);
  });

  it("handles multiple highlight pairs with alternating parity", () => {
    const segments = splitHighlights(
      `${STX}a${ETX} and ${STX}b${ETX} end`
    );
    expect(segments).toEqual([
      { text: "", highlighted: false },
      { text: "a", highlighted: true },
      { text: " and ", highlighted: false },
      { text: "b", highlighted: true },
      { text: " end", highlighted: false },
    ]);
  });

  it("keeps empty segments from consecutive sentinels so parity holds", () => {
    expect(splitHighlights(`${STX}${ETX}tail`)).toEqual([
      { text: "", highlighted: false },
      { text: "", highlighted: true },
      { text: "tail", highlighted: false },
    ]);
  });

  it("never treats user-typed bracket text as a sentinel", () => {
    expect(splitHighlights("[[HL]]not a highlight[[/HL]]")).toEqual([
      { text: "[[HL]]not a highlight[[/HL]]", highlighted: false },
    ]);
  });
});

describe("the event filter keys", () => {
  it("round-trip every filter through a URL", () => {
    const params = new URLSearchParams();
    appendEventFilterParams(params, {
      show: ["geolocated"],
      conflicts: ["Ukraine"],
      sourceKinds: ["drone"], levels: ["direct"],
      tags: ["drone", "night"],
      mediaTypes: ["video"],
      locationGuess: ["blind"],
      author: " ana ",
      approved: true,
      approvedBy: { kind: "analyst", username: "bo" },
      eventFrom: "2026-01-01",
      eventTo: "",
      addedFrom: "",
      addedTo: "2026-02-01",
    });
    expect(params.toString()).toBe(
      "status=geolocated&conflict=Ukraine&source_kind=drone&level=direct&tag=drone&tag=night&media=video" +
        "&author=ana&has_coords=false&approved=true&approved_by=bo&occurred_date_from=2026-01-01" +
        "&submitted_to=2026-02-01",
    );
    expect(readEventFilterParams(params)).toEqual({
      show: ["geolocated"],
      conflicts: ["Ukraine"],
      sourceKinds: ["drone"], levels: ["direct"],
      tags: ["drone", "night"],
      mediaTypes: ["video"],
      locationGuess: ["blind"],
      author: "ana",
      approved: true,
      approvedBy: { kind: "analyst", username: "bo" },
      eventFrom: "2026-01-01",
      eventTo: "",
      addedFrom: "",
      addedTo: "2026-02-01",
    });
  });

  it("name an organization approver by its slug", () => {
    const org = new URLSearchParams();
    appendEventFilterParams(org, {
      approvedBy: { kind: "organization", slug: "osw", name: "Open Source Watch" },
    });
    expect(org.toString()).toBe("approved_by_org=osw");
    expect(readEventFilterParams(org).approvedBy).toEqual({
      kind: "organization",
      slug: "osw",
      name: "osw",
    });
  });

  it("drop a name the handle gate refuses", () => {
    const refused = new URLSearchParams();
    appendEventFilterParams(refused, { author: "a%b" });
    expect(refused.toString()).toBe("");
    const read = readEventFilterParams(new URLSearchParams("author=a%25b&approved_by=a%25b"));
    expect(read.author).toBe("");
    expect(read.approvedBy).toBeNull();
  });
});

describe("exactProfile", () => {
  const analyst = {
    type: "user" as const,
    id: "u1",
    username: "Kharkiv_Watch",
    username_highlight: "Kharkiv_Watch",
    bio: null,
    bio_highlight: null,
    avatar_url: null,
  };
  const organization = {
    type: "organization" as const,
    id: "o1",
    slug: "open-source-watch",
    name: "Open Source Watch",
    name_highlight: "Open Source Watch",
    bio: null,
    bio_highlight: null,
    avatar_url: null,
    member_count: 3,
  };
  const results: SearchHit[] = [organization, analyst];

  it("names an analyst by username, ignoring case and a leading @", () => {
    expect(exactProfile("@kharkiv_watch ", results)).toEqual({ kind: "analyst", hit: analyst });
  });

  it("names an organization by slug or by name", () => {
    expect(exactProfile("open-source-watch", results)?.hit).toBe(organization);
    expect(exactProfile("open source watch", results)?.hit).toBe(organization);
  });

  it("names no one on a partial or longer query", () => {
    expect(exactProfile("kharkiv", results)).toBeNull();
    expect(exactProfile("kharkiv_watch strike", results)).toBeNull();
    expect(exactProfile("  ", results)).toBeNull();
  });
});

describe("the Show pick", () => {
  it("lists every type with no chip selected, and only what the selected chips name", () => {
    expect(searchTypes([])).toEqual([]);
    expect(searchTypes(["geolocated"])).toEqual(["event"]);
    expect(searchTypes(["site"])).toEqual(["site"]);
    expect(searchTypes(["detected", "site", "collection"])).toEqual(["event", "site", "collection"]);
  });

  it("writes the pick in the GET /search vocabulary and reads it back", () => {
    const params = searchPageParams("depot", { show: ["geolocated", "site"], author: "ana" });
    expect(params.toString()).toBe("q=depot&type=event&type=site&status=geolocated&author=ana");
    expect(readShowPick(params)).toEqual(["geolocated", "site"]);
  });

  it("reads type=event alone as every status, and drops values no chip offers", () => {
    expect(readShowPick(new URLSearchParams("type=event"))).toEqual([
      "requested",
      "detected",
      "geolocated",
    ]);
    expect(
      readShowPick(new URLSearchParams("type=geolocation&type=collection&status=closed")),
    ).toEqual(["collection"]);
  });
});
