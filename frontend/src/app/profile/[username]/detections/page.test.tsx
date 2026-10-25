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

function detectionFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "d1",
    title: "Strike near Bakhmut",
    coords: { lat: 48.5, lng: 37.8 },
    occurred_date: "2026-06-01",
    occurred_time: null,
    status: "detected",
    version_no: 1,
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_via: null,
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    sources: [
      {
        id: "s1",
        title: "",
        level: "direct",
        kind: "unknown",
        captured_at: null,
        capture_position: null,
        is_graphic: false,
        links: [{ url: "https://t.me/channel/12345", posted_at: null, archived: null }],
        tags: [],
        media: {
          id: "m1",
          role: "source",
          storage_url: "/local-storage/evidence.jpg",
          kind: "image",
          sha256: "0".repeat(64),
        },
        warnings: [],
      },
    ],
    proof: '<img src="https://cdn.test/p.jpg">',
    created_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    thumbnail: null,
    requested_by: null,
    geolocators: [],
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    items: [detectionFixture()],
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

    // The labels do not say what they select, so one house `?` carries the sentence for the bar.
    const help = screen.getByRole("button", {
      name: FIELD_HELP.detection_queue_filter.label,
    });
    fireEvent.focus(help);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("conflict and the source kind");
    expect(tooltip).toHaveTextContent("a manual pass on the form");
    // The options themselves carry no native hover text: Vidit never uses it.
    for (const label of ["All", "Ready", "Incomplete"]) {
      expect(screen.getByRole("button", { name: label })).not.toHaveAttribute("title");
    }
  });

  it("asks the server for the filtered queue instead of hiding loaded rows", () => {
    // Regression: the toggle used to filter the loaded ten rows while the pager cut server-side, reading "no ready detections" over a large queue.
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
    // A filter change resets the page: keeping it could land past the end of the filtered set.
    useApiResource.mockImplementation((path: string | null) => ({
      data: payload({
        items: [detectionFixture({ id: path?.includes("page=2") ? "d2" : "d1" })],
        total: 40,
        ready_total: 12,
        incomplete_total: 28,
      }),
      error: null,
    }));
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=2&per_page=10&readiness=all"
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(useApiResource).toHaveBeenLastCalledWith(
      "/events/detections?page=1&per_page=10&readiness=ready"
    );
  });

  it("appends the next page under the rows already loaded", () => {
    useApiResource.mockImplementation((path: string | null) => ({
      data: payload({
        items: [
          detectionFixture(
            path?.includes("page=2")
              ? { id: "d2", title: "Strike near Avdiivka" }
              : { id: "d1" },
          ),
        ],
        total: 2,
        per_page: 1,
      }),
      error: null,
    }));
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.getByText("Strike near Avdiivka")).toBeInTheDocument();
    // The walk ends with the last row.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("keeps the loaded rows when a later page fails, and retries it", () => {
    const refetch = vi.fn();
    useApiResource.mockImplementation((path: string | null) =>
      path?.includes("page=2")
        ? { data: null, error: "Server error", refetch }
        : { data: payload({ total: 20 }), error: null, refetch },
    );
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.getByText("Server error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("states a failed queue read in the error banner", () => {
    useApiResource.mockReturnValue({ data: null, error: "Server error", refetch: vi.fn() });
    render(<DetectionsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Server error");
  });

  it("states the whole queue's split under every filter", () => {
    // The two figures must not depend on the loaded page or the filter.
    useApiResource.mockReturnValue({
      data: payload({ total: 12, ready_total: 12, incomplete_total: 28 }),
      error: null,
    });
    render(<DetectionsPage />);

    expect(screen.getByText(/12 ready · 28 incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/on this page/)).not.toBeInTheDocument();
  });

  it("counts the loaded rows against the filtered total, and names it", () => {
    useApiResource.mockReturnValue({
      data: payload({ total: 12, ready_total: 12, incomplete_total: 28 }),
      error: null,
    });
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(screen.getByText("1 of 12 ready")).toBeInTheDocument();
  });

  it("says which set came back empty, without blaming the page", () => {
    useApiResource.mockReturnValue({
      data: payload({ items: [], total: 0, ready_total: 0, incomplete_total: 7 }),
      error: null,
    });
    render(<DetectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(screen.getByText("No ready detections.")).toBeInTheDocument();
    // The queue is not empty, so the toggle stays.
    expect(screen.queryByText("Nothing left to review.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Incomplete" })).toBeInTheDocument();
  });

  it("reduces an emptied queue to one line, with no import pitch or link", () => {
    useApiResource.mockReturnValue({
      data: payload({ items: [], total: 0, ready_total: 0, incomplete_total: 0 }),
      error: null,
    });
    render(<DetectionsPage />);

    expect(screen.getByText("Nothing left to review.")).toBeInTheDocument();
    // The header's back arrow returns to the profile; the list adds no control of its own.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ready" })).not.toBeInTheDocument();
  });
});
