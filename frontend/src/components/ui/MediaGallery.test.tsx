import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MediaGallery } from "./MediaGallery";
import type { Media } from "@/types";

const IMAGE: Media = {
  id: "i",
  role: "source",
  storage_url: "/media/a.jpg",
  media_type: "image",
  sha256: null,
  original_filename: "a.jpg",
};

const VIDEO: Media = { ...IMAGE, id: "v", storage_url: "/media/a.mp4", media_type: "video" };

describe("MediaGallery", () => {
  it("says so when there is no media", () => {
    render(<MediaGallery media={[]} alt="T" />);
    expect(screen.getByText("No media available")).toBeInTheDocument();
  });

  // The tile itself opens the uncropped view.
  it("opens the viewer from an image tile", () => {
    render(<MediaGallery media={[IMAGE]} alt="A street corner" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Named by its alt, so several tiles stay distinguishable.
    fireEvent.click(
      screen.getByRole("button", { name: "View image: A street corner" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // A video tile is the shared player: its bar owns play, scrub, download and
  // expand (`onExpand`). The bar download shares the name, hence the count.
  it("plays a video tile in the shared player, with no floating tile controls", () => {
    const { container } = render(<MediaGallery media={[VIDEO]} alt="A clip" />);

    expect(container.querySelector("media-controller")).not.toBeNull();
    expect(container.querySelector("video[controls]")).toBeNull();
    expect(screen.queryByRole("button", { name: /^View image/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download" }).closest("media-control-bar"),
    ).not.toBeNull();
  });

  it("opens the viewer from a video tile's expand control", () => {
    render(<MediaGallery media={[VIDEO]} alt="A clip" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("carries a download on an image tile, revealed on hover", () => {
    const { container } = render(<MediaGallery media={[IMAGE]} alt="T" />);

    const download = screen.getByRole("button", { name: "Download" });
    // Transparent at rest, shown on hover (always on touch).
    expect(download.parentElement).toHaveClass("opacity-0", "group-hover:opacity-100");
    expect(container.querySelector(".group")).not.toBeNull();
  });
});
