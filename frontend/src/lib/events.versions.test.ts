import { describe, expect, it } from "vitest";

import {
  changedFields,
  eventVersion,
  eventVersions,
  eventRevisionsPath,
  eventVersionHref,
  parseVersionSegment,
  snapshotToEventView,
} from "./events";
import type { EventDetail, EventRevision } from "@/types";

const CURRENT: EventDetail = {
  id: "e1",
  title: "v3 title",
  event_coords: { lat: 48.0159, lng: 37.8024 },
  capture_source_coords: null,
  archived_source: { url: "https://web.archive.org/x", provider: "wayback" },
  event_date: "2026-05-09",
  event_time: "15:45:00",
  is_graphic: false,
  status: "geolocated",
  revision_no: 3,
  close_reason: null,
  before_closed_status: null,
  owner: { id: "a1", username: "analyst", avatar_url: null },
  tags: [{ id: "t2", name: "Drone", category: "capture_source" }],
  conflicts: [
    {
      id: "c1",
      name: "Russian invasion of Ukraine",
      wikidata_id: null,
      start_year: 2022,
      end_year: null,
      ongoing: true,
      tier: "major",
    },
  ],
  source_url: "https://t.me/channel/4242",
  secondary_source_urls: ["https://t.me/mirror/1", "https://t.me/mirror/2"],
  archived_secondary_sources: [
    null,
    { url: "https://archive.ph/two", provider: "archive_today" },
  ],
  source_posted_at: "2026-05-09T15:45:00Z",
  detected_from_url: null,
  detected_via: null,
  archived_detected_from: null,
  detected_post_at: null,
  proof: { type: "doc", content: [{ type: "image", attrs: { src: "https://m/c.jpg" } }] },
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-04T00:00:00Z",
  requested_at: null,
  detected_at: null,
  // Deliberately apart from `created_at`: the record was submitted at midnight
  // and published nine hours later, and version 1 is the publication.
  geolocated_at: "2026-06-01T09:00:00Z",
  closed_at: null,
  media: [
    {
      id: "m1",
      role: "source",
      media_type: "image",
      storage_url: "https://m/source.jpg",
    },
  ],
  thumbnail: null,
  requested_by: null,
  geolocators: [],
};

const BOB = { id: "a2", username: "bob", avatar_url: null };

/** A filed version: `revision_no` is the version it holds, and the byline, date
 *  and note are the edit that superseded it. */
function revision(
  revisionNo: number,
  snapshot: Record<string, unknown>,
  extra: Partial<EventRevision> = {}
): EventRevision {
  return {
    id: `r${revisionNo}`,
    revision_no: revisionNo,
    edited_by: BOB,
    note: null,
    created_at: `2026-06-0${revisionNo + 1}T00:00:00Z`,
    snapshot,
    redacted: false,
    ...extra,
  };
}

/** The snapshot shape `services/revisions.build_snapshot` files. */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "v2 title",
    event_coords: { lat: 48.0159, lng: 37.8024 },
    capture_source_coords: null,
    event_date: "2026-05-09",
    event_time: "15:45:00",
    source_posted_at: "2026-05-09T15:45:00+00:00",
    is_graphic: false,
    secondary_source_urls: ["https://t.me/mirror/2", "https://t.me/mirror/1"],
    tags: [{ id: "t2", name: "Drone", category: "capture_source" }],
    conflicts: [{ id: "c1", name: "Russian invasion of Ukraine" }],
    proof: { type: "doc", content: [{ type: "image", attrs: { src: "https://m/b.jpg" } }] },
    proof_media: [
      {
        id: "pm1",
        storage_url: "https://m/b.jpg",
        media_type: "image",
        original_filename: null,
      },
    ],
    ...overrides,
  };
}

describe("parseVersionSegment", () => {
  it("reads the number out of a version segment", () => {
    expect(parseVersionSegment("v1")).toBe(1);
    expect(parseVersionSegment("v42")).toBe(42);
  });

  it("refuses anything that is not a version address", () => {
    for (const segment of ["edit", "history", "v", "v0", "v01", "v-1", "1", "v1x", ""]) {
      expect(parseVersionSegment(segment)).toBeNull();
    }
  });
});

