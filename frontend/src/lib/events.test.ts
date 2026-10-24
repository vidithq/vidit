import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArchiveUploadError,
  batchCompletionBlockers,
  missingEventFields,
  missingEventRequestFields,
  uploadArchive,
  type EventFieldsState,
} from "./events";

const FULL_FLOOR = { hasEvidenceFile: true, missingLink: false, missingSensor: false };

// A fully-complete detection; each test knocks one field out. The proof carries an image node
// (`proofHasImage`).
const complete: EventFieldsState = {
  title: "Strike on depot",
  lat: "48.5",
  lng: "37.8",
  proof: '<img src="https://x/y.jpg">',
  sources: FULL_FLOOR,
  hasConflict: true,
};

const labels = (s: EventFieldsState) => missingEventFields(s).map((m) => m.label);

describe("missingEventFields", () => {
  it("returns nothing when every required field is present", () => {
    expect(labels(complete)).toEqual([]);
  });

  it("lists every miss at once for an empty detection", () => {
    expect(
      labels({
        title: "",
        lat: "",
        lng: "",
        proof: null,
        sources: { hasEvidenceFile: false, missingLink: true, missingSensor: true },
        hasConflict: false,
      })
    ).toEqual([
      "Title",
      "Coordinates",
      "Source file",
      "Source URL",
      "Sensor",
      "Proof",
      "Conflict",
    ]);
  });

  it("flags out-of-range coordinates as Coordinates", () => {
    expect(labels({ ...complete, lat: "999", lng: "37.8" })).toEqual(["Coordinates"]);
  });

  it("requires an image in the proof, not just text", () => {
    expect(labels({ ...complete, proof: "<p></p>" })).toEqual(["Proof image"]);
  });

  it("reports a missing proof as Proof, not Proof image", () => {
    expect(labels({ ...complete, proof: null })).toEqual(["Proof"]);
  });

  it("exposes a key per miss for the in-form highlight", () => {
    expect(
      missingEventFields({
        ...complete,
        title: "",
        sources: { ...FULL_FLOOR, hasEvidenceFile: false },
      }).map((m) => m.key)
    ).toEqual(["title", "source_file"]);
  });

  it("treats a blank-string title as missing", () => {
    expect(labels({ ...complete, title: "   " })).toEqual(["Title"]);
  });
});

