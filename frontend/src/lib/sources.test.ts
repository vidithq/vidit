import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  firstSourceUrl,
  mergeSourceDrafts,
  newSourceDraft,
  sourceCreatePayload,
  sourceDraftFrom,
  sourceDraftFromPick,
  sourceFloor,
  sourcesChanged,
  sourceWriteError,
  uploadError,
  type SourceDraft,
} from "./sources";
import { source } from "@/test/eventDetail";

const FILE = {
  id: "m1",
  role: "source" as const,
  kind: "image" as const,
  sha256: "0",
  storage_url: "https://cdn/x.jpg",
};

const STORED = source({
  id: "s1",
  sensor: "drone",
  captured_at: "2026-05-09T15:40:27Z",
  camera_position: { lat: 48.1, lng: 37.9 },
  links: [
    {
      url: "https://t.me/c/1",
      posted_at: "2026-05-09T15:45:31Z",
      archived: {
        url: "https://archive.ph/abcde",
        provider: "archive_today",
        archived_at: "2026-06-01T00:00:00Z",
      },
    },
  ],
  tags: [{ id: "t1", name: "armor" }],
  media: FILE,
});

const linked = (url: string, patch: Partial<SourceDraft> = {}): SourceDraft => ({
  ...newSourceDraft(),
  links: [{ url, postedAt: "", snapshotUrl: "", stored: null }],
  ...patch,
});

describe("sourceCreatePayload", () => {
  it("posts a stored source back as it was, with its id, file and archived copy", () => {
    expect(sourceCreatePayload(sourceDraftFrom(STORED))).toEqual({
      id: "s1",
      title: "",
      level: "direct",
      sensor: "drone",
      // An untouched instant keeps its seconds.
      captured_at: "2026-05-09T15:40:27Z",
      camera_position: { lat: 48.1, lng: 37.9 },
      is_graphic: false,
      links: [
        {
          url: "https://t.me/c/1",
          posted_at: "2026-05-09T15:45:31Z",
          snapshot_url: "https://archive.ph/abcde",
        },
      ],
      tag_ids: ["t1"],
      media_id: "m1",
    });
  });

  it("posts an edited instant as typed, read as UTC", () => {
    const draft = { ...sourceDraftFrom(STORED), capturedAt: "2026-05-09T16:00" };
    expect(sourceCreatePayload(draft).captured_at).toBe("2026-05-09T16:00");
  });

  it("drops blank and repeated URLs, and a half-typed camera pair", () => {
    const draft = linked("https://t.me/c/1", { cameraLat: "48.1", cameraLng: "" });
    draft.links.push(
      { url: "  ", postedAt: "", snapshotUrl: "", stored: null },
      { url: " https://t.me/c/1 ", postedAt: "", snapshotUrl: "", stored: null }
    );
    const posted = sourceCreatePayload(draft);
    expect(posted.links.map((l) => l.url)).toEqual(["https://t.me/c/1"]);
    expect(posted.camera_position).toBeNull();
  });

  it("names a staged file by its upload and none while the upload runs", () => {
    const upload = { ...FILE, original_filename: null, id: "u1", expires_at: "2099-01-01T00:00:00Z" };
    expect(
      sourceCreatePayload(linked("https://t.me/c/1", { file: { state: "staged", upload } }))
    ).toMatchObject({ upload_id: "u1" });
    const running = sourceCreatePayload(
      linked("https://t.me/c/1", {
        sensor: "drone",
        file: { state: "uploading", file: new File(["x"], "x.png"), token: 1 },
      })
    );
    expect(running.upload_id).toBeUndefined();
    expect(running.media_id).toBeUndefined();
    // A sensor describes a file: a source without one names none.
    expect(running.sensor).toBeNull();
  });
});

describe("sourceDraftFromPick", () => {
  it("makes a new source that copies the pick's file and keeps its archived copies", () => {
    const pick = { ...STORED, is_graphic: true, event_id: "e9", event_title: "Elsewhere" };
    const draft = sourceDraftFromPick(pick);
    const posted = sourceCreatePayload(draft);
    expect(posted.id).toBeUndefined();
    expect(posted.media_id).toBe("m1");
    expect(posted.is_graphic).toBe(true);
    expect(posted.links[0].snapshot_url).toBe("https://archive.ph/abcde");
    // A new source's flag is not the stored one's to lock.
    expect(draft.graphicLocked).toBe(false);
  });
});

