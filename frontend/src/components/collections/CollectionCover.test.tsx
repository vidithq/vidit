import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectionCover } from "./CollectionCover";

/**
 * What the cover slot has to get right is the file it was handed.
 *
 * A collection wears one of two pictures, and the read says which: the owner's
 * upload, one already-resized JPEG with no derivative beside it, or a default
 * picked off the first item's own Media row, which carries that row's kind and
 * takes the derivatives every Media url takes. Most source media in the corpus
 * are clips, so the default is often a video: an `<img>` pointed at one paints
 * an empty band, which is the defect these lock out.
 */
describe("CollectionCover", () => {
  it("draws the one no-media box when there is nothing to show", () => {
    render(<CollectionCover cover={null} />);

    expect(screen.getByText("no media")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("video")).toBeNull();
  });

  it("plays a video default as a clip, seeked to its first frame", () => {
    render(
      <CollectionCover
        cover={{
          url: "https://media.example/clip.mp4",
          media_type: "video",
          is_uploaded: false,
        }}
      />,
    );

    expect(document.querySelector("img")).toBeNull();
    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "https://media.example/clip.mp4#t=0.1");
    expect(video).toHaveAttribute("preload", "metadata");
  });

  it("serves an image default through its hero derivative", () => {
    render(
      <CollectionCover
        cover={{
          url: "https://media.example/uploads/geo/abc.jpg",
          media_type: "image",
          is_uploaded: false,
        }}
      />,
    );

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://media.example/uploads/geo/abc_hero.jpg",
    );
  });

  it("serves an uploaded cover as stored: it has no derivative", () => {
    render(
      <CollectionCover
        cover={{
          url: "https://media.example/collections/c1/cover.jpg",
          media_type: "image",
          is_uploaded: true,
        }}
      />,
    );

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://media.example/collections/c1/cover.jpg",
    );
  });
});
