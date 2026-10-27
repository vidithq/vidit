import { describe, expect, it } from "vitest";

import {
  changedFields,
  eventVersion,
  hasVersionChanges,
  eventVersions,
  eventVersionsPath,
  eventVersionHref,
  snapshotToEventView,
  versionLabel,
  type EventVersionFormState,
} from "./events";
import type { Source } from "./sources";
import { parseVersionSegment } from "./versions";
import { snapshotSource, source } from "@/test/eventDetail";
import type { EventDetail, EventVersion } from "@/types";

const WAYBACK = "https://web.archive.org/web/2026/https://t.me/channel/4242";
const ARCHIVE_TODAY = "https://archive.ph/two";

const FOOTAGE: Source = source({
  id: "s1",
  kind: "drone",
  captured_at: "2026-05-09T15:40:00Z",
  links: [
    {
      url: "https://t.me/channel/4242",
      posted_at: "2026-05-09T15:45:00Z",
      archived: { url: WAYBACK, provider: "wayback", archived_at: "2026-06-01T00:00:00Z" },
    },
  ],
  media: {
    id: "m1",
    role: "source",
    kind: "image",
    sha256: "0",
    storage_url: "https://m/source.jpg",
  },
});

const MIRRORS: Source = source({
  id: "s2",
  level: "context",
  links: [
    { url: "https://t.me/mirror/1", posted_at: null, archived: null },
    {
      url: "https://t.me/mirror/2",
      posted_at: null,
      archived: { url: ARCHIVE_TODAY, provider: "archive_today", archived_at: "2026-06-01T00:00:00Z" },
    },
  ],
});

const CURRENT: EventDetail = {
  id: "e1",
  title: "v3 title",
  coords: { lat: 48.0159, lng: 37.8024 },
  occurred_date: "2026-05-09",
  occurred_time: "15:45:00",
  is_graphic: false,
  status: "geolocated",
  version_no: 3,
  close_reason: null,
  before_closed_status: null,
  owner: { id: "a1", username: "analyst", avatar_url: null },
  tags: [{ id: "t2", name: "Drone" }],
  conflicts: [
    {
      id: "c1",
      name: "Russian invasion of Ukraine",
      wikidata_id: null,
      start_year: 2022,
      end_year: null,
      is_ongoing: true,
      tier: "major",
    },
  ],
  sources: [FOOTAGE, MIRRORS],
  detected_from_url: null,
  detected_via: null,
  proof: '<img src="https://m/c.jpg">',
  created_at: "2026-06-01T00:00:00Z",
  // Apart from `created_at`: submitted at midnight, published nine hours later; version 1 is the publication.
  geolocated_at: "2026-06-01T09:00:00Z",
  closed_at: null,
  thumbnail: FOOTAGE.media,
  requested_by: null,
  geolocators: [],
};

const BOB = { id: "a2", username: "bob", avatar_url: null };

/** A filed version: `version_no` is the version it holds; byline, date and note are the edit
 *  that superseded it. */
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

/** The snapshot shape `services/versions.build_snapshot` files: the live row's own sources,
 *  spelled as the snapshot spells instants, under an older title and proof. */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "v2 title",
    coords: { lat: 48.0159, lng: 37.8024 },
    occurred_date: "2026-05-09",
    occurred_time: "15:45:00",
    sources: [
      {
        ...snapshotSource(FOOTAGE),
        captured_at: "2026-05-09T15:40:00+00:00",
        links: [
          {
            url: "https://t.me/channel/4242",
            posted_at: "2026-05-09T15:45:00+00:00",
            snapshot_url: WAYBACK,
            archived_at: "2026-06-01T00:00:00+00:00",
          },
        ],
      },
      snapshotSource(MIRRORS),
    ],
    tags: [{ id: "t2", name: "Drone" }],
    conflicts: [{ id: "c1", name: "Russian invasion of Ukraine" }],
    proof: '<img src="https://m/b.jpg">',
    proof_media: [
      { id: "pm1", storage_url: "https://m/b.jpg", kind: "image", original_filename: null },
    ],
    ...overrides,
  };
}

/** The snapshot's sources with the first one changed by `patch`. */
const withFootage = (patch: Record<string, unknown>) => {
  const [first, ...rest] = snapshot().sources as Record<string, unknown>[];
  return [{ ...first, ...patch }, ...rest];
};

/** Everything but the field under test pinned to the live row. */
const pinned = { title: "v3 title", proof: '<img src="https://m/c.jpg">' };

