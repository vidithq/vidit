import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Site, SiteSource } from "@/lib/sites";
import { SitePanel } from "./SitePanel";

const ZONE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [37.8, 48.01],
      [37.81, 48.01],
      [37.81, 48.02],
      [37.8, 48.01],
    ] as [number, number][],
  ],
};

function source(id: string, title: string, capturedAt: string): SiteSource {
  return {
    id,
    title,
    level: "context",
    kind: "satellite",
    captured_at: capturedAt,
    capture_position: null,
    is_graphic: false,
    links: [],
    tags: [],
    media: null,
    warnings: [],
    provider: null,
    note: null,
    author: null,
    created_at: "2026-10-01T00:00:00Z",
  };
}

const SITE: Site = {
  id: "site-1",
  name: "Depot",
  kind: "depot",
  zone: ZONE,
  centroid: { lat: 48.015883, lng: 37.802411 },
  contour_id: "c1",
  last_source: null,
  latest_link_effect: null,
  media: null,
  owner: { id: "u1", username: "ana" },
  version_no: 1,
  hidden_at: null,
  // Served oldest capture first; the panel shows the newest, as the site page opens on it.
  sources: [
    source("s1", "Older pass", "2026-01-05T09:00:00Z"),
    source("s2", "Newest pass", "2026-09-07T09:00:00Z"),
    source("s3", "Middle pass", "2026-05-01T09:00:00Z"),
  ],
  contours: [],
  linked_events: [],
  created_at: "2026-01-06T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
};

function renderPanel(site: Site) {
  render(
    <SitePanel
      resource={{ data: site, error: null, loading: false, refetch: () => {} }}
      onClose={() => {}}
    />,
  );
}

describe("SitePanel", () => {
  it("links the name to the site page and offers no separate link to it", () => {
    renderPanel(SITE);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(within(heading).getByRole("link", { name: "Depot" })).toHaveAttribute("href", "/sites/site-1");
    expect(screen.queryByText("Open the site page")).toBeNull();
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
  });

  it("shows the latest source alone, in the event panel's blocks", () => {
    renderPanel(SITE);
    expect(screen.getByText("Newest pass")).toBeInTheDocument();
    expect(screen.queryByText("Older pass")).toBeNull();
    expect(screen.queryByText("Middle pass")).toBeNull();
    const sections = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(sections).toEqual(["Sources", "Location", "Details"]);
    expect(screen.getByText("48.015883, 37.802411")).toBeInTheDocument();
  });
});
