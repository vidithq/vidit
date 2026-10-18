import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import GuidePage from "./page";

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

  it("holds the six sections in order, each behind a stable anchor the intro links", () => {
    const { container } = render(<GuidePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Getting started" }),
    ).toBeInTheDocument();
    const ids = Array.from(container.querySelectorAll("h2[id]")).map((h) => h.id);
    expect(ids).toEqual(ANCHORS);
    for (const id of ANCHORS) {
      expect(container.querySelector(`a[href="#${id}"]`)).not.toBeNull();
    }
  });

  it("links each way in from X to its section of the import guide", () => {
    const { container } = render(<GuidePage />);

    for (const anchor of ["#detection", "#archive", "#paste", "#bot"]) {
      expect(container.querySelector(`a[href="/import${anchor}"]`)).not.toBeNull();
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
