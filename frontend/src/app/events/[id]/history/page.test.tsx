import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventDetail, EventVersion } from "@/types";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "e1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: () => ({ data: event, error: null, loading: false, refetch: () => {} }),
}));

// The walk is `useCursorList`'s; this page owns what it makes of the rows.
const walk = {
  items: [] as EventVersion[],
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

function baseEvent(versionNo: number): EventDetail {
  return {
    id: "e1",
    title: "Strike on a depot",
    coords: { lat: 48.01, lng: 37.8 },
    occurred_date: "2026-06-01",
    occurred_time: null,
    is_graphic: false,
    status: "geolocated",
    version_no: versionNo,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: null,
    detected_via: null,
    owner: OWNER,
    tags: [],
    conflicts: [],
    sources: [{ id: "s1", title: "", level: "direct", kind: "unknown", captured_at: null, capture_position: null, is_graphic: false, links: [{ url: "https://t.me/channel/12345", posted_at: null, archived: null }], tags: [], media: null, warnings: [] }],
    proof: "",
    created_at: "2026-06-01T10:00:00Z",
    geolocated_at: "2026-06-01T10:00:00Z",
    closed_at: null,
    thumbnail: null,
    requested_by: null,
    geolocators: [],
  };
}

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
  // Every filed version names the evidence anchor; omitting it would read as a swap and print a phantom changed field.
  sources: [{ id: "s1", title: "", level: "direct", kind: "unknown", captured_at: null, capture_position: null, is_graphic: false, links: [{ url: "https://t.me/channel/12345", posted_at: null, archived: null }], tags: [], media: null, warnings: [] }],
  source_media: [],
  coords: { lat: 48.01, lng: 37.8 },
  occurred_date: "2026-06-01",
  occurred_time: null,
  is_graphic: false,
  tags: [],
  conflicts: [],
  proof: "",
  proof_media: [],
});

/** One row of the list, by the version it names. */
const row = (n: number) => screen.getByLabelText(`Version ${n}`).parentElement!;

beforeEach(() => {
  event = baseEvent(3);
  walk.items = [
    version(2, snapshot("v2 title"), { note: "coordinates were off" }),
    version(1, snapshot("v1 title")),
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

  it("ends on the request the event was published from, named so", () => {
    event = { ...baseEvent(2), version_zero: "request", requested_by: BOB };
    walk.items = [version(1, snapshot("v1 title")), version(0, snapshot("Asked"))];
    render(<EventHistoryPage />);
    expect(screen.getByText("3 versions")).toBeTruthy();
    const request = screen.getByLabelText("Request").parentElement!;
    expect(within(request).getByText("Request")).toBeTruthy();
    expect(within(request).getByText("Requested")).toBeTruthy();
    expect(within(request).getByText("bob")).toBeTruthy();
    expect(within(row(1)).getByText("Published")).toBeTruthy();
  });

  it("credits each version to the edit that produced it, with that edit's note", () => {
    render(<EventHistoryPage />);
    // The note filed on version 2 describes the edit that produced version 3.
    expect(within(row(3)).getByText("coordinates were off")).toBeTruthy();
    expect(within(row(3)).getByText("bob")).toBeTruthy();
    // Version 1 was published, not edited: the record's own author and no note.
    expect(within(row(1)).getByText("ana")).toBeTruthy();
    expect(within(row(1)).queryByText("coordinates were off")).toBeNull();
  });

  it("leaves the editor's handle unlinked under the row's own link", () => {
    render(<EventHistoryPage />);
    // The row is one click: a profile anchor under the stretched link would disagree between mouse (z-order) and keyboard (separate stop).
    expect(within(row(3)).getByText("bob").closest("a")).toBeNull();
    expect(
      within(row(3))
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"))
    ).toEqual(["/events/e1"]);
  });

  it("sends the current version to the canonical page and the rest to their own", () => {
    render(<EventHistoryPage />);
    expect(screen.getByLabelText("Version 3").getAttribute("href")).toBe("/events/e1");
    expect(screen.getByLabelText("Version 2").getAttribute("href")).toBe("/events/e1/v2");
    expect(screen.getByLabelText("Version 1").getAttribute("href")).toBe("/events/e1/v1");
  });

  it("names the event in the header without a second way back to it", () => {
    render(<EventHistoryPage />);
    // The *Current* row already opens the event, so the subtitle is plain title text.
    expect(screen.getByText("Strike on a depot")).not.toBeInstanceOf(HTMLAnchorElement);
    expect(
      screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/events/e1")
    ).toHaveLength(1);
  });

  it("marks a redacted version and compares nothing against it", () => {
    walk.items = [
      version(2, {}, { redacted: true }),
      version(1, snapshot("v1 title")),
    ];
    render(<EventHistoryPage />);
    expect(within(row(2)).getByText("Redacted")).toBeTruthy();
    expect(within(row(3)).queryByText("Title")).toBeNull();
  });

  it("offers Show more while the walk has pages, holding the incomplete row back", () => {
    walk.items = [version(2, snapshot("v2 title"))];
    walk.hasMore = true;
    render(<EventHistoryPage />);
    // Version 2's authorship is filed on version 1, which is not loaded yet.
    expect(screen.getAllByText(/^v[0-9]+$/).map((el) => el.textContent)).toEqual(["v3"]);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });

  it("shows the one version of a record nobody has corrected", () => {
    event = baseEvent(1);
    walk.items = [];
    render(<EventHistoryPage />);
    expect(screen.getByText("1 version")).toBeTruthy();
    expect(within(row(1)).getByText("Published")).toBeTruthy();
  });
});
