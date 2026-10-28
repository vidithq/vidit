import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchPage: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  apiFetchPage: api.apiFetchPage,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { ReportsPanel } from "./ReportsPanel";

const report = (id: string) => ({
  id,
  event_id: `event-${id}`,
  event: {
    id: `event-${id}`,
    title: `Strike ${id}`,
    owner: { id: "u2", username: "reported_author", avatar_url: null },
  },
  collection: null,
  reason: "other",
  details: `Report ${id}`,
  reporter_id: null,
  created_at: "2026-10-01T00:00:00Z",
  resolved_at: null,
  resolution: null,
});

const page = (ids: string[], pageNo: number, total: number) => ({
  items: { items: ids.map(report), total, page: pageNo, per_page: 20 },
  nextCursor: null,
});

beforeEach(() => {
  api.apiFetch.mockReset();
  api.apiFetchPage.mockReset();
});

describe("<ReportsPanel>", () => {
  it("walks the offset pages with Show more", async () => {
    api.apiFetchPage
      .mockResolvedValueOnce(page(["r1"], 1, 21))
      .mockResolvedValueOnce(page(["r2"], 2, 21));
    render(<ReportsPanel />);

    expect(await screen.findByText("Report r1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Report r2")).toBeInTheDocument();
    expect(screen.getByText("Report r1")).toBeInTheDocument();
    expect(api.apiFetchPage.mock.calls.map((call) => call[0])).toEqual([
      "/admin/reports?page=1&per_page=20",
      "/admin/reports?page=2&per_page=20",
    ]);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("names a reported event by its title and author", async () => {
    api.apiFetchPage.mockResolvedValue(page(["r1"], 1, 1));
    render(<ReportsPanel />);

    expect(await screen.findByRole("link", { name: "Strike r1" })).toHaveAttribute(
      "href",
      "/events/event-r1",
    );
    expect(screen.getByText("reported_author")).toBeInTheDocument();
    expect(screen.queryByText("Open the event")).toBeNull();
  });

  it("hides the event only from the confirm dialog", async () => {
    api.apiFetchPage.mockResolvedValue(page(["r1"], 1, 1));
    api.apiFetch.mockResolvedValue({});
    render(<ReportsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Hide the event" }));
    expect(api.apiFetch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide the event" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/reports/r1/resolve", {
        method: "POST",
        body: JSON.stringify({ resolution: "hidden" }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a collection its owner deleted judgeable", async () => {
    const deleted = {
      ...report("r1"),
      event_id: null,
      event: null,
      collection: {
        id: "c1",
        title: "Deleted shelf",
        owner: { id: "u1", username: "owner", avatar_url: null },
        deleted_at: "2026-10-02T00:00:00Z",
      },
    };
    api.apiFetchPage.mockResolvedValue({
      items: { items: [deleted], total: 1, page: 1, per_page: 20 },
      nextCursor: null,
    });
    render(<ReportsPanel />);

    expect(await screen.findByText("Deleted by its owner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deleted shelf" })).toBeInTheDocument();
    expect(screen.queryByText("Reported item deleted")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide the collection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("names a reported site and offers to hide it, not to mark it graphic", async () => {
    const site = {
      ...report("r1"),
      event_id: null,
      event: null,
      site: { id: "s1", name: "Kerrin Flats depot", owner: { id: "u1", username: "owner", avatar_url: null } },
    };
    api.apiFetchPage.mockResolvedValue({
      items: { items: [site], total: 1, page: 1, per_page: 20 },
      nextCursor: null,
    });
    render(<ReportsPanel />);

    expect(await screen.findByRole("link", { name: "Kerrin Flats depot" })).toHaveAttribute("href", "/sites/s1");
    expect(screen.getByRole("button", { name: "Hide the site" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark graphic" })).toBeNull();
    expect(screen.queryByText("Reported item deleted")).toBeNull();
  });
});
