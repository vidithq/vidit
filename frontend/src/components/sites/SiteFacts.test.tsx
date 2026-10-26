import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Site } from "@/lib/sites";
import { SiteDetails } from "./SiteFacts";

const SITE = {
  id: "s1",
  name: "Depot",
  kind: "depot",
  owner: { id: "u1", username: "mira", avatar_url: null },
  is_corroborated: true,
  corroboration_count: 3,
  last_image: {
    id: "i1",
    captured_at: "2026-09-07T10:30:00Z",
    provider: { id: "copernicus_browser", name: "Copernicus Browser" },
  },
  latest_link_effect: { effect: "damage", occurred_date: "2026-09-05", event_id: "e1" },
  hidden_at: null,
  created_at: "2026-01-01T10:00:00Z",
} as unknown as Site;

// Each row's label, in render order.
const rowLabels = () =>
  Array.from(document.querySelectorAll(":scope div > div > span:first-child")).map((n) =>
    n.textContent?.trim(),
  );

describe("SiteDetails", () => {
  it("reads the owner, the kind, the last image, the latest effect, the corroboration and the creation", () => {
    render(<SiteDetails site={SITE} />);
    expect(rowLabels()).toEqual([
      "Owner",
      "Kind",
      "Last image",
      "Latest effect",
      "Corroboration",
      "Created",
    ]);
    expect(screen.getByText("Corroborated by 3 analysts")).toBeInTheDocument();
    expect(screen.getByText("7 Sept 2026, Copernicus Browser")).toBeInTheDocument();
  });

  it("adds Withheld on a withheld site and drops the effect without one", () => {
    render(
      <SiteDetails
        site={{ ...SITE, is_corroborated: false, latest_link_effect: null, hidden_at: "2026-10-02T08:00:00Z" }}
      />,
    );
    expect(rowLabels()).toEqual(["Owner", "Kind", "Last image", "Corroboration", "Created", "Withheld"]);
    expect(screen.getByText("Not corroborated")).toBeInTheDocument();
  });
});
