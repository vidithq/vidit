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

// media-chrome's elements register on import, but jsdom runs no layout and
// decodes no media. These assert the surface contract: a native video with the
// app's playback settings, the intended controls, and the context's big-view
// control.
describe("VideoPlayer", () => {
  it("mounts a controller around a named native video that fills its container", () => {
    const { container } = render(
      <VideoPlayer src={VIDEO.storage_url} source={VIDEO} title="A dashcam clip" />,
    );

    const controller = container.querySelector("media-controller");
    expect(controller).not.toBeNull();
    expect(controller).toHaveClass("h-full", "w-full");
    // Autohide delay (kept on the element, not reflected to an attribute).
    expect((controller as unknown as { autohide: string }).autohide).toBe("2");

    const video = container.querySelector("video");
    expect(video).toHaveAttribute("slot", "media");
    expect(video).toHaveAccessibleName("A dashcam clip");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).not.toHaveAttribute("controls");
    expect(video).toHaveAttribute("src", "/media/clip.mp4#t=0.1");
  });

  it("takes sizing from the call site", () => {
    const { container } = render(
      <VideoPlayer src={VIDEO.storage_url} source={VIDEO} className="max-w-4xl" />,
    );

    expect(container.querySelector("media-controller")).toHaveClass("max-w-4xl");
  });

  // The bar is stripped: no casting, PiP, playback speed or captions.
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

  it("swaps fullscreen for an expand control when the context can enlarge", () => {
    const onExpand = vi.fn();
    const { container } = render(
      <VideoPlayer src={VIDEO.storage_url} source={VIDEO} onExpand={onExpand} />,
    );

    expect(container.querySelector("media-fullscreen-button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("says so when the clip fails to load, keeping the original saveable", () => {
    const { container } = render(
      <VideoPlayer
        src="/media/broken.mp4"
        source={VIDEO}
        compact
        className="max-w-4xl"
      />,
    );

    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByText("Video unavailable")).toBeInTheDocument();
    expect(container.querySelector("media-controller")).toBeNull();
    // The download stays: the bar that carried it is gone.
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("h-full", "w-full", "max-w-4xl");
  });

  // The verdict is keyed on the URL: the lightbox reuses one player across
  // sources.
  it("gives a new src a fresh verdict after a failure", () => {
    const { container, rerender } = render(
      <VideoPlayer src="/media/broken.mp4" source={VIDEO} />,
    );

    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByText("Video unavailable")).toBeInTheDocument();

    rerender(<VideoPlayer src="/media/good.mp4" source={VIDEO} />);
    expect(screen.queryByText("Video unavailable")).toBeNull();
    expect(container.querySelector("media-controller")).not.toBeNull();
  });
});