describe("paths", () => {
  it("carries a cursor only when the walk has one", () => {
    expect(eventRevisionsPath("e1", null)).toBe("/events/e1/revisions");
    expect(eventRevisionsPath("e1", "abc")).toBe("/events/e1/revisions?cursor=abc");
  });

  it("addresses a version as one path segment", () => {
    expect(eventVersionHref("e1", 2)).toBe("/events/e1/v2");
  });
});

describe("snapshotToEventView", () => {
  const view = snapshotToEventView(CURRENT, revision(2, snapshot()));

  it("overlays the versioned fields", () => {
    expect(view.title).toBe("v2 title");
    expect(view.revision_no).toBe(2);
    expect(view.proof).toEqual(snapshot().proof);
    expect(view.tags).toEqual([{ id: "t2", name: "Drone", category: "capture_source" }]);
  });

  it("keeps the immutables from the current row", () => {
    expect(view.id).toBe(CURRENT.id);
    expect(view.owner).toEqual(CURRENT.owner);
    expect(view.source_url).toBe(CURRENT.source_url);
    expect(view.media).toEqual(CURRENT.media);
    expect(view.archived_source).toEqual(CURRENT.archived_source);
  });

  it("pairs each mirror with the copy archived for that URL, not its position", () => {
    // The version listed the two mirrors in the other order, so a positional
    // copy would hand mirror 2's snapshot to mirror 1.
    expect(view.secondary_source_urls).toEqual([
      "https://t.me/mirror/2",
      "https://t.me/mirror/1",
    ]);
    expect(view.archived_secondary_sources).toEqual([
      { url: "https://archive.ph/two", provider: "archive_today" },
      null,
    ]);
  });

  it("resolves a conflict through the referential and falls back on its stored name", () => {
    expect(snapshotToEventView(CURRENT, revision(2, snapshot())).conflicts[0]).toEqual(
      CURRENT.conflicts[0]
    );
    const gone = snapshotToEventView(
      CURRENT,
      revision(2, snapshot({ conflicts: [{ id: "c9", name: "A deleted conflict" }] }))
    );
    expect(gone.conflicts[0].name).toBe("A deleted conflict");
    expect(gone.conflicts[0].start_year).toBeNull();
  });

  it("maps a redacted version's empty snapshot to empty content, not a throw", () => {
    const blanked = snapshotToEventView(CURRENT, revision(2, {}, { redacted: true }));
    expect(blanked.title).toBe(CURRENT.title);
    expect(blanked.event_coords).toBeNull();
    expect(blanked.proof).toBeNull();
    expect(blanked.tags).toEqual([]);
    expect(blanked.secondary_source_urls).toEqual([]);
  });
});

describe("changedFields", () => {
  const previous = snapshotToEventView(CURRENT, revision(2, snapshot()));

  it("names each field the edit moved, in the page's own vocabulary", () => {
    expect(changedFields(CURRENT, previous)).toEqual([
      "Title",
      "Secondary sources",
      "Proof",
      "Proof images",
    ]);
  });

  it("says nothing when nothing moved", () => {
    expect(changedFields(previous, previous)).toEqual([]);
  });

  it("reads two spellings of one instant as the same moment", () => {
    // The snapshot writes `+00:00` where the live row writes `Z`; a string
    // comparison would report the source post time as edited on every version.
    expect(changedFields(CURRENT, previous)).not.toContain("Source posted");
  });

  it("compares tags and conflicts by identity, not by name", () => {
    const renamed = snapshotToEventView(
      CURRENT,
      revision(2, snapshot({ tags: [{ id: "t2", name: "UAV", category: "capture_source" }] }))
    );
    expect(changedFields(CURRENT, renamed)).not.toContain("Tags");
  });

  it("compares tags and conflicts as sets, the relationship being unordered", () => {
    const tags: EventDetail["tags"] = [
      { id: "t2", name: "Drone", category: "capture_source" },
      { id: "t7", name: "Night", category: "free" },
    ];
    const conflicts: EventDetail["conflicts"] = [
      CURRENT.conflicts[0],
      { ...CURRENT.conflicts[0], id: "c2", name: "War in Sudan" },
    ];
    const version = { ...CURRENT, tags, conflicts };
    const reordered = {
      ...CURRENT,
      tags: [...tags].reverse(),
      conflicts: [...conflicts].reverse(),
    };
    expect(changedFields(version, reordered)).toEqual([]);
  });

  it("names the moved coordinates, dates, graphic flag and camera position", () => {
    const before = snapshotToEventView(
      CURRENT,
      revision(
        2,
        snapshot({
          title: CURRENT.title,
          proof: CURRENT.proof,
          secondary_source_urls: CURRENT.secondary_source_urls,
          event_coords: { lat: 1, lng: 2 },
          capture_source_coords: { lat: 3, lng: 4 },
          event_date: "2026-01-01",
          event_time: "09:00:00",
          is_graphic: true,
        })
      )
    );
    expect(changedFields(CURRENT, before)).toEqual([
      "Coordinates",
      "Camera position",
      "Event date",
      "Event time",
      "Graphic flag",
    ]);
  });
});

