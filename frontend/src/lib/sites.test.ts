import { describe, expect, it } from "vitest";

import { newSourceDraft } from "./sources";
import {
  contourBefore,
  contourFromImage,
  contourOn,
  corroborationLabel,
  formatDistance,
  imageFromEventSource,
  latestImage,
  newSiteImageDraft,
  ownsSite,
  shownAtEveryZoom,
  siteContourHref,
  siteImageMissing,
  siteImagePayload,
  sitesAsOf,
  sortImages,
  sortLinkedEvents,
  utcDay,
  zoneEmphasis,
  type SiteContour,
  type SiteImage,
  type SiteLinkedEvent,
} from "./sites";

const ZONE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [137, -25],
      [137.01, -25],
      [137.01, -25.01],
      [137, -25],
    ] as [number, number][],
  ],
};

function contour(id: string, capturedAt: string, createdAt = "2026-10-01T00:00:00Z"): SiteContour {
  return { id, zone: ZONE, image_id: `img-${id}`, captured_at: capturedAt, created_at: createdAt, author: null };
}

function image(id: string, capturedAt: string, createdAt: string): SiteImage {
  return {
    id,
    title: "",
    level: "context",
    kind: "satellite",
    captured_at: capturedAt,
    capture_position: null,
    is_graphic: false,
    links: [],
    tags: [],
    media: null,
    warnings: [],
    provider: null,
    author: null,
    note: null,
    created_at: createdAt,
  };
}

function linked(id: string, occurred: string | null, linkedAt: string): SiteLinkedEvent {
  return {
    id,
    title: id,
    occurred_date: occurred,
    coords: { lat: -25, lng: 137 },
    owner: { id: "u1", username: "ana", avatar_url: null },
    effect: "damage",
    linked_at: linkedAt,
    inside_zone: true,
    distance_m: null,
    measured_contour_id: "c1",
  };
}

const NOV = contour("nov", "2025-11-14T10:30:00Z");
const JUN = contour("jun", "2026-06-18T10:30:00Z");
// Drawn later from the same image: the later contour wins the tie.
const JUN_REDRAWN = contour("jun2", "2026-06-18T10:30:00Z", "2026-10-02T00:00:00Z");

describe("contourOn", () => {
  it("picks the latest contour captured on or before the day", () => {
    expect(contourOn([JUN, NOV], "2026-03-02")?.id).toBe("nov");
    expect(contourOn([NOV, JUN], "2026-06-18")?.id).toBe("jun");
    expect(contourOn([NOV, JUN], "2026-09-07")?.id).toBe("jun");
  });

  it("has no zone before the first contour's capture day", () => {
    expect(contourOn([NOV, JUN], "2025-11-13")).toBeNull();
  });

  it("breaks a tie on the capture time with the later contour", () => {
    expect(contourOn([JUN_REDRAWN, NOV, JUN], "2026-07-01")?.id).toBe("jun2");
  });

  it("reads a capture time late in the day as that UTC day", () => {
    expect(contourOn([contour("late", "2026-01-05T23:59:00Z")], "2026-01-05")?.id).toBe("late");
    expect(utcDay("2026-01-05T23:59:00Z")).toBe("2026-01-05");
  });
});

describe("contour neighbours", () => {
  it("names the contour before one, none for the first", () => {
    expect(contourBefore([JUN, NOV], JUN)?.id).toBe("nov");
    expect(contourBefore([JUN, NOV], NOV)).toBeNull();
  });

  it("finds the latest contour drawn from an image", () => {
    const again = { ...JUN_REDRAWN, image_id: JUN.image_id };
    expect(contourFromImage([JUN, again, NOV], JUN.image_id)?.id).toBe("jun2");
    expect(contourFromImage([NOV], "img-none")).toBeNull();
  });
});

