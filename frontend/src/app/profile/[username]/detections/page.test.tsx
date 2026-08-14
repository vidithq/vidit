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
    status: "detected",
    is_graphic: false,
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
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    items: [draftFixture()],
    total: 1,
    page: 1,
    per_page: 10,
    ready_total: 1,
    incomplete_total: 0,
    ...overrides,
  };
}

describe("DetectionsPage queue filter", () => {
  it("explains the one-word options behind the `?` beside the bar", () => {
    useApiResource.mockReturnValue({ data: payload(), error: null });

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
    expect(tooltip).toHaveTextContent("a manual pass on the form");
    // The options themselves carry no native hover text: Vidit never uses it.
    for (const label of ["All", "Ready", "Incomplete"]) {
      expect(screen.getByRole("button", { name: label })).not.toHaveAttribute("title");
    }
  });

  it("asks the server for the filtered queue instead of hiding loaded rows", () => {
    // The bug this replaces: the toggle filtered the ten rows on screen while
    // the pager cut pages server-side, so an analyst whose first page happened
    // to hold ten incomplete drafts read "no ready drafts" over a queue that
    // held hundreds of them.
    useApiResource.mockReturnValue({ data: payload(), error: null });
    render(<DetectionsPage />);

    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=1&per_page=10&readiness=all"
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=1&per_page=10&readiness=ready"
    );

    fireEvent.click(screen.getByRole("button", { name: "Incomplete" }));
    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=1&per_page=10&readiness=incomplete"
    );
  });

  it("restarts the walk at page 1 when the filter changes", () => {
    // Page 4 of the whole queue is not page 4 of the ready one; keeping the
    // number would land past the end of the filtered set and read as empty.
    useApiResource.mockReturnValue({
      data: payload({ total: 40, page: 1, ready_total: 12, incomplete_total: 28 }),
      error: null,
    });
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=2&per_page=10&readiness=all"
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=1&per_page=10&readiness=ready"
    );
  });

  it("states the whole queue's split under every filter", () => {
    // The two figures are the answer to "how much of my import is usable",
    // and they must not depend on which page is loaded or which filter is on.
    useApiResource.mockReturnValue({
      data: payload({ total: 12, ready_total: 12, incomplete_total: 28 }),
      error: null,
    });
    render(<DetectionsPage />);

    expect(screen.getByText(/12 ready · 28 incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/on this page/)).not.toBeInTheDocument();
  });

  it("pages over the filtered total, and names it", () => {
    useApiResource.mockReturnValue({
      data: payload({ total: 12, ready_total: 12, incomplete_total: 28 }),
      error: null,
    });
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    // 12 ready rows at 10 a page: two pages, not the four the whole queue
    // would have.
    expect(screen.getByText(/Page 1 of 2 · 12 ready/)).toBeInTheDocument();
  });

  it("says which set came back empty, without blaming the page", () => {
    useApiResource.mockReturnValue({
      data: payload({ items: [], total: 0, ready_total: 0, incomplete_total: 7 }),
      error: null,
    });
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(screen.getByText("No ready drafts.")).toBeInTheDocument();
    // The queue itself is not empty, so the import pitch stays away and the
    // toggle stays on screen to switch back with.
    expect(screen.queryByText("No detections to submit.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Incomplete" })).toBeInTheDocument();
  });

  it("keeps the import pitch for a queue that is genuinely empty", () => {
    useApiResource.mockReturnValue({
      data: payload({ items: [], total: 0, ready_total: 0, incomplete_total: 0 }),
      error: null,
    });
    render(<DetectionsPage />);

    expect(screen.getByText("No detections to submit.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ready" })).not.toBeInTheDocument();
  });
});