describe("parseVersionSegment", () => {
  it("reads the number out of a version segment", () => {
    expect(parseVersionSegment("v0")).toBe(0);
    expect(parseVersionSegment("v1")).toBe(1);
    expect(parseVersionSegment("v42")).toBe(42);
  });

  it("refuses anything that is not a version address", () => {
    for (const segment of ["edit", "history", "v", "v00", "v01", "v-1", "1", "v1x", ""]) {
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
    expect(view.tags).toEqual([{ id: "t2", name: "Drone" }]);
  });

  it("keeps the row's identity from the current row", () => {
    expect(view.id).toBe(CURRENT.id);
    expect(view.owner).toEqual(CURRENT.owner);
  });

  it("shows the sources as that version held them", () => {
    const older = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          sources: withFootage({
            media: { id: "m0", kind: "video", sha256: "0", storage_url: "https://m/old.mp4" },
          }),
        })
      )
    );
    expect(older.sources.map((s) => s.media?.storage_url ?? null)).toEqual([
      "https://m/old.mp4",
      null,
    ]);
    // The preview is the first source file, as the server picks it.
    expect(older.thumbnail?.storage_url).toBe("https://m/old.mp4");
    expect(older.sources[0].kind).toBe("drone");
  });

  it("previews the first proof image when no source has a file", () => {
    const fileless = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ sources: [snapshotSource(MIRRORS)] }))
    );
    expect(fileless.thumbnail?.storage_url).toBe("https://m/b.jpg");
  });

  it("reads an archived copy's provider off its snapshot host", () => {
    expect(view.sources[0].links[0].archived).toMatchObject({ url: WAYBACK, provider: "wayback" });
    expect(view.sources[1].links[1].archived).toMatchObject({ provider: "archive_today" });
    expect(view.sources[1].links[0].archived).toBeNull();
  });

  it("ratchets a source's graphic flag against the live source showing the same file", () => {
    const flagged = { ...CURRENT, sources: [{ ...FOOTAGE, is_graphic: true }, MIRRORS] };
    const filed = snapshotToEventView(flagged, row(2, snapshot()));
    expect(filed.sources[0].is_graphic).toBe(true);
    expect(filed.is_graphic).toBe(true);
    expect(view.is_graphic).toBe(false);
  });

  it("resolves a conflict through the referential and falls back on its stored name", () => {
    expect(view.conflicts[0]).toEqual(CURRENT.conflicts[0]);
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
    expect(blanked.coords).toBeNull();
    expect(blanked.proof).toBeNull();
    expect(blanked.tags).toEqual([]);
    expect(blanked.sources).toEqual([]);
  });
});