describe("history order", () => {
  const found = image("found", "2025-01-01T00:00:00Z", "2026-09-01T00:00:00Z");
  const fresh = image("fresh", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");

  it("sorts images newest first by capture or by filing", () => {
    expect(sortImages([found, fresh], "fact").map((i) => i.id)).toEqual(["fresh", "found"]);
    expect(sortImages([fresh, found], "recorded").map((i) => i.id)).toEqual(["found", "fresh"]);
    expect(latestImage([found, fresh])?.id).toBe("fresh");
    expect(latestImage([])).toBeNull();
  });

  it("sorts linked events by event date, an undated one on the day it was linked", () => {
    const old = linked("old", "2026-04-10", "2026-10-20T00:00:00Z");
    const undated = linked("undated", null, "2026-05-01T00:00:00Z");
    const recent = linked("recent", "2026-09-05", "2026-09-06T00:00:00Z");
    expect(sortLinkedEvents([old, undated, recent], "fact").map((e) => e.id)).toEqual([
      "recent",
      "undated",
      "old",
    ]);
    expect(sortLinkedEvents([old, undated, recent], "recorded").map((e) => e.id)).toEqual([
      "old",
      "recent",
      "undated",
    ]);
  });
});

describe("visibility rules", () => {
  it("draws a corroborated site at every zoom, an uncorroborated one for its owner only", () => {
    expect(shownAtEveryZoom({ is_corroborated: true, owner_id: "a" }, null)).toBe(true);
    expect(shownAtEveryZoom({ is_corroborated: false, owner_id: "a" }, "a")).toBe(true);
    expect(shownAtEveryZoom({ is_corroborated: false, owner_id: "a" }, "b")).toBe(false);
    expect(shownAtEveryZoom({ is_corroborated: false, owner_id: "a" }, null)).toBe(false);
  });

  it("gives the owner controls to the owner alone", () => {
    const site = { owner: { id: "a", username: "ana", avatar_url: null } };
    expect(ownsSite(site, "a")).toBe(true);
    expect(ownsSite(site, "b")).toBe(false);
    expect(ownsSite(site, null)).toBe(false);
  });

  it("colours a zone for damage and destruction only", () => {
    const effect = (e: "damage" | "destruction" | "activity" | "other") => ({
      latest_link_effect: { effect: e, occurred_date: null, event_id: "x" },
    });
    expect(zoneEmphasis(effect("damage"))).toBe("damage");
    expect(zoneEmphasis(effect("destruction"))).toBe("destruction");
    expect(zoneEmphasis(effect("activity"))).toBeNull();
    expect(zoneEmphasis({ latest_link_effect: null })).toBeNull();
  });
});

describe("labels", () => {
  it("says Not corroborated rather than a count of one", () => {
    expect(corroborationLabel({ is_corroborated: false, corroboration_count: 1 })).toBe("Not corroborated");
    expect(corroborationLabel({ is_corroborated: true, corroboration_count: 3 })).toBe(
      "Corroborated by 3 analysts",
    );
  });

  it("writes a distance in metres, then kilometres", () => {
    expect(formatDistance(640.4)).toBe("640 m");
    expect(formatDistance(2400)).toBe("2.4 km");
  });

  it("reads the map at the end of the date window, or today", () => {
    expect(sitesAsOf("2026-03-01", "2026-10-25")).toBe("2026-03-01");
    expect(sitesAsOf("", "2026-10-25")).toBeNull();
    expect(sitesAsOf("2027-01-01", "2026-10-25")).toBeNull();
  });

  it("opens the contour editor on an image", () => {
    expect(siteContourHref("s1")).toBe("/sites/s1/contour");
    expect(siteContourHref("s1", "i1")).toBe("/sites/s1/contour?image=i1");
  });
});

describe("site image drafts", () => {
  it("starts as a satellite context source", () => {
    const draft = newSiteImageDraft();
    expect(draft.kind).toBe("satellite");
    expect(draft.level).toBe("context");
  });

  it("lists the capture date and a link as missing, then a date in the future", () => {
    const draft = newSiteImageDraft();
    expect(siteImageMissing(draft, "", "2026-10-25")).toEqual(["Capture date", "A link"]);
    const later = {
      ...draft,
      capturedAt: "2026-11-01T10:00",
      links: [{ url: "https://example.org/a", postedAt: "", snapshotUrl: "", stored: null }],
    };
    expect(siteImageMissing(later, "x".repeat(501), "2026-10-25")).toEqual([
      "A capture date that is not in the future",
      "A note of at most 500 characters",
    ]);
  });

  it("posts the image fields with a blank note as absent", () => {
    const draft = {
      ...newSourceDraft(),
      title: " Sentinel-2 ",
      capturedAt: "2026-06-01T09:30",
      links: [{ url: " https://example.org/a ", postedAt: "", snapshotUrl: "", stored: null }],
    };
    expect(siteImagePayload(draft, "  ")).toEqual({
      title: "Sentinel-2",
      captured_at: "2026-06-01T09:30",
      links: [{ url: "https://example.org/a", posted_at: null, snapshot_url: null }],
      upload_id: null,
      media_id: null,
      note: null,
    });
  });

  it("files an event's satellite source with its file, never another kind, an undated or a graphic one", () => {
    const source = {
      title: "Pass",
      kind: "satellite",
      captured_at: "2026-07-04T10:20:00Z",
      is_graphic: false,
      media: { id: "m1" },
      links: [{ url: "https://example.org/a", archived: { url: "https://web.archive.org/x" } }],
    };
    expect(imageFromEventSource(source)).toEqual({
      title: "Pass",
      captured_at: "2026-07-04T10:20:00Z",
      links: [{ url: "https://example.org/a", snapshot_url: "https://web.archive.org/x" }],
      media_id: "m1",
      note: null,
    });
    expect(imageFromEventSource({ ...source, kind: "drone" })).toBeNull();
    expect(imageFromEventSource({ ...source, captured_at: null })).toBeNull();
    expect(imageFromEventSource({ ...source, media: null })).toBeNull();
    expect(imageFromEventSource({ ...source, is_graphic: true })).toBeNull();
  });
});
