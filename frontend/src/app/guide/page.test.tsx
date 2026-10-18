import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import GuidePage from "./page";
import SHOTS from "./shots.json";

const ANCHORS = [
  "layout",
  "reading-a-geolocation",
  "statuses",
  "bringing-your-work-in",
  "working-with-others",
  "settings",
];

describe("/guide", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("holds the six sections in order, each behind a stable anchor an intro tile links", () => {
    const { container } = render(<GuidePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Getting started" }),
    ).toBeInTheDocument();
    const ids = Array.from(container.querySelectorAll("h2[id]")).map((h) => h.id);
    expect(ids).toEqual(ANCHORS);
    const intro = container.querySelector("section")!;
    const tiles = Array.from(intro.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(tiles).toEqual(ANCHORS.map((id) => `#${id}`));
  });

  it("links each way in to its section of the import guide, and the submit form", () => {
    const { container } = render(<GuidePage />);

    for (const href of ["/import#detection", "/import#archive", "/import#paste", "/import#bot", "/submit"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("numbers each screenshot's legend from the marker list the capture script reads", () => {
    render(<GuidePage />);

    for (const shot of Object.values(SHOTS)) {
      const figure = screen.getByAltText(shot.alt).closest("figure")!;
      const legend = within(figure).getAllByRole("listitem").map((li) => li.textContent);
      expect(legend).toEqual(shot.markers.map(({ label }, i) => `${i + 1}${label}`));
    }
  });

  it("renders the walkthrough video only when its URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_GUIDE_VIDEO_URL", "");
    const { container, unmount } = render(<GuidePage />);
    expect(container.querySelector("video")).toBeNull();
    unmount();

    vi.stubEnv("NEXT_PUBLIC_GUIDE_VIDEO_URL", "https://cdn.example/landing/guide.mp4");
    const rendered = render(<GuidePage />);
    const video = rendered.container.querySelector("video");
    expect(video).toHaveAttribute("src", "https://cdn.example/landing/guide.mp4");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(
      screen.getByRole("button", { name: "Play the walkthrough video" }),
    ).toBeInTheDocument();
  });
});