describe("batchCompletionBlockers", () => {
  const FILE = {
    id: "m1",
    role: "source" as const,
    kind: "image" as const,
    sha256: "0",
    storage_url: "https://cdn/x.jpg",
  };
  const LINK = { url: "https://x.com/a/status/1", posted_at: null, archived: null };
  // A detection as the import leaves it, missing only the sensor and conflict the batch supplies.
  const importedDetection = {
    coords: { lat: 48.5, lng: 37.8 },
    proof: '<img src="https://x/y.jpg">',
    sources: [{ level: "direct" as const, links: [LINK], media: FILE }],
  };

  it("clears a detection the import filled", () => {
    expect(batchCompletionBlockers(importedDetection)).toEqual([]);
  });

  it("flags the row whose thread carried no annotation image", () => {
    expect(batchCompletionBlockers({ ...importedDetection, proof: "<p></p>" })).toEqual([
      "Proof image",
    ]);
  });

  it("counts a context source's file as no footage", () => {
    expect(
      batchCompletionBlockers({
        ...importedDetection,
        sources: [{ level: "context", links: [LINK], media: FILE }],
      })
    ).toEqual(["Source file"]);
  });

  it("lists every miss at once, in floor order", () => {
    expect(
      batchCompletionBlockers({
        coords: null,
        proof: null,
        sources: [{ level: "direct", links: [], media: null }],
      })
    ).toEqual(["Coordinates", "Proof image", "Source URL", "Source file"]);
  });

  // Mirrors `backend/tests/events/_readiness_cases.py`, shape for shape; change both. The
  // readiness rule has three expressions (this one, `services/events/batch._publish_detection`,
  // and the SQL `services/events.detection_ready_predicate`): a disagreement shows as a row
  // badged Ready that the Ready filter hides.
  describe("agrees with the server's readiness filter, shape for shape", () => {
    const proofWithImage = '<p>Cross-referenced.</p><img src="https://cdn.example.com/proof.jpg">';
    const proofImageNested = '<ul><li><p>a</p><img alt="frame" src="https://cdn/x.jpg"></li></ul>';
    const proofTextOnly = "<p>No imagery.</p>";
    // The server counts srcs, not tags, and text can name the tag.
    const proofImageWithoutSrc = '<img alt="src=&quot;x&quot;"><p>&lt;img src="y"&gt;</p>';
    const proofImageWithSrcInAValue = '<img alt="x src=">';
    const withFile = { level: "direct" as const, links: [LINK], media: FILE };
    const ready = { ...importedDetection, proof: proofWithImage };
    const mirror = { level: "direct" as const, links: [{ ...LINK, url: "https://t.me/c/2" }], media: null };

    const cases: [string, Parameters<typeof batchCompletionBlockers>[0], boolean][] = [
      ["ready", ready, true],
      ["ready_with_a_nested_proof_image", { ...ready, proof: proofImageNested }, true],
      ["ready_on_an_indirect_source", { ...ready, sources: [{ ...withFile, level: "indirect" }] }, true],
      ["ready_beside_a_source_without_a_file", { ...ready, sources: [withFile, mirror] }, true],
      ["a_source_without_a_url", { ...ready, sources: [{ ...withFile, links: [] }] }, false],
      ["no_source", { ...ready, sources: [] }, false],
      ["no_source_file", { ...ready, sources: [{ ...withFile, media: null }] }, false],
      [
        "only_a_context_source_has_the_file",
        { ...ready, sources: [{ ...withFile, level: "context" }] },
        false,
      ],
      ["no_coordinates", { ...ready, coords: null }, false],
      ["no_proof_image", { ...ready, proof: proofTextOnly }, false],
      ["proof_image_without_a_src", { ...ready, proof: proofImageWithoutSrc }, false],
      ["proof_image_with_src_inside_a_value", { ...ready, proof: proofImageWithSrcInAValue }, false],
      ["missing_everything_but_the_title", { coords: null, proof: proofTextOnly, sources: [] }, false],
    ];

    it.each(cases)("%s", (_name, detection, isReady) => {
      expect(batchCompletionBlockers(detection).length === 0).toBe(isReady);
    });
  });
});

describe("missingEventRequestFields", () => {
  const requestLabels = (s: Parameters<typeof missingEventRequestFields>[0]) =>
    missingEventRequestFields(s).map((m) => m.label);

  it("returns nothing when the title and a source with a file and a URL are present", () => {
    expect(requestLabels({ title: "Unplaced footage", sources: FULL_FLOOR })).toEqual([]);
  });

  it("lists the request floor (no coords, sensor, proof or conflict) at once", () => {
    expect(
      requestLabels({
        title: "",
        sources: { hasEvidenceFile: false, missingLink: true, missingSensor: true },
      })
    ).toEqual(["Title", "Source file", "Source URL"]);
  });

  it("treats a blank-string title as missing", () => {
    expect(requestLabels({ title: "   ", sources: FULL_FLOOR })).toEqual(["Title"]);
  });
});

/** Stand in for the XHR `uploadArchive` drives (open, send, read status and body on load). */
function stubUpload(status: number, body = "") {
  class StubXhr {
    status = 0;
    responseText = "";
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open() {
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
    // The body-size middleware ahead of the route; its detail carries the cap in bytes.
    stubUpload(413, '{"detail":"Request body too large (max 4305453056 bytes)"}');
    await expect(uploadArchive(target, zip)).rejects.toHaveProperty(
      "code",
      "archive_too_large"
    );
  });

  it("keeps ArchiveUploadError for a 413 from an intermediary", async () => {
    // A corporate proxy can 413 an under-cap upload; calling that too large would steer away from
    // a working retry.
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
