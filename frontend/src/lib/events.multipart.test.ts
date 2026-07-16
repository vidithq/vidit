import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import {
  createEvent,
  createEventRequest,
  geolocateEvent,
  parseCaptureCoords,
  type EventCreateInput,
} from "./events";
import { apiFetch } from "./api";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const mockFetch = apiFetch as unknown as Mock;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ id: "e1" });
});

/** The FormData the last apiFetch call carried. */
function lastBody(): FormData {
  const [, options] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
  return options.body as FormData;
}

const pngA = new File(["a"], "a.png", { type: "image/png" });
const pngB = new File(["b"], "b.png", { type: "image/png" });
const vid = new File(["v"], "clip.mp4", { type: "video/mp4" });

const createInput: EventCreateInput = {
  title: "Strike on depot",
  lat: 48.5,
  lng: 37.8,
  source_url: "https://t.me/c/1",
  event_date: "2026-01-02",
  source_posted_at: "2026-01-01T00:00",
  proof: { type: "doc", content: [] },
  tag_ids: ["t1"],
  conflict_ids: ["c1"],
  files: [vid],
  proof_files: [pngA, pngB],
};

describe("parseCaptureCoords", () => {
  it("returns both halves when both are numeric", () => {
    expect(parseCaptureCoords("50.1", "30.2")).toEqual({
      capture_source_lat: 50.1,
      capture_source_lng: 30.2,
    });
  });

  it("drops a lone / half-typed pair (both-or-neither)", () => {
    expect(parseCaptureCoords("50.1", "")).toEqual({});
    expect(parseCaptureCoords("", "30.2")).toEqual({});
    expect(parseCaptureCoords("", "")).toEqual({});
    expect(parseCaptureCoords("abc", "30.2")).toEqual({});
  });

  it("rejects a partially-numeric value rather than truncating it", () => {
    // `parseFloat("50.1abc")` would be 50.1; a clean-number parse clears it.
    expect(parseCaptureCoords("50.1abc", "30.2")).toEqual({});
    expect(parseCaptureCoords("50.1", "30.2xyz")).toEqual({});
  });
});

describe("createEvent multipart", () => {
  it("attaches every proof file under proof_files[]", async () => {
    await createEvent(createInput);
    const body = lastBody();
    expect(body.getAll("proof_files")).toEqual([pngA, pngB]);
    expect(body.get("file")).toBe(vid); // create sends the source under singular `file`
    expect(body.getAll("files")).toEqual([]);
  });

  it("encodes tag_ids and conflict_ids as JSON arrays", async () => {
    await createEvent(createInput);
    const body = lastBody();
    expect(body.get("tag_ids")).toBe(JSON.stringify(["t1"]));
    expect(body.get("conflict_ids")).toBe(JSON.stringify(["c1"]));
  });

  it("omits conflict_ids when none are selected", async () => {
    await createEvent({ ...createInput, conflict_ids: [] });
    expect(lastBody().has("conflict_ids")).toBe(false);
  });

  it("omits the camera point when it isn't set", async () => {
    await createEvent(createInput);
    const body = lastBody();
    expect(body.has("capture_source_lat")).toBe(false);
    expect(body.has("capture_source_lng")).toBe(false);
  });

  it("sends both camera halves together (both-or-neither)", async () => {
    await createEvent({
      ...createInput,
      ...parseCaptureCoords("50.1", "30.2"),
    });
    const body = lastBody();
    expect(body.get("capture_source_lat")).toBe("50.1");
    expect(body.get("capture_source_lng")).toBe("30.2");
  });
});

describe("geolocateEvent multipart", () => {
  it("carries proof_files, remove_media_ids, and the camera point", async () => {
    mockFetch.mockResolvedValue({ id: "e1", status: "geolocated" });
    await geolocateEvent("e1", {
      ...createInput,
      remove_media_ids: ["m1", "m2"],
      ...parseCaptureCoords("50.1", "30.2"),
    });
    const body = lastBody();
    expect(body.getAll("proof_files")).toEqual([pngA, pngB]);
    expect(body.get("remove_media_ids")).toBe(JSON.stringify(["m1", "m2"]));
    expect(body.get("capture_source_lat")).toBe("50.1");
    const [path] = mockFetch.mock.calls.at(-1) as [string];
    expect(path).toBe("/events/e1/geolocate");
  });
});

describe("createEventRequest multipart", () => {
  it("posts the camera point and no proof_files part when none supplied", async () => {
    mockFetch.mockResolvedValue({ id: "e1", status: "requested" });
    await createEventRequest({
      title: "Footage wanted",
      source_url: "https://t.me/c/2",
      source_posted_at: "2026-01-01T00:00",
      files: [vid],
      proof_files: [],
      ...parseCaptureCoords("50.1", "30.2"),
    });
    const body = lastBody();
    expect(body.get("capture_source_lat")).toBe("50.1");
    expect(body.get("capture_source_lng")).toBe("30.2");
    expect(body.has("proof_files")).toBe(false);
  });

  it("uploads proof_files when a request carries proof images", async () => {
    mockFetch.mockResolvedValue({ id: "e2", status: "requested" });
    await createEventRequest({
      title: "Started, not finished",
      source_url: "https://t.me/c/3",
      source_posted_at: "2026-01-01T00:00",
      files: [vid],
      proof_files: [pngA, pngB],
    });
    expect(lastBody().getAll("proof_files")).toEqual([pngA, pngB]);
  });
});
