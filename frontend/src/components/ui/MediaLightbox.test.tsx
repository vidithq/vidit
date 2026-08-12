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
    const { container } = render(
      <MediaLightbox source={IMAGE} alt="A street corner" onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "A street corner");
    // Portalled out of the caller's markup, so a viewer opened from a scrolling
    // or transformed surface (the map's detail panel, a proof body) still
    // covers the viewport instead of being clipped inside it.
    expect(container).toBeEmptyDOMElement();
    expect(dialog.parentElement).toBe(document.body);
    // An image views at the hero derivative, not the original.
    expect(screen.getByAltText("A street corner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closes on the close button, on Escape, and on a backdrop click, but not on a content click", () => {
    const onClose = vi.fn();
    render(<MediaLightbox source={IMAGE} alt="A street corner" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);

    // The content click is stopped, so a click on the media (or a video's own
    // controls) never dismisses the viewer.
    const content = screen.getByRole("dialog").querySelector(":scope > div");
    fireEvent.click(content!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("plays a video in the shared player, which owns its own download", () => {
    render(<MediaLightbox source={VIDEO} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");

    expect(dialog.querySelector("media-controller")).not.toBeNull();
    expect(dialog.querySelector("video[controls]")).toBeNull();
    // The player's control bar carries the download, so the corner would show a
    // second one. Close stays, since only the overlay can dismiss itself.
    expect(
      screen.getByRole("button", { name: "Download" }).closest("media-control-bar"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    // This is the context that owns the real full screen, so no expand.
    expect(dialog.querySelector("media-fullscreen-button")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Expand video" })).toBeNull();
  });

  // A player put into real fullscreen layers over the overlay, and the browser
  // exits it on Escape by itself. Closing here too would collapse both layers
  // from one press and drop the reader back onto the page.
  it("leaves Escape to fullscreen while a player is fullscreen", () => {
    const onClose = vi.fn();
    render(<MediaLightbox source={VIDEO} onClose={onClose} />);

    const fullscreen = { configurable: true, value: document.createElement("div") };
    Object.defineProperty(document, "fullscreenElement", fullscreen);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    // Out of fullscreen, the same key closes the viewer as before.
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes the keyboard on open and hands it back on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<MediaLightbox source={IMAGE} onClose={vi.fn()} />);
    // The dialog's own exit is where the keyboard lands, not wherever the page
    // happened to leave it.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));

    // Tab wraps inside the overlay rather than walking out into the page under
    // the backdrop.
    const stops = screen
      .getAllByRole("button")
      .filter((el) => screen.getByRole("dialog").contains(el));
    stops[stops.length - 1].focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(stops[0]);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
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
