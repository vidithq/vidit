import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceBlocks } from "@/components/sources/SourceBlock";
import type { SiteSource } from "@/lib/sites";
import { siteSourceExtras } from "./SiteSourceBlock";

function source(id: string, capturedAt: string, author: string): SiteSource {
  return {
    id,
    title: "",
    level: "context",
    kind: "satellite",
    captured_at: capturedAt,
    capture_position: null,
    is_graphic: false,
    links: [],
    tags: [],
    media: null,
    warnings: [],
    provider: { id: "copernicus_browser", name: "Copernicus Browser", credit: "", help: "", group: "accepted" },
    author: { id: author, username: author, avatar_url: null },
    note: null,
    created_at: "2026-10-01T00:00:00Z",
  } as SiteSource;
}

describe("siteSourceExtras", () => {
  const sources = [source("a", "2026-09-07T10:30:00Z", "mira"), source("b", "2026-06-18T10:30:00Z", "rhea")];

  function renderHistory(shownId: string, onShow = vi.fn()) {
    render(
      <SourceBlocks
        sources={sources}
        alt="Depot"
        extras={(i) => siteSourceExtras({ source: i, contour: null, shown: i.id === shownId, onShow })}
      />,
    );
    return onShow;
  }

  it("renders each source as the event page's source block in the Sources row", () => {
    renderHistory("a");
    expect(screen.getByText("Sources (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next source" })).toBeInTheDocument();
    const block = screen.getByRole("region", { name: "Source of 7 Sept 2026" });
    for (const label of ["Captured", "Provider", "Filed"]) {
      expect(within(block).getByText(label)).toBeInTheDocument();
    }
  });

  it("drops the rows every site source repeats: the level, the kind and an unknown post time", () => {
    render(
      <SourceBlocks
        sources={[{ ...sources[0], links: [{ url: "https://browser.dataspace.copernicus.eu/", posted_at: null, archived: null }] }]}
        alt="Depot"
        extras={(i) => siteSourceExtras({ source: i, contour: null, shown: true, onShow: vi.fn() })}
      />,
    );
    const block = screen.getByRole("region", { name: "Source of 7 Sept 2026" });
    for (const label of ["Level", "Kind", "Posted"]) {
      expect(within(block).queryByText(label)).toBeNull();
    }
  });

  it("marks the source on show and offers the others to the map", () => {
    const onShow = renderHistory("a");
    const shown = screen.getByRole("region", { name: "Source of 7 Sept 2026" });
    expect(within(shown).getByText("On the map")).toBeInTheDocument();
    const other = screen.getByRole("region", { name: "Source of 18 Jun 2026" });
    fireEvent.click(
      within(other).getByRole("button", { name: "Show the zone of the source of 18 Jun 2026 on the map" }),
    );
    expect(onShow).toHaveBeenCalledOnce();
  });
});