describe("changedFields", () => {
  const previous = snapshotToEventView(CURRENT, row(2, snapshot()));

  it("names each field the edit moved, in the page's own vocabulary", () => {
    expect(changedFields(CURRENT, previous)).toEqual(["Title", "Proof"]);
  });

  it("says nothing when nothing moved", () => {
    expect(changedFields(previous, previous)).toEqual([]);
  });

  it("reads two spellings of one instant as the same moment", () => {
    // The snapshot writes `+00:00` where the live row writes `Z`; string comparison would flag
    // every version.
    expect(changedFields(CURRENT, previous)).not.toContain("Sources");
  });

  it("names a changed source, whatever moved in it", () => {
    for (const patch of [
      { kind: "satellite" },
      { level: "indirect" },
      { title: "Drone footage" },
      { capture_position: { lat: 1, lng: 2 } },
      { media: { id: "m0", kind: "image", sha256: "0", storage_url: "https://m/old.jpg" } },
    ]) {
      const before = snapshotToEventView(
        CURRENT,
        row(2, snapshot({ ...pinned, sources: withFootage(patch) }))
      );
      expect(changedFields(CURRENT, before)).toEqual(["Sources"]);
    }
    // A source added since takes its archived copies with it.
    const added = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ ...pinned, sources: [snapshotSource(MIRRORS)] }))
    );
    expect(changedFields(CURRENT, added)).toEqual(["Sources", "Archived copies"]);
  });

  it("reads reordered sources and links as unchanged", () => {
    const [first, second] = snapshot().sources as Record<string, unknown>[];
    const reordered = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          ...pinned,
          sources: [
            { ...second, links: [...(second.links as unknown[])].reverse() },
            first,
          ],
        })
      )
    );
    expect(changedFields(CURRENT, reordered)).toEqual([]);
  });

  it("compares tags and conflicts by identity, not by name", () => {
    const renamed = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ tags: [{ id: "t2", name: "UAV" }] }))
    );
    expect(changedFields(CURRENT, renamed)).not.toContain("Tags");
  });

  it("compares tags and conflicts as sets, the relationship being unordered", () => {
    const tags: EventDetail["tags"] = [
      { id: "t2", name: "Drone" },
      { id: "t7", name: "Night" },
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

  it("names the archived copies a version recorded, apart from the sources", () => {
    const [first, ...rest] = snapshot().sources as Record<string, unknown>[];
    const unarchived = {
      ...first,
      links: (first.links as Record<string, unknown>[]).map((l) => ({
        ...l,
        snapshot_url: null,
        archived_at: null,
      })),
    };
    const before = snapshotToEventView(
      CURRENT,
      row(2, snapshot({ ...pinned, sources: [unarchived, ...rest] }))
    );
    expect(changedFields(CURRENT, before)).toEqual(["Archived copies"]);
  });

  it("names the moved coordinates and dates", () => {
    const before = snapshotToEventView(
      CURRENT,
      row(
        2,
        snapshot({
          ...pinned,
          coords: { lat: 1, lng: 2 },
          occurred_date: "2026-01-01",
          occurred_time: "09:00:00",
        })
      )
    );
    expect(changedFields(CURRENT, before)).toEqual(["Coordinates", "Event date", "Event time"]);
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
    expect(versions[0].changed).toEqual(["Title", "Proof"]);

    // Version 2 was produced by the edit filed on version 1.
    expect(versions[1].createdAt).toBe("2026-06-02T00:00:00Z");
    expect(versions[1].changed).toEqual(["Title"]);

    // Version 1 was published, not edited: it carries the record's author and publication date,
    // with nothing to compare against.
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
    // Row 1 is the authorship of version 2, which is not whole until the page below loads.
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

describe("version 0", () => {
  const PUBLISHED: EventDetail = {
    ...CURRENT,
    version_no: 2,
    version_zero: "request",
    requested_by: BOB,
  };
  const rows = [row(1, snapshot({ title: "v1 title" })), row(0, snapshot({ title: "Asked" }))];

  it("names version 0 after what the event was published from", () => {
    expect(versionLabel(PUBLISHED, 0)).toBe("Request");
    expect(versionLabel({ version_zero: "detection" }, 0)).toBe("Detection");
    expect(versionLabel(PUBLISHED, 2)).toBe("v2");
  });

  it("walks down to version 0, credited to whoever opened it", () => {
    const versions = eventVersions(PUBLISHED, rows);
    expect(versions.map((v) => v.number)).toEqual([2, 1, 0]);

    // Version 1 is the publish, filed on version 0: its byline and date come from that row,
    // and it compares against what was asked.
    expect(versions[1].editor).toEqual(BOB);
    expect(versions[1].createdAt).toBe("2026-06-01T00:00:00Z");
    expect(versions[1].changed).toContain("Title");

    // Version 0 was opened, not edited: the requester and the creation date.
    expect(versions[2].view?.title).toBe("Asked");
    expect(versions[2].view?.status).toBe("requested");
    expect(versions[2].editor).toEqual(BOB);
    expect(versions[2].createdAt).toBe(PUBLISHED.created_at);
    expect(versions[2].changed).toBeNull();
  });

  it("stops at version 1 for a record with no version 0", () => {
    const versions = eventVersions({ ...CURRENT, version_no: 2 }, [row(1, snapshot())]);
    expect(versions.map((v) => v.number)).toEqual([2, 1]);
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
    // Content landed but the one below did not: the snapshot stands, with nothing about the edit
    // that made it (author and publication date belong to version 1 alone).
    const version = eventVersion(CURRENT, 2, { own: row(2, snapshot()) });
    expect(version.view?.title).toBe("v2 title");
    expect(version.editor).toBeNull();
    expect(version.createdAt).toBeNull();
  });
});

describe("hasVersionChanges", () => {
  /** The form seeded from `CURRENT`: what an untouched edit page posts. */
  const untouched = (
    overrides: Partial<EventVersionFormState> = {}
  ): EventVersionFormState => ({
    title: CURRENT.title,
    sourcesMoved: false,
    lat: String(CURRENT.coords!.lat),
    lng: String(CURRENT.coords!.lng),
    eventDate: CURRENT.occurred_date!,
    // `<input type="time">` holds minutes, the API serves seconds.
    eventTime: CURRENT.occurred_time!.slice(0, 5),
    proof: CURRENT.proof,
    tagIds: CURRENT.tags.map((tag) => tag.id),
    conflictIds: CURRENT.conflicts.map((c) => c.id),
    ...overrides,
  });

  it("reads an untouched form as no change at all", () => {
    expect(hasVersionChanges(CURRENT, untouched())).toBe(false);
  });

  it("reads a moved source list as a change", () => {
    // An upload has no stored value until it lands, so the caller's comparison is the whole fact.
    expect(hasVersionChanges(CURRENT, untouched({ sourcesMoved: true }))).toBe(true);
  });

  it("reads an untouched time as no change, seconds and all", () => {
    const precise: EventDetail = { ...CURRENT, occurred_time: "15:45:27" };
    expect(hasVersionChanges(precise, untouched())).toBe(false);
    expect(hasVersionChanges(precise, untouched({ eventTime: "16:00" }))).toBe(true);
  });

  it("names a moved field, however it moved", () => {
    const moved: Partial<EventVersionFormState>[] = [
      { title: "Corrected title" },
      { lat: "49" },
      { eventDate: "2026-05-10" },
      { eventTime: "16:00" },
      { tagIds: [] },
      { conflictIds: [] },
      { proof: "" },
    ];
    for (const change of moved) {
      expect(hasVersionChanges(CURRENT, untouched(change))).toBe(true);
    }
  });
});
