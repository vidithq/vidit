import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArchiveUploadError,
  batchCompletionBlockers,
  missingEventFields,
  missingEventRequestFields,
  submitReadiness,
  uploadArchive,
  type EventFieldsState,
} from "./events";

// A fully-complete geolocation draft, each test knocks one field out. The proof
// carries an image node, since a geolocation's proof must (proofHasImage).
const complete: EventFieldsState = {
  title: "Strike on depot",
  lat: "48.5",
  lng: "37.8",
  sourceUrl: "https://t.me/c/1",
  sourcePostedAt: "2026-01-01T00:00",
  proof: {
    type: "doc",
    content: [{ type: "image", attrs: { src: "https://x/y.jpg" } }],
  },
  mediaCount: 2,
  hasConflictTag: true,
  hasCaptureSourceTag: true,
};

const labels = (s: EventFieldsState, opts?: Parameters<typeof missingEventFields>[1]) =>
  missingEventFields(s, opts).map((m) => m.label);

describe("missingEventFields", () => {
  it("returns nothing when every required field is present", () => {
    expect(labels(complete)).toEqual([]);
  });

  it("lists every miss at once for an empty draft", () => {
    expect(
      labels({
        title: "",
        lat: "",
        lng: "",
        sourceUrl: "",
        sourcePostedAt: "",
        proof: null,
        mediaCount: 0,
        hasConflictTag: false,
        hasCaptureSourceTag: false,
      })
    ).toEqual([
      "Title",
      "Coordinates",
      "Source URL",
      "Source post time",
      "Proof",
      "Source media",
      "Conflict",
      "Capture source tag",
    ]);
  });

  it("flags out-of-range coordinates as Coordinates", () => {
    expect(labels({ ...complete, lat: "999", lng: "37.8" })).toEqual([
      "Coordinates",
    ]);
  });

  it("requires an image in the proof, not just text", () => {
    expect(
      labels({
        ...complete,
        proof: { type: "doc", content: [{ type: "paragraph" }] },
      })
    ).toEqual(["Proof image"]);
  });

  it("reports a missing proof as Proof, not Proof image", () => {
    expect(labels({ ...complete, proof: null })).toEqual(["Proof"]);
  });

  it("skips the source-media floor when media isn't required (request fulfilment)", () => {
    expect(labels({ ...complete, mediaCount: 0 }, { requireMedia: false })).toEqual(
      []
    );
  });

  it("skips the tag floor when tags aren't required (partial draft save)", () => {
    expect(
      labels(
        { ...complete, hasConflictTag: false, hasCaptureSourceTag: false },
        { requireTags: false }
      )
    ).toEqual([]);
  });

  it("exposes a key per miss for the in-form highlight", () => {
    expect(
      missingEventFields({ ...complete, title: "", mediaCount: 0 }).map(
        (m) => m.key
      )
    ).toEqual(["title", "source_media"]);
  });

  it("treats a blank-string title as missing", () => {
    expect(labels({ ...complete, title: "   " })).toEqual(["Title"]);
  });
});

describe("submitReadiness", () => {
  // A detected row that would pass the Submit gate.
  const readyGeo = {
    title: "Strike on depot",
    lat: 48.5,
    lng: 37.8,
    source_url: "https://t.me/c/1",
    source_posted_at: "2026-01-01T00:00:00Z",
    proof: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://x/y.jpg" } }],
    },
    media: [{}, {}],
    tags: [{ category: "capture_source" as const }],
    conflicts: [{}],
  };

  it("is ready when the full submit floor is met", () => {
    expect(submitReadiness(readyGeo)).toEqual({ isReady: true, missing: [] });
  });

  it("mirrors the Submit gate (same labels, including a text-only proof)", () => {
    const r = submitReadiness({
      ...readyGeo,
      proof: { type: "doc", content: [{ type: "paragraph" }] },
      media: [],
      tags: [],
      conflicts: [],
    });
    expect(r.isReady).toBe(false);
    expect(r.missing).toEqual([
      "Proof image",
      "Source media",
      "Conflict",
      "Capture source tag",
    ]);
  });
});

