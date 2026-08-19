import { describe, expect, it } from "vitest";

import {
  changedFields,
  eventVersion,
  hasVersionChanges,
  eventVersions,
  eventVersionsPath,
  eventVersionHref,
  parseVersionSegment,
  snapshotToEventView,
  type EventVersionFormState,
} from "./events";
import type { EventDetail, EventVersion } from "@/types";

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
  version_no: 3,
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
  proof: { type: "doc", content: [{ type: "image", attrs: { src: "https://m/c.jpg" } }] },
  created_at: "2026-06-01T00:00:00Z",
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

/** A filed version: `version_no` is the version it holds, and the byline, date
 *  and note are the edit that superseded it. */
function row(
  versionNo: number,
  snapshot: Record<string, unknown>,
  extra: Partial<EventVersion> = {}
): EventVersion {
  return {
    id: `r${versionNo}`,
    version_no: versionNo,
    edited_by: BOB,
    note: null,
    created_at: `2026-06-0${versionNo + 1}T00:00:00Z`,
    snapshot,
    redacted: false,
    ...extra,
  };
}

/** The snapshot shape `services/versions.build_snapshot` files. */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "v2 title",
    source_url: "https://t.me/channel/4242",
    source_media: [
      {
        id: "m1",
        role: "source",
        media_type: "image",
        storage_url: "https://m/source.jpg",
      },
    ],
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
    // The copies this version held, the set the current row still carries.
    archives: [
      {
        original_url: "https://t.me/channel/4242",
        origin: "source_url",
        snapshot_url: "https://web.archive.org/x",
        provider: "wayback",
        created_at: "2026-06-01T00:00:00+00:00",
      },
      {
        original_url: "https://t.me/mirror/2",
        origin: "secondary_source",
        snapshot_url: "https://archive.ph/two",
        provider: "archive_today",
        created_at: "2026-06-01T00:00:00+00:00",
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
    expect(eventVersionsPath("e1", null)).toBe("/events/e1/versions");
    expect(eventVersionsPath("e1", "abc")).toBe("/events/e1/versions?cursor=abc");
  });

  it("addresses a version as one path segment", () => {
    expect(eventVersionHref("e1", 2)).toBe("/events/e1/v2");
  });
});

describe("snapshotToEventView", () => {
  const view = snapshotToEventView(CURRENT, row(2, snapshot()));

  it("overlays the versioned fields", () => {
    expect(view.title).toBe("v2 title");
    expect(view.version_no).toBe(2);
    expect(view.proof).toEqual(snapshot().proof);
    expect(view.tags).toEqual([{ id: "t2", name: "Drone", category: "capture_source" }]);
  });

  it("keeps the row's identity from the current row", () => {
    expect(view.id).toBe(CURRENT.id);
    expect(view.owner).toEqual(CURRENT.owner);
  });

  it("shows the evidence anchor as that version held it", () => {
    // The anchor is versioned, so a version that rested on another source
    // renders that source and that media, not the ones that replaced them. The
    // media row itself is gone by then (an event carries one source media), so
    // the snapshot's own fragment is what the page renders.
    const superseded = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          source_url: "https://t.me/channel/1",
          source_media: [
            {
              id: "m0",
              role: "source",
              media_type: "video",
              storage_url: "https://m/old.mp4",
            },
          ],
        })
      )
    );
    expect(superseded.source_url).toBe("https://t.me/channel/1");
    expect(superseded.media.map((m) => m.id)).toEqual(["m0"]);
    expect(superseded.thumbnail?.storage_url).toBe("https://m/old.mp4");
  });

  it("stands the live row's anchor in for a version that files none", () => {
    // A version filed before the anchor was versioned states nothing about it,
    // so the live row answers for it rather than the page blanking the section.
    const legacy = { ...snapshot() };
    delete legacy.source_url;
    delete legacy.source_media;
    const filed = snapshotToEventView(CURRENT, row(2, legacy));
    expect(filed.source_url).toBe(CURRENT.source_url);
    expect(filed.media).toEqual(CURRENT.media);
  });

  it("ratchets the graphic flag against the live row", () => {
    // A version page renders the live media, so a flag raised after this
    // version was filed still covers what the page shows: the gate can only
    // tighten, never come off for an older version.
    const flagged = { ...CURRENT, is_graphic: true };
    expect(snapshotToEventView(flagged, row(2, snapshot())).is_graphic).toBe(true);
    // And a version filed while the flag was up keeps it on an unflagged row:
    // that is the version's own fact.
    expect(
      snapshotToEventView(CURRENT, row(2, snapshot({ is_graphic: true }))).is_graphic
    ).toBe(true);
    expect(view.is_graphic).toBe(false);
  });

  it("shows the archived copies as that version held them", () => {
    expect(view.archived_source).toEqual(CURRENT.archived_source);
    const unarchived = snapshotToEventView(CURRENT, row(2, snapshot({ archives: [] })));
    expect(unarchived.archived_source).toBeNull();
    expect(unarchived.archived_secondary_sources).toEqual([null, null]);
  });

  it("stands the live row's copies in for a version that files none", () => {
    // A version filed before the copies were versioned says nothing about
    // them, so it is not read as a record that had none.
    const legacy = { ...snapshot() };
    delete legacy.archives;
    const filed = snapshotToEventView(CURRENT, row(2, legacy));
    expect(filed.archived_source).toEqual(CURRENT.archived_source);
    expect(filed.archived_secondary_sources).toEqual([
      { url: "https://archive.ph/two", provider: "archive_today" },
      null,
    ]);
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
    expect(snapshotToEventView(CURRENT, row(2, snapshot())).conflicts[0]).toEqual(
      CURRENT.conflicts[0]
    );
    const gone = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ conflicts: [{ id: "c9", name: "A deleted conflict" }] }))
    );
    expect(gone.conflicts[0].name).toBe("A deleted conflict");
    expect(gone.conflicts[0].start_year).toBeNull();
  });

  it("maps a redacted version's empty snapshot to empty content, not a throw", () => {
    const blanked = snapshotToEventView(CURRENT, row(2, {}, { redacted: true }));
    expect(blanked.title).toBe(CURRENT.title);
    expect(blanked.event_coords).toBeNull();
    expect(blanked.proof).toBeNull();
    expect(blanked.tags).toEqual([]);
    expect(blanked.secondary_source_urls).toEqual([]);
  });
});