describe("mergeSourceDrafts", () => {
  it("moves the links the kept source lacks and raises its graphic flag", () => {
    const keep = linked("https://t.me/c/1");
    const drop = linked("https://x.com/a/status/1", { isGraphic: true });
    drop.links.push({ url: "https://t.me/c/1", postedAt: "", snapshotUrl: "", stored: null });
    const { merged, overflow } = mergeSourceDrafts(keep, drop);
    expect(merged.key).toBe(keep.key);
    expect(merged.links.map((l) => l.url)).toEqual(["https://t.me/c/1", "https://x.com/a/status/1"]);
    expect(merged.isGraphic).toBe(true);
    expect(overflow).toBe(0);
  });

  it("stops at the link cap and counts what did not fit", () => {
    const keep = linked("https://a.example/0");
    keep.links.push(
      ...Array.from({ length: 8 }, (_, i) => ({
        url: `https://a.example/${i + 1}`,
        postedAt: "",
        snapshotUrl: "",
        stored: null,
      }))
    );
    const drop = linked("https://b.example/1");
    drop.links.push({ url: "https://b.example/2", postedAt: "", snapshotUrl: "", stored: null });
    const { merged, overflow } = mergeSourceDrafts(keep, drop);
    expect(merged.links).toHaveLength(10);
    expect(overflow).toBe(1);
  });
});

describe("sourceFloor", () => {
  it("reads a direct or indirect source with a file as evidence, and a context one not", () => {
    const withFile = linked("https://t.me/c/1", { file: { state: "stored", media: FILE } });
    expect(sourceFloor([withFile]).hasEvidenceFile).toBe(true);
    expect(sourceFloor([{ ...withFile, level: "context" }]).hasEvidenceFile).toBe(false);
  });

  it("flags a source without a URL and a file without a sensor", () => {
    const floor = sourceFloor([
      { ...newSourceDraft(), links: [], file: { state: "stored", media: FILE } },
    ]);
    expect(floor).toEqual({ hasEvidenceFile: true, missingLink: true, missingSensor: true });
  });
});

describe("sourcesChanged", () => {
  it("reads the seeded editors as unchanged", () => {
    expect(sourcesChanged([STORED], [sourceDraftFrom(STORED)])).toBe(false);
  });

  it("reads a moved field, a new copy, a new source or a removed one as a change", () => {
    const draft = sourceDraftFrom(STORED);
    expect(sourcesChanged([STORED], [{ ...draft, sensor: "satellite" }])).toBe(true);
    expect(
      sourcesChanged(
        [STORED],
        [{ ...draft, links: [{ ...draft.links[0], snapshotUrl: "https://archive.ph/other" }] }]
      )
    ).toBe(true);
    expect(sourcesChanged([STORED], [draft, newSourceDraft()])).toBe(true);
    expect(sourcesChanged([STORED], [])).toBe(true);
  });

  it("reads a cleared graphic switch on a flagged source as no change", () => {
    const flagged = { ...STORED, is_graphic: true };
    expect(sourcesChanged([flagged], [{ ...sourceDraftFrom(flagged), isGraphic: false }])).toBe(
      false
    );
  });
});

describe("sourceWriteError", () => {
  it("reads a source error code as its form sentence and leaves the rest to the server", () => {
    expect(sourceWriteError(new ApiError("x", 400, "upload_expired"))).toMatch(/expired/);
    expect(sourceWriteError(new ApiError("Something", 400, "invalid_state"))).toBeUndefined();
  });
});

describe("uploadError", () => {
  it("names the staging cap, and keeps any other refusal's own words", () => {
    expect(uploadError(new ApiError("x", 429, "too_many_uploads"))).toMatch(/too many source files/);
    expect(uploadError(new ApiError("This file type is not allowed.", 400, "invalid_file"))).toBe(
      "This file type is not allowed."
    );
  });
});

describe("firstSourceUrl", () => {
  it("reads the first link of the first source that has one", () => {
    expect(firstSourceUrl({ sources: [source({ links: [] }), STORED] })).toBe("https://t.me/c/1");
    expect(firstSourceUrl({ sources: [] })).toBeNull();
  });
});
