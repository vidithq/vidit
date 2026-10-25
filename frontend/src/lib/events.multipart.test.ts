import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import {
  createEvent,
  createEventRequest,
  parseGuessCoords,
  saveVersion,
  updateEventRequest,
  type EventWriteInput,
} from "./events";
import type { SourceCreate } from "./sources";
import { apiFetch } from "./api";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const mockFetch = apiFetch as unknown as Mock;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ id: "e1" });
});

/** The path and FormData the last apiFetch call carried. */
function lastCall(): [string, FormData] {
  const [path, options] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
  return [path, options.body as FormData];
}
const lastBody = () => lastCall()[1];

const pngA = new File(["a"], "a.png", { type: "image/png" });
const pngB = new File(["b"], "b.png", { type: "image/png" });

const SOURCE: SourceCreate = {
  id: null,
  title: "",
  level: "direct",
  kind: "drone",
  captured_at: null,
  capture_position: { lat: 50.1, lng: 30.2 },
  is_graphic: false,
  links: [{ url: "https://t.me/c/1", posted_at: "2026-01-02T10:00", snapshot_url: null }],
  tag_ids: [],
  upload_id: "u1",
  media_id: null,
};

const input: EventWriteInput = {
  title: "Strike on depot",
  lat: 48.5,
  lng: 37.8,
  sources: [SOURCE],
  occurred_date: "2026-01-02",
  proof: "",
  tag_ids: ["t1"],
  conflict_ids: ["c1"],
  proof_files: [pngA, pngB],
};

describe("parseGuessCoords", () => {
  it("returns both halves when both are numeric", () => {
    expect(parseGuessCoords("50.1", "30.2")).toEqual({ lat: 50.1, lng: 30.2 });
  });

  it("drops a lone or half-typed pair, and a partially-numeric value", () => {
    expect(parseGuessCoords("50.1", "")).toEqual({});
    expect(parseGuessCoords("abc", "30.2")).toEqual({});
    expect(parseGuessCoords("50.1abc", "30.2")).toEqual({});
  });
});

describe("the event write body", () => {
  it("posts the whole source list as one JSON field, and no source file", async () => {
    await createEvent(input);
    const body = lastBody();
    expect(JSON.parse(String(body.get("sources")))).toEqual([SOURCE]);
    expect(body.get("file")).toBeNull();
    expect(body.getAll("files")).toEqual([]);
  });

  it("posts an empty source list rather than none", async () => {
    await createEventRequest({ ...input, sources: [] });
    expect(lastBody().get("sources")).toBe("[]");
  });

  it("attaches every proof file under proof_files", async () => {
    await createEvent(input);
    expect(lastBody().getAll("proof_files")).toEqual([pngA, pngB]);
  });

  it("posts the proof as its HTML string, unencoded", async () => {
    const proof = '<p>See</p><img src="placeholder://a.png">';
    await createEvent({ ...input, proof });
    expect(lastBody().get("proof")).toBe(proof);
  });

  it("encodes tag_ids and conflict_ids as JSON arrays, and omits empty ones", async () => {
    await createEvent(input);
    expect(lastBody().get("tag_ids")).toBe('["t1"]');
    expect(lastBody().get("conflict_ids")).toBe('["c1"]');
    await createEvent({ ...input, tag_ids: [], conflict_ids: [] });
    expect(lastBody().has("tag_ids")).toBe(false);
    expect(lastBody().has("conflict_ids")).toBe(false);
  });

  it("omits occurred_date and occurred_time when unknown", async () => {
    await createEvent({ ...input, occurred_date: undefined });
    expect(lastBody().has("occurred_date")).toBe(false);
    expect(lastBody().has("occurred_time")).toBe(false);
  });

  it("sends the subject point both-or-neither", async () => {
    await createEventRequest({ ...input, lat: undefined, lng: undefined });
    expect(lastBody().has("lat")).toBe(false);
    expect(lastBody().has("lng")).toBe(false);
    await createEventRequest(input);
    expect(lastBody().get("lat")).toBe("48.5");
    expect(lastBody().get("lng")).toBe("37.8");
  });
});

describe("the event write endpoints", () => {
  it.each([
    ["create", () => createEvent(input), "/events"],
    ["request", () => createEventRequest(input), "/events/requests"],
    ["request edit", () => updateEventRequest("e1", input), "/events/e1/request"],
    ["version", () => saveVersion("e1", { ...input, version_no: 0 }), "/events/e1/versions"],
  ])("%s posts to its endpoint", async (_name, write, path) => {
    await write();
    expect(lastCall()[0]).toBe(path);
    expect(lastBody().has("sources")).toBe(true);
  });

  it("carries a trimmed version note, and none when blank", async () => {
    await saveVersion("e1", { ...input, version_no: 1, note: "  moved the pin  " });
    expect(lastBody().get("note")).toBe("moved the pin");
    await saveVersion("e1", { ...input, version_no: 1, note: "   " });
    expect(lastBody().has("note")).toBe(false);
  });

  it("names the version the form was loaded at", async () => {
    await saveVersion("e1", { ...input, version_no: 0 });
    expect(lastBody().get("version_no")).toBe("0");
  });
});
