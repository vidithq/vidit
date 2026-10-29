import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Site, SiteSource } from "@/lib/sites";

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), admin: true }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
  ApiError: class extends Error {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u2", username: "bo" } }),
}));
vi.mock("@/contexts/AdminContext", () => ({
  useAdmin: () => ({ isAdmin: api.admin, loading: false }),
}));

import { useSiteActions } from "./useSiteActions";

const SOURCE: SiteSource = {
  id: "s1",
  title: "Pass",
  level: "context",
  kind: "satellite",
  captured_at: "2026-09-07T09:00:00Z",
  capture_position: null,
  is_graphic: false,
  links: [],
  tags: [],
  media: null,
  warnings: [],
  provider: null,
  note: null,
  author: { id: "u2", username: "bo" },
  created_at: "2026-10-01T00:00:00Z",
};

const SITE: Site = {
  id: "site-1",
  name: "Depot",
  kind: "depot",
  zone: { type: "Polygon", coordinates: [] },
  centroid: { lat: 48, lng: 37 },
  contour_id: "c1",
  last_source: null,
  latest_link_effect: null,
  media: null,
  owner: { id: "u1", username: "ana" },
  version_no: 1,
  hidden_at: null,
  sources: [SOURCE],
  contours: [],
  linked_events: [],
  created_at: "2026-01-06T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
};

function Actions({ site, onChanged }: { site: Site; onChanged: () => void }) {
  const { pinned, panels, sourceControls } = useSiteActions({ site, onChanged });
  return (
    <>
      {pinned}
      {panels}
      {sourceControls(SOURCE)}
    </>
  );
}

beforeEach(() => {
  api.apiFetch.mockReset();
  api.apiFetch.mockResolvedValue({});
  api.admin = true;
});

describe("useSiteActions", () => {
  it("withholds the site on the second click of its in-place confirm, with no dialog", async () => {
    const onChanged = vi.fn();
    render(<Actions site={SITE} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Withhold the site" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withhold the site" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/sites/site-1/moderation", {
        method: "PATCH",
        body: JSON.stringify({ hidden: true }),
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("restores a withheld site at once", async () => {
    render(<Actions site={{ ...SITE, hidden_at: "2026-10-01T00:00:00Z" }} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore the site" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/sites/site-1/moderation", {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      }),
    );
  });

  it("removes its filer's source on the second click, and shows a refusal in the panels", async () => {
    api.admin = false;
    api.apiFetch.mockRejectedValue(new Error("The source carries a contour"));
    render(<Actions site={SITE} onChanged={vi.fn()} />);

    const remove = screen.getByRole("button", { name: /^Remove / });
    fireEvent.click(remove);
    expect(api.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Confirm remove / }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/sites/site-1/sources/s1", { method: "DELETE" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("carries a contour");
  });
});
