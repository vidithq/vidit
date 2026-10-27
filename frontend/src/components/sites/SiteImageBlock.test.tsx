import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceBlocks } from "@/components/sources/SourceBlock";
import type { SiteImage } from "@/lib/sites";
import { siteImageExtras } from "./SiteImageBlock";

function image(id: string, capturedAt: string, author: string): SiteImage {
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
  } as SiteImage;
}

describe("siteImageExtras", () => {
  const images = [image("a", "2026-09-07T10:30:00Z", "mira"), image("b", "2026-06-18T10:30:00Z", "rhea")];

  function renderHistory(shownId: string, onShow = vi.fn()) {
    render(
      <SourceBlocks
        sources={images}
        alt="Depot"
        extras={(i) => siteImageExtras({ image: i, contour: null, shown: i.id === shownId, onShow })}
      />,
    );
    return onShow;
  }

  it("renders each image as the event page's source block in the Sources row", () => {
    renderHistory("a");
    expect(screen.getByText("Sources (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next source" })).toBeInTheDocument();
    const block = screen.getByRole("region", { name: "Image of 7 Sept 2026" });
    for (const label of ["Level", "Kind", "Captured", "Provider", "Filed"]) {
      expect(within(block).getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the image on show and offers the others to the map", () => {
    const onShow = renderHistory("a");
    const shown = screen.getByRole("region", { name: "Image of 7 Sept 2026" });
    expect(within(shown).getByText("On the map")).toBeInTheDocument();
    const other = screen.getByRole("region", { name: "Image of 18 Jun 2026" });
    fireEvent.click(
      within(other).getByRole("button", { name: "Show the zone of the image of 18 Jun 2026 on the map" }),
    );
    expect(onShow).toHaveBeenCalledOnce();
  });
});
