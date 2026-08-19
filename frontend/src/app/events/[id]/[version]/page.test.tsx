import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventDetail, EventRevision } from "@/types";

// The map canvas needs WebGL, which jsdom has none of.
vi.mock("@/components/map/Map", () => ({ default: () => <div data-testid="map" /> }));

// A signed-out reader: the page chrome reads the viewer off the auth context,
// and a version page offers no control whoever is looking.
const viewer: { id: string | null } = { id: null };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: viewer.id ? { id: viewer.id } : null }),
}));

const replace = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
let segment = "v2";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "e1", version: segment }),
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  notFound: () => notFound(),
}));

// Every read the page makes, answered by path.
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => ({
    data: path === null ? null : (resource(path) ?? null),
    error: null,
    loading: false,
    refetch: () => {},
  }),
}));

import EventVersionPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };
const BOB = { id: "u2", username: "bob", avatar_url: null };

const EVENT: EventDetail = {
  id: "e1",
  title: "v3 title",
  event_coords: { lat: 48.01, lng: 37.8 },
  capture_source_coords: null,
  archived_source: null,
  event_date: "2026-06-01",
  event_time: null,
  source_posted_at: "2026-05-30T14:32:00Z",
  is_graphic: false,
  status: "geolocated",
  revision_no: 3,
  close_reason: null,
  before_closed_status: null,
  detected_from_url: null,
  detected_via: null,
  archived_detected_from: null,
  detected_post_at: null,
  owner: OWNER,
  tags: [],
  conflicts: [],
  source_url: "https://t.me/channel/12345",
  secondary_source_urls: [],
  archived_secondary_sources: [],
  proof: { type: "doc", content: [] },
  created_at: "2026-06-01T10:00:00Z",
  updated_at: "2026-06-03T10:00:00Z",
  requested_at: null,
  detected_at: null,
  geolocated_at: "2026-06-01T10:00:00Z",
  closed_at: null,
  media: [],
  thumbnail: null,
  requested_by: null,
  geolocators: [],
};

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
    created_at: `2026-06-0${revisionNo + 1}T10:00:00Z`,
    snapshot,
    redacted: false,
    ...extra,
  };
}

const snapshot = (title: string): Record<string, unknown> => ({
  title,
  event_coords: { lat: 49.5, lng: 30.2 },
  capture_source_coords: null,
  event_date: "2026-06-01",
  event_time: null,
  source_posted_at: "2026-05-30T14:32:00+00:00",
  is_graphic: false,
  secondary_source_urls: [],
  tags: [],
  conflicts: [],
  proof: { type: "doc", content: [] },
  proof_media: [],
});

let rows: Record<number, EventRevision>;

function resource(path: string): unknown {
  if (path === "/events/e1") return EVENT;
  const match = path.match(/^\/events\/e1\/revisions\/([0-9]+)$/);
  return match ? rows[Number(match[1])] : null;
}

beforeEach(() => {
  segment = "v2";
  viewer.id = null;
  replace.mockClear();
  notFound.mockClear();
  rows = {
    1: revision(1, snapshot("v1 title"), { note: "why v2 happened" }),
    2: revision(2, snapshot("v2 title"), { note: "why v3 happened" }),
  };
});

describe("EventVersionPage", () => {
  it("renders the event as that version stood, under a banner naming it", () => {
    render(<EventVersionPage />);
    expect(screen.getByRole("heading", { name: "v2 title" })).toBeTruthy();
    expect(screen.getByText(/Version 2 of 3/)).toBeTruthy();
    // The byline is the edit that produced version 2, filed on version 1.
    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("View the current version").getAttribute("href")).toBe(
      "/events/e1"
    );
    // The snapshot's coordinates, not the live row's.
    expect(screen.getByText(/49\.5/)).toBeTruthy();
  });

  it("says version 1 was published rather than edited", () => {
    segment = "v1";
    render(<EventVersionPage />);
    // Version 1 carries the record's own author, since no edit produced it.
    const banner = screen.getByText(/Version 1 of 3/);
    expect(banner.textContent).toContain("published by");
    expect(banner.textContent).toContain("ana");
  });

  it("serves a redacted version as its banner and a notice, with no content", () => {
    rows[2] = revision(2, {}, { redacted: true });
    render(<EventVersionPage />);
    expect(screen.getByText(/Version 2 of 3/)).toBeTruthy();
    expect(screen.getByText(/redacted this version/)).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("forwards the current version to the canonical page", () => {
    segment = "v3";
    render(<EventVersionPage />);
    expect(replace).toHaveBeenCalledWith("/events/e1");
    expect(screen.queryByText(/Version 3 of 3/)).toBeNull();
  });

  it("404s a version past the current one", () => {
    segment = "v9";
    expect(() => render(<EventVersionPage />)).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("404s a segment that names no version", () => {
    for (const bad of ["v0", "verify", "2"]) {
      segment = bad;
      notFound.mockClear();
      expect(() => render(<EventVersionPage />)).toThrow("NEXT_NOT_FOUND");
      expect(notFound).toHaveBeenCalled();
    }
  });
});
