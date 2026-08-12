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

  // An image tile is cropped to the tile, so the tile itself is the affordance
  // for seeing it uncropped.
  it("opens the viewer from an image tile", () => {
    render(<MediaGallery media={[IMAGE]} alt="A street corner" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Named by its alt, so several tiles in one gallery stay distinguishable.
    fireEvent.click(
      screen.getByRole("button", { name: "View image: A street corner" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // A video tile is the shared player and nothing else: its bar owns play,
  // scrub, download and the expand-to-lightbox control (via `onExpand`), so
  // the tile carries no floating controls of its own. The download inside the
  // bar answers to the same name, hence the count rather than an absence.
  it("plays a video tile in the shared player, with no floating tile controls", () => {
    const { container } = render(<MediaGallery media={[VIDEO]} alt="A clip" />);

    expect(container.querySelector("media-controller")).not.toBeNull();
    expect(container.querySelector("video[controls]")).toBeNull();
    expect(screen.queryByRole("button", { name: /^View image/ })).toBeNull();
    // The one download is the player's own, sitting in its control bar rather
    // than floating over the tile.
    expect(
      screen.getByRole("button", { name: "Download" }).closest("media-control-bar"),
    ).not.toBeNull();
  });

  // The tile's expand control opens the same viewer an image tile opens, so
  // "see it bigger" is one gesture across media types.
  it("opens the viewer from a video tile's expand control", () => {
    render(<MediaGallery media={[VIDEO]} alt="A clip" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // The image tile's download is the only floating control left in the block.
  it("carries a download on an image tile, revealed on hover", () => {
    const { container } = render(<MediaGallery media={[IMAGE]} alt="T" />);

    const download = screen.getByRole("button", { name: "Download" });
    // Transparent at rest inside the tile's `group`, so the picture reads
    // uncovered until the pointer arrives (and always shown on touch).
    expect(download.parentElement).toHaveClass("opacity-0", "group-hover:opacity-100");
    expect(container.querySelector(".group")).not.toBeNull();
  });
});
