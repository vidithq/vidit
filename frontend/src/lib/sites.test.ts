import { describe, expect, it, vi } from "vitest";

const calls: { path: string; method: string; body?: string }[] = [];
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiFetch: (path: string, options?: RequestInit) => {
    calls.push({ path, method: options?.method ?? "GET", body: options?.body as string | undefined });
    return Promise.resolve(undefined);
  },
}));

import { newSourceDraft } from "./sources";
import {
  saveSiteLinks,
  siteSuggestionsNearPath,
  contourBefore,
  contourOfSource,
  contourOn,
  formatDistance,
  siteSourceFromEventSource,
  latestSource,
  newSiteSourceDraft,
  ownsSite,
  siteChangedFields,
  siteEditHref,
  siteSourceMissing,
  siteSourcePayload,
  sitesAsOf,
  siteVersioned,
  siteVersions,
  sortSources,
  sortLinkedEvents,
  utcDay,
  zoneEmphasis,
  type Site,
  type SiteContour,
  type SiteSource,
  type SiteLinkedEvent,
  type SiteVersion,
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
  return { id, zone: ZONE, source_id: `src-${id}`, captured_at: capturedAt, created_at: createdAt, author: null };
}

function source(id: string, capturedAt: string, createdAt: string): SiteSource {
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
    is_graphic: false,
    media: null,
    effect: "damage",
    linked_at: linkedAt,
    inside_zone: true,
    distance_m: null,
    measured_contour_id: "c1",
  };
}

const NOV = contour("nov", "2025-11-14T10:30:00Z");
const JUN = contour("jun", "2026-06-18T10:30:00Z");
// Drawn later from the same source: the later contour wins the tie.
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

  it("finds the contour a source carries", () => {
    expect(contourOfSource([JUN, NOV], JUN.source_id)?.id).toBe("jun");
    expect(contourOfSource([NOV], "src-none")).toBeNull();
  });
});

