import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventDetail, EventRevision } from "@/types";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "e1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: () => ({ data: event, error: null, loading: false, refetch: () => {} }),
}));

// The walk itself is `useCursorList`'s (covered by its own consumers); what this
// page owns is what it makes of the rows a walk hands back.
const walk = {
  items: [] as EventRevision[],
  error: null as string | null,
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
  reload: vi.fn(),
};
vi.mock("@/hooks/useCursorList", () => ({ useCursorList: () => walk }));

import EventHistoryPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };
const BOB = { id: "u2", username: "bob", avatar_url: null };

let event: EventDetail;

function baseEvent(revisionNo: number): EventDetail {
  return {
    id: "e1",
    title: "Strike on a depot",
    event_coords: { lat: 48.01, lng: 37.8 },
    capture_source_coords: null,
    archived_source: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    is_graphic: false,
    status: "geolocated",
    revision_no: revisionNo,
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
}

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
  event_coords: { lat: 48.01, lng: 37.8 },
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

/** One row of the list, by the version it names. */
const row = (n: number) => screen.getByLabelText(`Version ${n}`).parentElement!;

beforeEach(() => {
  event = baseEvent(3);
  walk.items = [
    revision(2, snapshot("v2 title"), { note: "coordinates were off" }),
    revision(1, snapshot("v1 title")),
  ];
  walk.hasMore = false;
  walk.loading = false;
  walk.error = null;
});

describe("EventHistoryPage", () => {
  it("lists every version newest first, the current one first and labelled", () => {
    render(<EventHistoryPage />);
    expect(screen.getByText("3 versions")).toBeTruthy();
    const numbers = screen.getAllByText(/^v[0-9]+$/).map((el) => el.textContent);
    expect(numbers).toEqual(["v3", "v2", "v1"]);
    expect(within(row(3)).getByText("Current")).toBeTruthy();
  });

  it("names the fields each edit changed, and says version 1 was published", () => {
    render(<EventHistoryPage />);
    expect(within(row(3)).getByText("Title")).toBeTruthy();
    expect(within(row(2)).getByText("Title")).toBeTruthy();
    expect(within(row(1)).getByText("Published")).toBeTruthy();
  });

  it("credits each version to the edit that produced it, with that edit's note", () => {
    render(<EventHistoryPage />);
    // The note filed on version 2 describes the edit that produced version 3.
    expect(within(row(3)).getByText("coordinates were off")).toBeTruthy();
    expect(within(row(3)).getByText("bob")).toBeTruthy();
    // Version 1 was published rather than edited, so it carries the record's
    // own author and no note.
    expect(within(row(1)).getByText("ana")).toBeTruthy();
    expect(within(row(1)).queryByText("coordinates were off")).toBeNull();
  });

  it("sends the current version to the canonical page and the rest to their own", () => {
    render(<EventHistoryPage />);
    expect(screen.getByLabelText("Version 3").getAttribute("href")).toBe("/events/e1");
    expect(screen.getByLabelText("Version 2").getAttribute("href")).toBe("/events/e1/v2");
    expect(screen.getByLabelText("Version 1").getAttribute("href")).toBe("/events/e1/v1");
  });

  it("marks a redacted version and compares nothing against it", () => {
    walk.items = [
      revision(2, {}, { redacted: true }),
      revision(1, snapshot("v1 title")),
    ];
    render(<EventHistoryPage />);
    expect(within(row(2)).getByText("Redacted")).toBeTruthy();
    expect(within(row(3)).queryByText("Title")).toBeNull();
  });

  it("offers Load more while the walk has pages, holding the incomplete row back", () => {
    walk.items = [revision(2, snapshot("v2 title"))];
    walk.hasMore = true;
    render(<EventHistoryPage />);
    // Version 2's authorship is filed on version 1, which is not loaded yet.
    expect(screen.getAllByText(/^v[0-9]+$/).map((el) => el.textContent)).toEqual(["v3"]);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("shows the one version of a record nobody has corrected", () => {
    event = baseEvent(1);
    walk.items = [];
    render(<EventHistoryPage />);
    expect(screen.getByText("1 version")).toBeTruthy();
    expect(within(row(1)).getByText("Published")).toBeTruthy();
  });
});
