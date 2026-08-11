import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VideoPlayer } from "./VideoPlayer";
import type { Media } from "@/types";

const VIDEO: Media = {
  id: "v1",
  role: "source",
  storage_url: "/media/clip.mp4",
  media_type: "video",
  sha256: null,
  original_filename: "dashcam-original.mp4",
};

// media-chrome's elements register on import, so the controller and its bar are
// real elements here; jsdom runs no layout and decodes no media, so what the
// controls *show* (a duration, a fullscreen state) never fills in. These assert
// the contract the surfaces depend on: the player mounts around a native video
// that carries the app's own playback settings, the bar holds exactly the
// intended controls, and the big-view control follows the context.
describe("VideoPlayer", () => {
  it("mounts a controller around a named native video that fills its container", () => {
    const { container } = render(
      <VideoPlayer src={VIDEO.storage_url} source={VIDEO} title="A dashcam clip" />,
    );

    const controller = container.querySelector("media-controller");
    expect(controller).not.toBeNull();
    // Fills the tile, so the container's height governs the box.
    expect(controller).toHaveClass("h-full", "w-full");
    // The bar fades out after two undisturbed seconds of playback and returns
    // on pointer move, hover or focus. The controller keeps the delay on the
    // element itself rather than reflecting it to an attribute.
    expect((controller as unknown as { autohide: string }).autohide).toBe("2");

    const video = container.querySelector("video");
    expect(video).toHaveAttribute("slot", "media");
    expect(video).toHaveAccessibleName("A dashcam clip");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    // The browser's own chrome stays off: the bar is the only control surface.
    expect(video).not.toHaveAttribute("controls");
    // A stored clip carries no poster derivative, so the media fragment makes
    // the browser paint the frame a tenth of a second in.
    expect(video).toHaveAttribute("src", "/media/clip.mp4#t=0.1");
  });

  it("takes sizing from the call site", () => {
    const { container } = render(
      <VideoPlayer src={VIDEO.storage_url} source={VIDEO} className="max-w-4xl" />,
    );

    expect(container.querySelector("media-controller")).toHaveClass("max-w-4xl");
  });

  // The bar is stripped to what an analyst uses on evidence clips. Casting,
  // PiP, playback speed and captions are not rendered at all.
  it("carries exactly play, scrub, time, volume, download and one big-view control", () => {
    const { container } = render(<VideoPlayer src={VIDEO.storage_url} source={VIDEO} />);

    const bar = container.querySelector("media-control-bar");
    expect([...bar!.children].map((el) => el.localName)).toEqual([
      "media-play-button",
      "media-time-range",
      "media-time-display",
      "media-mute-button",
      "media-volume-range",
      "button",
      "media-fullscreen-button",
    ]);
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  // A tile expands into the shared lightbox, which is where the real full
  // screen lives, so one big-view icon shows per context.
  it("swaps fullscreen for an expand control when the context can enlarge", () => {
    const onExpand = vi.fn();
    const { container } = render(
      <VideoPlayer src={VIDEO.storage_url} source={VIDEO} onExpand={onExpand} />,
    );

    expect(container.querySelector("media-fullscreen-button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  // A clip the browser refuses swaps to the shared notice instead of leaving a
  // silent black box.
  it("says so when the clip fails to load", () => {
    const { container } = render(
      <VideoPlayer src="/media/broken.mp4" source={VIDEO} compact />,
    );

    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByText("Video unavailable")).toBeInTheDocument();
    expect(container.querySelector("media-controller")).toBeNull();
  });
});