describe("changedFields", () => {
  const previous = snapshotToEventView(CURRENT, row(2, snapshot()));

  it("names each field the edit moved, in the page's own vocabulary", () => {
    expect(changedFields(CURRENT, previous)).toEqual([
      "Title",
      "Secondary sources",
      "Proof",
    ]);
  });

  it("says nothing when nothing moved", () => {
    expect(changedFields(previous, previous)).toEqual([]);
  });

  it("names a corrected evidence anchor", () => {
    // Both halves are versioned, and each is named on its own: correcting the
    // link the record cites is not the same edit as replacing the footage.
    const unchanged = {
      title: CURRENT.title,
      proof: CURRENT.proof,
      secondary_source_urls: CURRENT.secondary_source_urls,
    };
    const otherLink = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ ...unchanged, source_url: "https://t.me/channel/1" }))
    );
    // The copies move with it: a copy covers a link, so the one filed against
    // the version's own source is not a copy of the source the record cites now.
    expect(changedFields(CURRENT, otherLink)).toEqual(["Source URL", "Archived copies"]);

    const otherMedia = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          ...unchanged,
          source_media: [
            {
              id: "m0",
              role: "source",
              media_type: "image",
              storage_url: "https://m/old.jpg",
            },
          ],
        })
      )
    );
    expect(changedFields(CURRENT, otherMedia)).toEqual(["Source media"]);
  });

  it("reads two spellings of one instant as the same moment", () => {
    // The snapshot writes `+00:00` where the live row writes `Z`; a string
    // comparison would report the source post time as edited on every version.
    expect(changedFields(CURRENT, previous)).not.toContain("Source posted");
  });

  it("compares tags and conflicts by identity, not by name", () => {
    const renamed = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ tags: [{ id: "t2", name: "UAV", category: "capture_source" }] }))
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

  it("names the archived copies a version recorded", () => {
    // Everything else pinned to the current row, so the copy is the one move.
    const unchanged = {
      title: CURRENT.title,
      proof: CURRENT.proof,
      secondary_source_urls: CURRENT.secondary_source_urls,
    };
    const before = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ ...unchanged, archives: [] }))
    );
    expect(changedFields(CURRENT, before)).toEqual(["Archived copies"]);

    // Same copies in the other order is not an edit: the set is keyed by the
    // link each copy covers, not by its position.
    const reordered = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          ...unchanged,
          archives: [...(snapshot().archives as unknown[])].reverse(),
        })
      )
    );
    expect(changedFields(CURRENT, reordered)).toEqual([]);
  });

  it("names the archived copies when one link's snapshot was corrected", () => {
    const corrected = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          title: CURRENT.title,
          proof: CURRENT.proof,
          secondary_source_urls: CURRENT.secondary_source_urls,
          archives: [
            {
              original_url: CURRENT.source_url,
              origin: "source_url",
              snapshot_url: "https://archive.ph/wrong",
              provider: "archive_today",
              created_at: "2026-06-01T00:00:00+00:00",
            },
            {
              original_url: "https://t.me/mirror/2",
              origin: "secondary_source",
              snapshot_url: "https://archive.ph/two",
              provider: "archive_today",
              created_at: "2026-06-01T00:00:00+00:00",
            },
          ],
        })
      )
    );
    expect(changedFields(CURRENT, corrected)).toEqual(["Archived copies"]);
  });

  it("names the moved coordinates, dates, graphic flag and camera position", () => {
    const before = snapshotToEventView(
      CURRENT,
      row(
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
  const rows = [row(2, snapshot(), { note: "fixed the title" }), row(1, snapshot({ title: "v1 title" }))];

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
    const versions = eventVersions({ ...CURRENT, version_no: 1 }, []);
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
      row(2, {}, { redacted: true, note: null }),
      row(1, snapshot({ title: "v1 title" })),
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
      own: row(2, snapshot()),
      producedBy: row(1, snapshot({ title: "v1 title" }), { note: "why" }),
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
    const version = eventVersion(CURRENT, 2, { own: row(2, snapshot()) });
    expect(version.view?.title).toBe("v2 title");
    expect(version.editor).toBeNull();
    expect(version.createdAt).toBeNull();
  });
});

