import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventDetail, EventVersion } from "@/types";

// The map canvas needs WebGL, absent in jsdom.
vi.mock("@/components/map/Map", () => ({ default: () => <div data-testid="map" /> }));

// A signed-out reader: a version page offers no control to anyone.
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
  coords: { lat: 48.01, lng: 37.8 },
  occurred_date: "2026-06-01",
  occurred_time: null,
  is_graphic: false,
  status: "geolocated",
  version_no: 3,
  close_reason: null,
  before_closed_status: null,
  detected_from_url: null,
  detected_via: null,
  owner: OWNER,
  tags: [],
  conflicts: [],
  sources: [{ id: "s1", title: "", level: "direct", sensor: null, captured_at: null, sensor_position: null, is_graphic: false, links: [{ url: "https://t.me/channel/12345", posted_at: null, archived: null }], tags: [], media: null }],
  proof: "",
  created_at: "2026-06-01T10:00:00Z",
  geolocated_at: "2026-06-01T10:00:00Z",
  closed_at: null,
  thumbnail: null,
  requested_by: null,
  geolocators: [],
};

function version(
  versionNo: number,
  snapshot: Record<string, unknown>,
  extra: Partial<EventVersion> = {}
): EventVersion {
  return {
    id: `r${versionNo}`,
    version_no: versionNo,
    edited_by: BOB,
    note: null,
    created_at: `2026-06-0${versionNo + 1}T10:00:00Z`,
    snapshot,
    redacted: false,
    ...extra,
  };
}

const snapshot = (title: string): Record<string, unknown> => ({
  title,
  coords: { lat: 49.5, lng: 30.2 },
  occurred_date: "2026-06-01",
  occurred_time: null,
  is_graphic: false,
  tags: [],
  conflicts: [],
  proof: "",
  proof_media: [],
});

let rows: Record<number, EventVersion>;

function resource(path: string): unknown {
  if (path === "/events/e1") return EVENT;
  const match = path.match(/^\/events\/e1\/versions\/([0-9]+)$/);
  return match ? rows[Number(match[1])] : null;
}

beforeEach(() => {
  segment = "v2";
  viewer.id = null;
  replace.mockClear();
  notFound.mockClear();
  rows = {
    1: version(1, snapshot("v1 title"), { note: "why v2 happened" }),
    2: version(2, snapshot("v2 title"), { note: "why v3 happened" }),
  };
});

describe("EventVersionPage", () => {
  it("renders the event as that version stood, under a banner naming it", () => {
    render(<EventVersionPage />);
    expect(screen.getByRole("heading", { name: "v2 title" })).toBeTruthy();
    expect(screen.getByText(/Version 2 of 3/)).toBeTruthy();
    // The edit that produced version 2, filed on version 1.
    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("View the current version").getAttribute("href")).toBe(
      "/events/e1"
    );
    // The snapshot's coordinates, not the live row's.
    expect(screen.getByText(/49\.5/)).toBeTruthy();
  });

  it("shows the version on screen as selected in the header's version selector", () => {
    render(<EventVersionPage />);
    fireEvent.click(screen.getByRole("button", { name: "v2: choose a version" }));
    const current = screen.getByRole("menuitem", { name: "v2" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/events/e1/v2");
    expect(screen.getByRole("menuitem", { name: "v3" }).getAttribute("href")).toBe("/events/e1");
  });

  it("says version 1 was published rather than edited", () => {
    segment = "v1";
    render(<EventVersionPage />);
    // Version 1 carries the record's own author.
    const banner = screen.getByText(/Version 1 of 3/);
    expect(banner.textContent).toContain("published by");
    expect(banner.textContent).toContain("ana");
  });

  it("serves a redacted version as its banner and a notice, with no content", () => {
    rows[2] = version(2, {}, { redacted: true });
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
