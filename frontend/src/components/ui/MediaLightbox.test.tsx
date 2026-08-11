import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MediaLightbox } from "./MediaLightbox";
import type { Media } from "@/types";

const IMAGE: Media = {
  id: "m1",
  role: "source",
  storage_url: "/media/shot.jpg",
  media_type: "image",
  sha256: null,
  original_filename: "shot.jpg",
};

const VIDEO: Media = { ...IMAGE, id: "m2", storage_url: "/media/clip.mp4", media_type: "video" };

describe("MediaLightbox", () => {
  it("is a labelled modal dialog carrying the media and a download", () => {
    render(<MediaLightbox source={IMAGE} alt="A street corner" onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "A street corner");
    // An image views at the hero derivative, not the original.
    expect(screen.getByAltText("A street corner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closes on the close button, on Escape, and on a backdrop click, but not on a content click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <MediaLightbox source={IMAGE} alt="A street corner" onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);

    // The content click is stopped, so a click on the media (or a video's own
    // controls) never dismisses the viewer.
    const content = container.querySelector("[role=dialog] > div");
    fireEvent.click(content!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("plays a video in the shared player, which owns its own download", () => {
    const { container } = render(<MediaLightbox source={VIDEO} onClose={vi.fn()} />);

    expect(container.querySelector("media-controller")).not.toBeNull();
    expect(container.querySelector("video[controls]")).toBeNull();
    // The player's control bar carries the download, so the corner would show a
    // second one. Close stays, since only the overlay can dismiss itself.
    expect(
      screen.getByRole("button", { name: "Download" }).closest("media-control-bar"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    // This is the context that owns the real full screen, so no expand.
    expect(container.querySelector("media-fullscreen-button")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Expand video" })).toBeNull();
  });

  it("takes a plain {src, kind} source, downloadable like a persisted row", () => {
    render(
      <MediaLightbox
        source={{ src: "blob:staged-1", kind: "image", filename: "picked.jpg" }}
        onClose={vi.fn()}
      />,
    );

    // A plain URL is saveable too (a proof image has no Media row).
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    // Falls back to the filename for the dialog's accessible name.
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "picked.jpg");
  });
});
