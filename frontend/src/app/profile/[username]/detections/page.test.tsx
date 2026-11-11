import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FIELD_HELP } from "@/lib/fieldHelp";

vi.mock("next/navigation", () => ({
  useParams: () => ({ username: "ana" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/hooks/useRequireAuth", () => import("@/test/requireAuthStub"));

import { ApiError, apiFetchPage } from "@/test/apiStub";
vi.mock("@/lib/api", () => import("@/test/apiStub"));

import type { EventDetail } from "@/types";
import { eventDetail } from "@/test/eventDetail";

import DetectionsPage from "./page";

const detectionFixture = (overrides: Partial<EventDetail> = {}) =>
  eventDetail("d1", "Strike near Bakhmut", { status: "detected", geolocated_at: null, ...overrides });

const pageOf = (path: string) => Number(new URLSearchParams(path.split("?")[1]).get("page"));

/** Answers every page read with `overrides`, the page number read off the path. */
function answer(overrides: (path: string) => Record<string, unknown> = () => ({})) {
  apiFetchPage.mockImplementation(async (path: string) => ({
    items: {
      items: [detectionFixture()],
      total: 1,
      page: pageOf(path),
      per_page: 10,
      ready_total: 1,
      incomplete_total: 0,
      ...overrides(path),
    },
    nextCursor: null,
  }));
}

const lastPath = () => apiFetchPage.mock.calls.at(-1)?.[0];

beforeEach(() => answer());

describe("DetectionsPage queue filter", () => {
  it("explains the one-word options behind the `?` beside the bar", async () => {
    render(<DetectionsPage />);

    // The labels do not say what they select, so one house `?` carries the sentence for the bar.
    const help = await screen.findByRole("button", {
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

  it("asks the server for the filtered queue instead of hiding loaded rows", async () => {
    // Regression: the toggle used to filter the loaded ten rows while the pager cut server-side, reading "no ready detections" over a large queue.
    render(<DetectionsPage />);

    await screen.findByText("Strike near Bakhmut");
    expect(lastPath()).toBe("/events/detections?page=1&per_page=10&readiness=all");

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(lastPath()).toBe("/events/detections?page=1&per_page=10&readiness=ready");

    fireEvent.click(await screen.findByRole("button", { name: "Incomplete" }));
    expect(lastPath()).toBe("/events/detections?page=1&per_page=10&readiness=incomplete");
  });

  it("restarts the walk at page 1 when the filter changes", async () => {
    // A filter change resets the page: keeping it could land past the end of the filtered set.
    answer((path) => ({
      items: [detectionFixture({ id: pageOf(path) === 2 ? "d2" : "d1" })],
      total: 40,
      ready_total: 12,
      incomplete_total: 28,
    }));
    render(<DetectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(lastPath()).toBe("/events/detections?page=2&per_page=10&readiness=all");

    fireEvent.click(await screen.findByRole("button", { name: "Ready" }));
    expect(lastPath()).toBe("/events/detections?page=1&per_page=10&readiness=ready");
  });

  it("appends the next page under the rows already loaded", async () => {
    answer((path) => ({
      items: [
        detectionFixture(
          pageOf(path) === 2 ? { id: "d2", title: "Strike near Avdiivka" } : { id: "d1" },
        ),
      ],
      total: 2,
      per_page: 1,
    }));
    render(<DetectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Strike near Avdiivka")).toBeInTheDocument();
    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    // The walk ends with the last row.
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("keeps the loaded rows when a later page fails, and retries it", async () => {
    answer(() => ({ total: 20 }));
    render(<DetectionsPage />);
    apiFetchPage.mockRejectedValueOnce(
      new ApiError("Retry in a moment.", 500, null, false, {
        title: "Vidit hit a problem",
        message: "Retry in a moment.",
        fields: {},
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Vidit hit a problem")).toBeInTheDocument();
    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(lastPath()).toBe("/events/detections?page=2&per_page=10&readiness=all");
  });

  it("states a failed queue read in the error banner", async () => {
    apiFetchPage.mockRejectedValue(new ApiError("Server error", 500));
    render(<DetectionsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  });

  it("states the whole queue's split under every filter", async () => {
    // The two figures must not depend on the loaded page or the filter.
    answer(() => ({ total: 12, ready_total: 12, incomplete_total: 28 }));
    render(<DetectionsPage />);

    expect(await screen.findByText(/12 ready · 28 incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/on this page/)).not.toBeInTheDocument();
  });

  it("names the queue in the filter's words only, with no helper line under the title", async () => {
    answer(() => ({ total: 40, ready_total: 12, incomplete_total: 28 }));
    render(<DetectionsPage />);

    expect(await screen.findByText("1 of 40 detections")).toBeInTheDocument();
    expect(screen.queryByText(/awaiting|pending|to submit|To confirm|Missing/)).toBeNull();
  });

  it("counts the loaded rows against the filtered total, and names it", async () => {
    answer(() => ({ total: 12, ready_total: 12, incomplete_total: 28 }));
    render(<DetectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Ready" }));
    expect(await screen.findByText("1 of 12 ready")).toBeInTheDocument();
  });

  it("says which set came back empty, without blaming the page", async () => {
    answer(() => ({ items: [], total: 0, ready_total: 0, incomplete_total: 7 }));
    render(<DetectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Ready" }));
    expect(await screen.findByText("No ready detections.")).toBeInTheDocument();
    // The queue is not empty, so the toggle stays.
    expect(screen.queryByText("Nothing left to review.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Incomplete" })).toBeInTheDocument();
  });

  it("reduces an emptied queue to one line, with no import pitch or link", async () => {
    answer(() => ({ items: [], total: 0, ready_total: 0, incomplete_total: 0 }));
    render(<DetectionsPage />);

    expect(await screen.findByText("Nothing left to review.")).toBeInTheDocument();
    // The header's back arrow returns to the profile; the list adds no control of its own.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ready" })).not.toBeInTheDocument();
  });
});
