import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  isImportableLink,
  capturePositionInvalid,
  firstSourceUrl,
  isEvidenceLevel,
  SOURCE_LEVELS,
  newSourceDraft,
  sourceCreatePayload,
  sourceDraftFrom,
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
  kind: "drone",
  captured_at: "2026-05-09T15:40:27Z",
  capture_position: { lat: 48.1, lng: 37.9 },
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
      kind: "drone",
      // An untouched instant keeps its seconds.
      captured_at: "2026-05-09T15:40:27Z",
      capture_position: { lat: 48.1, lng: 37.9 },
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
      upload_id: null,
    });
  });

  it("posts an edited instant as typed, read as UTC", () => {
    const draft = { ...sourceDraftFrom(STORED), capturedAt: "2026-05-09T16:00" };
    expect(sourceCreatePayload(draft).captured_at).toBe("2026-05-09T16:00");
  });

  it("drops blank and repeated URLs, and a half-typed capture pair", () => {
    const draft = linked("https://t.me/c/1", { captureLat: "48.1", captureLng: "" });
    draft.links.push(
      { url: "  ", postedAt: "", snapshotUrl: "", stored: null },
      { url: " https://t.me/c/1 ", postedAt: "", snapshotUrl: "", stored: null }
    );
    const posted = sourceCreatePayload(draft);
    expect(posted.links.map((l) => l.url)).toEqual(["https://t.me/c/1"]);
    expect(posted.capture_position).toBeNull();
  });

  it("names a staged file by its upload and none while the upload runs", () => {
    const upload = { ...FILE, original_filename: null, id: "u1", expires_at: "2099-01-01T00:00:00Z" };
    expect(
      sourceCreatePayload(linked("https://t.me/c/1", { file: { state: "staged", upload } }))
    ).toMatchObject({ upload_id: "u1" });
    const running = sourceCreatePayload(
      linked("https://t.me/c/1", {
        kind: "drone",
        file: { state: "uploading", file: new File(["x"], "x.png"), token: 1 },
      })
    );
    expect(running.upload_id).toBeNull();
    expect(running.media_id).toBeNull();
    // The kind describes the source, file or not.
    expect(running.kind).toBe("drone");
  });

  it("posts no capture position for a document kind", () => {
    const draft = { ...sourceDraftFrom(STORED), kind: "article" as const };
    expect(sourceCreatePayload(draft).capture_position).toBeNull();
  });

  it("drops an out-of-bounds capture pair, which the editor flags", () => {
    const draft = linked("https://t.me/c/1", { kind: "drone", captureLat: "48.1", captureLng: "190" });
    expect(sourceCreatePayload(draft).capture_position).toBeNull();
    expect(capturePositionInvalid(draft)).toBe(true);
    expect(capturePositionInvalid({ ...draft, captureLng: "37.9" })).toBe(false);
    expect(capturePositionInvalid({ ...draft, captureLat: "", captureLng: "" })).toBe(false);
    expect(capturePositionInvalid({ ...draft, kind: "article" })).toBe(false);
  });
});

describe("isEvidenceLevel", () => {
  it("counts direct and indirect sources toward the floor, context ones not", () => {
    expect(SOURCE_LEVELS.filter(isEvidenceLevel)).toEqual(["direct", "indirect"]);
  });
});

describe("sourceFloor", () => {
  it("reads a direct or indirect source with a file as evidence, and a context one not", () => {
    const withFile = linked("https://t.me/c/1", { file: { state: "stored", media: FILE } });
    expect(sourceFloor([withFile]).hasEvidenceFile).toBe(true);
    expect(sourceFloor([{ ...withFile, level: "context" }]).hasEvidenceFile).toBe(false);
  });

  it("flags a source without a URL and a source without a kind", () => {
    const floor = sourceFloor([
      { ...newSourceDraft(), links: [], file: { state: "stored", media: FILE } },
    ]);
    expect(floor).toEqual({ hasEvidenceFile: true, missingLink: true, missingKind: true });
  });
});

describe("sourcesChanged", () => {
  it("reads the seeded editors as unchanged", () => {
    expect(sourcesChanged([STORED], [sourceDraftFrom(STORED)])).toBe(false);
  });

  it("reads a moved field, a new copy, a new source or a removed one as a change", () => {
    const draft = sourceDraftFrom(STORED);
    expect(sourcesChanged([STORED], [{ ...draft, kind: "satellite" }])).toBe(true);
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

describe("isImportableLink", () => {
  // The shapes of backend tests/events/test_uploads_from_link.py, which pins the mirrored check.
  it.each([
    "https://x.com/someone/status/1790000000000000000",
    "https://www.x.com/someone/status/1790000000000000000?s=20",
    "https://twitter.com/someone/status/1790000000000000000",
    "https://x.com/i/web/status/1790000000000000000",
    "https://t.me/somechannel/12345",
    "http://www.t.me/somechannel/12345?single",
    "https://www.tiktok.com/@someone/video/7400000000000000001",
    "https://tiktok.com/@some.one_2/photo/7400000000000000001/",
    "https://m.tiktok.com/@someone/photo/7400000000000000001",
    "https://vm.tiktok.com/ZMabc123/",
    "https://vt.tiktok.com/ZSxyz",
    "https://www.tiktok.com/t/ZTcode9/",
  ])("reads %s", (url) => {
    expect(isImportableLink(url)).toBe(true);
  });

  it.each([
    "https://example.com/article",
    "https://x.com/someone",
    "https://web.archive.org/web/2026/https://x.com/someone/status/1",
    "https://x.com.evil.example/someone/status/1",
    "https://t.me/somechannel",
    "https://t.me/c/1234567890/42",
    "https://t.me:8080/somechannel/12345",
    "https://user:pass@t.me/somechannel/12345",
    "https://www.tiktok.com/@someone",
    "https://www.tiktok.com/embed/v2/7400000000000000001",
    "https://tiktok.com.evil.example/@someone/video/1",
    "https://evil.tiktok.com/ZMabc123/",
    "https://vm.tiktok.com/a/b",
    "https://www.tiktok.com:8443/@someone/video/1",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isImportableLink(url)).toBe(false);
  });
});
