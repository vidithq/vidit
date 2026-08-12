import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FIELD_HELP } from "@/lib/fieldHelp";

vi.mock("next/navigation", () => ({
  useParams: () => ({ username: "ana" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ user: { id: "u1", username: "ana" }, loading: false }),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

import type { EventDetail } from "@/types";

import DetectionsPage from "./page";

function draftFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "d1",
    title: "Strike near Bakhmut",
    event_coords: { lat: 48.5, lng: 37.8 },
    capture_source_coords: null,
    archived_source: null,
    archived_detected_from: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    is_demo: false,
    status: "detected",
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_post_at: "2026-05-30T15:00:00Z",
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
    proof: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://cdn.test/p.jpg" } }],
    },
    created_at: "2026-06-02T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
    requested_at: null,
    detected_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    media: [
      {
        id: "m1",
        storage_url: "/local-storage/evidence.jpg",
        media_type: "image",
        role: "source",
      },
    ],
    thumbnail: null,
    requested_by: null,
    geolocators: [],
    investigator_count: 0,
    investigators: [],
    ...overrides,
  };
}

describe("DetectionsPage queue filter", () => {
  it("explains the one-word options behind the `?` beside the bar", () => {
    useApiResource.mockReturnValue({
      data: { items: [draftFixture()], total: 1, page: 1, per_page: 20 },
      error: null,
    });

    render(<DetectionsPage />);

    // The labels are one word each and none of them says what it selects, so
    // the sentence hangs from the house `?`, once for the bar. It repeats the
    // row badge's promise: evidence complete, judgment still owed.
    const help = screen.getByRole("button", {
      name: FIELD_HELP.detection_queue_filter.label,
    });
    fireEvent.focus(help);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("conflict and the capture source");
    expect(tooltip).toHaveTextContent("the full edit form");
    // The options themselves carry no native hover text: Vidit never uses it.
    for (const label of ["All", "Ready", "Incomplete"]) {
      expect(screen.getByRole("button", { name: label })).not.toHaveAttribute("title");
    }
  });
});