describe("eventVersions", () => {
  const rows = [revision(2, snapshot(), { note: "fixed the title" }), revision(1, snapshot({ title: "v1 title" }))];

  it("describes each version by the edit that produced it", () => {
    const versions = eventVersions(CURRENT, rows);
    expect(versions.map((v) => v.number)).toEqual([3, 2, 1]);

    // Version 3 is the live row, produced by the edit filed on version 2.
    expect(versions[0].current).toBe(true);
    expect(versions[0].view).toBe(CURRENT);
    expect(versions[0].editor).toEqual(BOB);
    expect(versions[0].createdAt).toBe("2026-06-03T00:00:00Z");
    expect(versions[0].note).toBe("fixed the title");
    expect(versions[0].changed).toEqual([
      "Title",
      "Secondary sources",
      "Proof",
      "Proof images",
    ]);

    // Version 2 was produced by the edit filed on version 1.
    expect(versions[1].createdAt).toBe("2026-06-02T00:00:00Z");
    expect(versions[1].changed).toEqual(["Title"]);

    // Version 1 was published, not edited: it carries the record's own author
    // and the date it was published, and nothing preceded it to compare
    // against.
    expect(versions[2].editor).toEqual(CURRENT.owner);
    expect(versions[2].createdAt).toBe(CURRENT.geolocated_at);
    expect(versions[2].createdAt).not.toBe(CURRENT.created_at);
    expect(versions[2].note).toBeNull();
    expect(versions[2].changed).toBeNull();
  });

  it("renders a single version for a record nobody has corrected", () => {
    const versions = eventVersions({ ...CURRENT, revision_no: 1 }, []);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ number: 1, current: true, changed: null });
    expect(versions[0].editor).toEqual(CURRENT.owner);
  });

  it("holds the oldest row back while the walk has pages left", () => {
    // Row 1 is the authorship of version 2, so version 2 is not whole until the
    // page below it has been loaded.
    const partial = eventVersions(CURRENT, [rows[0]], true);
    expect(partial.map((v) => v.number)).toEqual([3]);
    // Once the walk is exhausted the held-back row becomes a version of its own.
    expect(eventVersions(CURRENT, rows, false).map((v) => v.number)).toEqual([3, 2, 1]);
  });

  it("marks a redacted version and compares nothing against it", () => {
    const versions = eventVersions(CURRENT, [
      revision(2, {}, { redacted: true, note: null }),
      revision(1, snapshot({ title: "v1 title" })),
    ]);
    expect(versions[1]).toMatchObject({ number: 2, redacted: true, view: null, changed: null });
    // The version above it keeps its byline and loses only its comparison.
    expect(versions[0].editor).toEqual(BOB);
    expect(versions[0].changed).toBeNull();
  });
});

describe("eventVersion", () => {
  it("assembles one version from the two rows that describe it", () => {
    const version = eventVersion(CURRENT, 2, {
      own: revision(2, snapshot()),
      producedBy: revision(1, snapshot({ title: "v1 title" }), { note: "why" }),
    });
    expect(version).toMatchObject({
      number: 2,
      current: false,
      redacted: false,
      note: "why",
      changed: null,
    });
    expect(version.view?.title).toBe("v2 title");
  });

  it("states neither byline nor date when the producing row could not be read", () => {
    // The content read landed and the one below it did not, so the version has
    // its snapshot and nothing to say about the edit that made it. The
    // record's own author and publication date belong to version 1 alone.
    const version = eventVersion(CURRENT, 2, { own: revision(2, snapshot()) });
    expect(version.view?.title).toBe("v2 title");
    expect(version.editor).toBeNull();
    expect(version.createdAt).toBeNull();
  });
});
