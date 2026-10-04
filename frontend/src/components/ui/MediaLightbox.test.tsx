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
    // Portalled, so a scrolling or transformed caller cannot clip it.
    expect(container).toBeEmptyDOMElement();
    expect(dialog.parentElement).toBe(document.body);
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

    // Clicking the media itself, not its box, survives changes to the backdrop
    // framing.
    fireEvent.click(screen.getByAltText("A street corner"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("plays a video in the shared player, which owns its own download", () => {
    render(<MediaLightbox source={VIDEO} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");

    expect(dialog.querySelector("media-controller")).not.toBeNull();
    expect(dialog.querySelector("video[controls]")).toBeNull();
    // The bar carries the download, so no corner copy. Close stays.
    expect(
      screen.getByRole("button", { name: "Download" }).closest("media-control-bar"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(dialog.querySelector("media-fullscreen-button")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Expand video" })).toBeNull();
  });

  // Fullscreen owns Escape: closing here too would collapse both layers.
  it("leaves Escape to fullscreen while a player is fullscreen", () => {
    const onClose = vi.fn();
    render(<MediaLightbox source={VIDEO} onClose={onClose} />);

    const fullscreen = { configurable: true, value: document.createElement("div") };
    Object.defineProperty(document, "fullscreenElement", fullscreen);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));

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

    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "picked.jpg");
  });
});
