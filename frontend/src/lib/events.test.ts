import { describe, expect, it } from "vitest";

import {
  missingEventFields,
  missingEventRequestFields,
  submitReadiness,
  type EventFieldsState,
} from "./events";

// A fully-complete geolocation draft, each test knocks one field out. The proof
// carries an image node, since a geolocation's proof must (proofHasImage).
const complete: EventFieldsState = {
  title: "Strike on depot",
  lat: "48.5",
  lng: "37.8",
  sourceUrl: "https://t.me/c/1",
  eventDate: "2026-01-02",
  sourcePostedAt: "2026-01-01T00:00",
  proof: {
    type: "doc",
    content: [{ type: "image", attrs: { src: "https://x/y.jpg" } }],
  },
  mediaCount: 2,
  hasConflictTag: true,
  hasCaptureSourceTag: true,
};

// missingEventFields returns {key,label}[]; assert on the labels.
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
        eventDate: "",
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
      "Event date",
      "Source post time",
      "Proof",
      "Source media",
      "Conflict tag",
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
    event_date: "2026-01-02",
    source_posted_at: "2026-01-01T00:00:00Z",
    proof: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://x/y.jpg" } }],
    },
    media: [{}, {}],
    tags: [
      { category: "conflict" as const },
      { category: "capture_source" as const },
    ],
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
    });
    expect(r.isReady).toBe(false);
    expect(r.missing).toEqual([
      "Proof image",
      "Source media",
      "Conflict tag",
      "Capture source tag",
    ]);
  });
});

describe("missingEventRequestFields", () => {
  // missingEventRequestFields returns {key,label}[]; assert on the labels.
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