describe("date on the ground order", () => {
  const found = source("found", "2025-01-01T00:00:00Z", "2026-09-01T00:00:00Z");
  const fresh = source("fresh", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");

  it("sorts sources newest first by capture, whenever each was filed", () => {
    expect(sortSources([found, fresh]).map((i) => i.id)).toEqual(["fresh", "found"]);
    expect(latestSource([found, fresh])?.id).toBe("fresh");
    expect(latestSource([])).toBeNull();
  });

  it("sorts linked events by event date, an undated one on the day it was linked", () => {
    const old = linked("old", "2026-04-10", "2026-10-20T00:00:00Z");
    const undated = linked("undated", null, "2026-05-01T00:00:00Z");
    const recent = linked("recent", "2026-09-05", "2026-09-06T00:00:00Z");
    expect(sortLinkedEvents([old, undated, recent]).map((e) => e.id)).toEqual([
      "recent",
      "undated",
      "old",
    ]);
  });
});

describe("visibility rules", () => {
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
  it("writes a distance in metres, then kilometres", () => {
    expect(formatDistance(640.4)).toBe("640 m");
    expect(formatDistance(2400)).toBe("2.4 km");
  });

  it("reads the map at the end of the date window, or today", () => {
    expect(sitesAsOf("2026-03-01", "2026-10-25")).toBe("2026-03-01");
    expect(sitesAsOf("", "2026-10-25")).toBeNull();
    expect(sitesAsOf("2027-01-01", "2026-10-25")).toBeNull();
  });

  it("opens the edit page on a source", () => {
    expect(siteEditHref("s1")).toBe("/sites/s1/edit");
    expect(siteEditHref("s1", "i1")).toBe("/sites/s1/edit?source=i1");
  });
});

describe("site source drafts", () => {
  it("starts as a satellite context source", () => {
    const draft = newSiteSourceDraft();
    expect(draft.kind).toBe("satellite");
    expect(draft.level).toBe("context");
  });

  it("lists the capture date and a link as missing, then a date in the future", () => {
    const draft = newSiteSourceDraft();
    expect(siteSourceMissing(draft, "", "2026-10-25")).toEqual(["Capture date", "A link"]);
    const later = {
      ...draft,
      capturedAt: "2026-11-01T10:00",
      links: [{ url: "https://example.org/a", postedAt: "", snapshotUrl: "", stored: null }],
    };
    expect(siteSourceMissing(later, "x".repeat(501), "2026-10-25")).toEqual([
      "A capture date that is not in the future",
      "A note of at most 500 characters",
    ]);
  });

  it("posts the source fields with a blank note as absent", () => {
    const draft = {
      ...newSourceDraft(),
      title: " Sentinel-2 ",
      capturedAt: "2026-06-01T09:30",
      links: [{ url: " https://example.org/a ", postedAt: "", snapshotUrl: "", stored: null }],
    };
    expect(siteSourcePayload(draft, "  ")).toEqual({
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
    expect(siteSourceFromEventSource(source)).toEqual({
      title: "Pass",
      captured_at: "2026-07-04T10:20:00Z",
      links: [{ url: "https://example.org/a", snapshot_url: "https://web.archive.org/x" }],
      media_id: "m1",
      note: null,
    });
    expect(siteSourceFromEventSource({ ...source, kind: "drone" })).toBeNull();
    expect(siteSourceFromEventSource({ ...source, captured_at: null })).toBeNull();
    expect(siteSourceFromEventSource({ ...source, media: null })).toBeNull();
    expect(siteSourceFromEventSource({ ...source, is_graphic: true })).toBeNull();
  });
});

describe("site versions", () => {
  const OWNER = { id: "u1", username: "ana", avatar_url: null };
  const EDITOR = { id: "u2", username: "ben", avatar_url: null };
  const first = source("src-nov", "2025-11-14T10:30:00Z", "2026-01-01T00:00:00Z");
  const second = source("src-jun", "2026-06-18T10:30:00Z", "2026-07-01T00:00:00Z");
  const site = {
    id: "s1",
    name: "Depot South",
    kind: "depot",
    version_no: 3,
    owner: OWNER,
    created_at: "2026-01-01T00:00:00Z",
    sources: [first, second],
    contours: [NOV, JUN],
    linked_events: [linked("e1", "2026-05-01", "2026-05-02T00:00:00Z")],
    latest_link_effect: null,
  } as unknown as Site;
  const row = (n: number, rest: Partial<SiteVersion>): SiteVersion =>
    ({
      id: `v${n}`,
      version_no: n,
      edited_by: EDITOR,
      created_at: `2026-0${n + 1}-01T00:00:00Z`,
      name: "Depot South",
      kind: "depot",
      zone: ZONE,
      centroid: { lat: -25, lng: 137 },
      contour_id: "nov",
      last_source: null,
      sources: [first],
      contours: [NOV],
      ...rest,
    }) as SiteVersion;
  const rows = [row(2, {}), row(1, { name: "Depot North", edited_by: OWNER })];

  it("addresses the live version at the site page and older ones at /vN", () => {
    const record = siteVersioned(site);
    expect([record.latest, record.first, record.label(2)]).toEqual([3, 1, "v2"]);
    expect(record.href(3)).toBe("/sites/s1");
    expect(record.href(1)).toBe("/sites/s1/v1");
    expect(record.historyHref).toBe("/sites/s1/history");
  });

  it("credits each version to the write that produced it, version 1 to the owner", () => {
    const versions = siteVersions(site, rows);
    expect(versions.map((v) => v.number)).toEqual([3, 2, 1]);
    expect(versions.map((v) => v.editor?.username)).toEqual(["ben", "ana", "ana"]);
    expect(versions[2].createdAt).toBe(site.created_at);
    expect(versions[0].changed).toEqual(["Sources", "Contour"]);
    expect(versions[1].changed).toEqual(["Name"]);
    expect(versions[2].changed).toBeNull();
    // A version shows no linked events: links have no history.
    expect(versions[1].view?.linked_events).toEqual([]);
  });

  it("holds back the oldest row of an unfinished walk", () => {
    expect(siteVersions(site, [rows[0]], true).map((v) => v.number)).toEqual([3]);
  });

  it("names the kind change", () => {
    expect(siteChangedFields({ ...site, kind: "port" }, site)).toEqual(["Kind"]);
  });
});

describe("saveSiteLinks", () => {
  const alpha = { id: "s1", name: "Alpha", kind: "airbase" as const };
  const bravo = { id: "s2", name: "Bravo", kind: "depot" as const };
  const charlie = { id: "s3", name: "Charlie", kind: "port" as const };

  it("unlinks a dropped site, links a new one, rewrites a new effect and leaves the rest", async () => {
    calls.length = 0;
    await saveSiteLinks(
      "e1",
      [
        { site: alpha, effect: "damage" },
        { site: bravo, effect: "activity" },
        { site: charlie, effect: "other" },
      ],
      [
        { site: bravo, effect: "destruction" },
        { site: charlie, effect: "other" },
        { site: { id: "s4", name: "Delta", kind: "port" }, effect: "damage" },
      ],
    );
    expect(calls).toEqual([
      { path: "/events/e1/site-links/s1", method: "DELETE", body: undefined },
      {
        path: "/events/e1/site-links",
        method: "POST",
        body: JSON.stringify({ site_id: "s2", effect: "destruction" }),
      },
      {
        path: "/events/e1/site-links",
        method: "POST",
        body: JSON.stringify({ site_id: "s4", effect: "damage" }),
      },
    ]);
  });
});

describe("siteSuggestionsNearPath", () => {
  it("carries the point and the query when there are some", () => {
    expect(siteSuggestionsNearPath({ lat: 48.5, lng: 2.25 }, " depot ")).toBe(
      "/sites/suggestions?lat=48.5&lng=2.25&q=depot",
    );
    expect(siteSuggestionsNearPath(null, "")).toBe("/sites/suggestions");
  });
});
