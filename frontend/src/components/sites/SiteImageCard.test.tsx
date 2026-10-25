import { describe, expect, it } from "vitest";

import type { SiteImage } from "@/lib/sites";
import { imageChoiceLabels } from "./SiteImageCard";

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

describe("imageChoiceLabels", () => {
  it("names an image by its capture day and provider", () => {
    const labels = imageChoiceLabels([image("a", "2026-09-07T10:30:00Z", "mira")]);
    expect(labels.get("a")).toBe("Image of 7 Sept 2026, Copernicus Browser");
  });

  it("adds who filed it when two images of one day and provider would read the same", () => {
    const labels = imageChoiceLabels([
      image("a", "2026-09-07T10:30:00Z", "mira"),
      image("b", "2026-09-07T11:00:00Z", "rhea"),
      image("c", "2026-06-18T10:30:00Z", "mira"),
    ]);
    expect(labels.get("a")).toBe("Image of 7 Sept 2026, Copernicus Browser, filed by mira");
    expect(labels.get("b")).toBe("Image of 7 Sept 2026, Copernicus Browser, filed by rhea");
    expect(labels.get("c")).toBe("Image of 18 Jun 2026, Copernicus Browser");
  });
});