describe("batchCompletionBlockers", () => {
  // A draft as the import leaves it: coordinates, a source, its footage, and a
  // proof body carrying the annotation image. Only the capture source is
  // missing, and the batch supplies that.
  const importedDraft = {
    event_coords: { lat: 48.5, lng: 37.8 },
    source_url: "https://x.com/a/status/1",
    proof: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://x/y.jpg" } }],
    },
    media: [{ role: "source" as const }],
  };

  it("clears a draft the import filled", () => {
    expect(batchCompletionBlockers(importedDraft)).toEqual([]);
  });

  it("flags the row whose thread carried no annotation image", () => {
    expect(
      batchCompletionBlockers({
        ...importedDraft,
        proof: { type: "doc", content: [{ type: "paragraph" }] },
      })
    ).toEqual(["Proof image"]);
  });

  it("counts only source media, never a proof image, as the footage", () => {
    // The floor wants the footage the geolocation is OF. An import whose
    // annotation images landed but whose source video did not carries media
    // rows and still misses it.
    expect(
      batchCompletionBlockers({
        ...importedDraft,
        media: [{ role: "proof" as const }],
      })
    ).toEqual(["Source media"]);
  });

  it("lists every miss at once, in floor order", () => {
    expect(
      batchCompletionBlockers({
        event_coords: null,
        source_url: null,
        proof: null,
        media: [],
      })
    ).toEqual(["Source URL", "Coordinates", "Source media", "Proof image"]);
  });

  it("ignores what a batch never writes (title, source post time)", () => {
    // The batch posts no fields, so those requirements belong to the submit
    // form, not here: a draft missing them still publishes.
    expect(batchCompletionBlockers({ ...importedDraft, source_url: "  " })).toEqual([
      "Source URL",
    ]);
  });
});

describe("missingEventRequestFields", () => {
  const requestLabels = (s: Parameters<typeof missingEventRequestFields>[0]) =>
    missingEventRequestFields(s).map((m) => m.label);

  it("returns nothing when title, source, and media are present", () => {
    expect(
      requestLabels({
        title: "Unplaced footage",
        sourceUrl: "https://t.me/c/1",
        sourcePostedAt: "2026-01-01T00:00",
        mediaCount: 1,
      })
    ).toEqual([]);
  });

  it("lists the request floor (no coords / dates / proof / tags) at once", () => {
    expect(
      requestLabels({ title: "", sourceUrl: "", sourcePostedAt: "", mediaCount: 0 })
    ).toEqual(["Title", "Source URL", "Source post time", "Source media"]);
  });

  it("treats a blank-string title as missing", () => {
    expect(
      requestLabels({
        title: "   ",
        sourceUrl: "https://t.me/c/1",
        sourcePostedAt: "2026-01-01T00:00",
        mediaCount: 1,
      })
    ).toEqual(["Title"]);
  });
});

/** Stand in for the browser XHR `uploadArchive` drives: it only opens, sends,
 *  and reads the status plus the body back on load. */
function stubUpload(status: number, body = "") {
  class StubXhr {
    status = 0;
    responseText = "";
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open() {
      // The stub never opens a connection.
    }
    send() {
      this.status = status;
      this.responseText = body;
      this.onload?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", StubXhr);
}

const target = { url: "https://bucket.s3.amazonaws.com/", fields: { key: "k" } };
const zip = new File(["z"], "vidit-archive.zip", { type: "application/zip" });

describe("uploadArchive", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves on the POST policy's 204", async () => {
    stubUpload(204);
    await expect(uploadArchive(target, zip)).resolves.toBeUndefined();
  });

  it("maps S3's EntityTooLarge to archive_too_large, not a retry prompt", async () => {
    // What S3 answers when the body breaks the policy's content-length-range.
    stubUpload(
      400,
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>EntityTooLarge</Code>' +
        "<Message>Your proposed upload exceeds the maximum allowed size</Message></Error>"
    );
    await expect(uploadArchive(target, zip)).rejects.toHaveProperty(
      "code",
      "archive_too_large"
    );
  });

  it("maps the dev upload endpoint's 413 to the same code", async () => {
    // The route's own streaming guard (main.py::dev_staging_upload).
    stubUpload(413, '{"detail":"Upload exceeds the size guard"}');
    await expect(uploadArchive(target, zip)).rejects.toHaveProperty(
      "code",
      "archive_too_large"
    );
  });

  it("maps the dev body-size middleware's 413 to the same code", async () => {
    // The other 413 the dev endpoint can answer with: the body-size middleware
    // ahead of the route, whose detail carries the cap in bytes.
    stubUpload(413, '{"detail":"Request body too large (max 4305453056 bytes)"}');
    await expect(uploadArchive(target, zip)).rejects.toHaveProperty(
      "code",
      "archive_too_large"
    );
  });

  it("keeps ArchiveUploadError for a 413 from an intermediary", async () => {
    // A corporate proxy capping request bodies can 413 an upload that is under
    // our cap, which the strip just proved. Calling that archive too large
    // would steer the analyst away from a retry that works.
    stubUpload(
      413,
      "<html><head><title>413 Request Entity Too Large</title></head>" +
        "<body><center><h1>413 Request Entity Too Large</h1></center></body></html>"
    );
    await expect(uploadArchive(target, zip)).rejects.toBeInstanceOf(ArchiveUploadError);
  });

  it("keeps ArchiveUploadError for a transit failure", async () => {
    stubUpload(500, "<Error><Code>InternalError</Code></Error>");
    await expect(uploadArchive(target, zip)).rejects.toBeInstanceOf(ArchiveUploadError);
  });
});
