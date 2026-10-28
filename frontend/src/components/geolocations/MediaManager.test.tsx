import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Media } from "@/types";
import { MediaManager } from "./MediaManager";

const CLIP: Media = {
  id: "m1",
  role: "source",
  storage_url: "https://media.example/clip.mp4",
  kind: "video",
  sha256: "0".repeat(64),
  original_filename: "clip.mp4",
};

describe("MediaManager", () => {
  it("says a stored clip whose file does not load is unavailable, rather than a black box", () => {
    const { container } = render(<MediaManager existing={[CLIP]} staged={[]} />);

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    fireEvent.error(video!);

    expect(screen.getByText("File unavailable")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
});