describe("hasVersionChanges", () => {
  /** The form as it is seeded from `CURRENT`: every input holding what the row
   *  holds, which is what an untouched edit page posts. */
  const untouched = (
    overrides: Partial<EventVersionFormState> = {}
  ): EventVersionFormState => ({
    title: CURRENT.title,
    sourceUrl: CURRENT.source_url!,
    sourceMediaMoved: false,
    lat: String(CURRENT.event_coords!.lat),
    lng: String(CURRENT.event_coords!.lng),
    captureLat: "",
    captureLng: "",
    eventDate: CURRENT.event_date!,
    // `<input type="time">` holds minutes, the API serves seconds.
    eventTime: CURRENT.event_time!.slice(0, 5),
    // `toDatetimeLocalUTC` renders the stored instant as a naive UTC clock.
    sourcePostedAt: "2026-05-09T15:45",
    isGraphic: CURRENT.is_graphic,
    proof: CURRENT.proof as Record<string, unknown>,
    tagIds: CURRENT.tags.map((tag) => tag.id),
    conflictIds: CURRENT.conflicts.map((c) => c.id),
    secondarySourceUrls: [...CURRENT.secondary_source_urls],
    secondarySnapshotUrls: CURRENT.secondary_source_urls.map(() => ""),
    sourceSnapshotUrl: "",
    detectedFromSnapshotUrl: "",
    ...overrides,
  });

  it("reads an untouched form as no change at all", () => {
    expect(hasVersionChanges(CURRENT, untouched())).toBe(false);
  });

  it("reads a corrected source URL as a change, and a blank one as none", () => {
    expect(
      hasVersionChanges(CURRENT, untouched({ sourceUrl: "https://t.me/channel/9" }))
    ).toBe(true);
    // Blank keeps the stored source, the way an omitted field does server side,
    // so it is not a correction to it.
    expect(hasVersionChanges(CURRENT, untouched({ sourceUrl: "" }))).toBe(false);
  });

  it("reads a staged source-media swap as a change", () => {
    // The file has no URL until it lands, so the staging is the whole fact.
    expect(hasVersionChanges(CURRENT, untouched({ sourceMediaMoved: true }))).toBe(true);
  });

  it("reads an untouched lossy input as no change, seconds and all", () => {
    // Both inputs hold less than their column does: the time input drops the
    // seconds and the datetime input stops at the minute. A form still holding
    // what the row seeded it with is untouched however much precision the row
    // carries, so neither reads as an edit and neither is posted back.
    const precise: EventDetail = {
      ...CURRENT,
      source_posted_at: "2026-05-09T15:45:27Z",
      event_time: "15:45:27",
    };
    expect(hasVersionChanges(precise, untouched())).toBe(false);
    // Blank reads as no change too, the way the endpoint reads an absent field.
    expect(hasVersionChanges(precise, untouched({ sourcePostedAt: "" }))).toBe(false);
    // A minute the analyst actually moved is still a change.
    expect(
      hasVersionChanges(precise, untouched({ sourcePostedAt: "2026-05-09T16:00" }))
    ).toBe(true);
    expect(hasVersionChanges(precise, untouched({ eventTime: "16:00" }))).toBe(true);
  });

  it("names a moved field, however it moved", () => {
    const moved: Partial<EventVersionFormState>[] = [
      { title: "Corrected title" },
      { lat: "49" },
      { captureLat: "48.1", captureLng: "37.9" },
      { eventDate: "2026-05-10" },
      { eventTime: "16:00" },
      { sourcePostedAt: "2026-05-09T16:00" },
      { isGraphic: true },
      { tagIds: [] },
      { conflictIds: [] },
      { secondarySourceUrls: ["https://t.me/mirror/1"] },
      { proof: { type: "doc", content: [] } },
    ];
    for (const change of moved) {
      expect(hasVersionChanges(CURRENT, untouched(change))).toBe(true);
    }
  });

  it("counts a new archived copy and ignores a re-paste of the stored one", () => {
    // Mirror 2 already holds this copy, so pasting it again moves nothing.
    expect(
      hasVersionChanges(
        CURRENT,
        untouched({ secondarySnapshotUrls: ["", "https://archive.ph/two"] })
      )
    ).toBe(false);
    // Mirror 1 holds none, so a paste beside it is a change on its own.
    expect(
      hasVersionChanges(
        CURRENT,
        untouched({ secondarySnapshotUrls: ["https://archive.ph/one", ""] })
      )
    ).toBe(true);
    // And a corrected copy of the source is one too.
    expect(
      hasVersionChanges(
        CURRENT,
        untouched({ sourceSnapshotUrl: "https://web.archive.org/corrected" })
      )
    ).toBe(true);
  });
});
