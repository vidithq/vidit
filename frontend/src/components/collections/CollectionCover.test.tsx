import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectionCover } from "./CollectionCover";
import type { CollectionCoverTile } from "@/lib/collections";

/**
 * Each tile carries its file kind and role. A clip in an `<img>` paints an empty
 * band (the kind locks that out); a proof-image tile must not ask for a
 * derivative that was never written (the role). The arrangement is the count,
 * pinned on cells drawn and pictures landed.
 */
const IMAGE: CollectionCoverTile = {
  url: "https://media.example/uploads/geo/abc.jpg",
  media_type: "image",
  role: "source",
};

function tiles(count: number): CollectionCoverTile[] {
  return Array.from({ length: count }, (_, i) => ({
    ...IMAGE,
    url: `https://media.example/uploads/geo/item${i}.jpg`,
  }));
}

describe("CollectionCover", () => {
  it("draws the one no-media box when the collection has nothing to show", () => {
    render(<CollectionCover cover={[]} />);

    expect(screen.getByText("no media")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("video")).toBeNull();
  });

  it("gives a lone tile the whole slot, through its wide derivative", () => {
    render(<CollectionCover cover={tiles(1)} />);

    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute(
      "src",
      "https://media.example/uploads/geo/item0_hero.jpg",
    );
  });

  it("splits the slot between two tiles, at the card row's own derivative", () => {
    render(<CollectionCover cover={tiles(2)} />);

    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute(
      "src",
      "https://media.example/uploads/geo/item0_thumb.jpg",
    );
  });

  it.each([3, 4])("gives each of %i tiles its own cell", (count) => {
    const { container } = render(<CollectionCover cover={tiles(count)} />);

    expect(container.firstElementChild!.children).toHaveLength(count);
    expect(document.querySelectorAll("img")).toHaveLength(count);
  });

  it("plays a video tile as a clip, seeked to its first frame", () => {
    render(
      <CollectionCover
        cover={[
          { url: "https://media.example/clip.mp4", media_type: "video", role: "source" },
          IMAGE,
        ]}
      />,
    );

    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "https://media.example/clip.mp4#t=0.1");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("reads the original for a tile taken off a proof image", () => {
    // The footage is a clip, so the tile falls to its proof image, which has no
    // `_hero` / `_thumb` sibling (a rewrite would point it at a 403).
    render(
      <CollectionCover
        cover={[
          {
            url: "https://media.example/proof/u1/inline.jpg",
            media_type: "image",
            role: "proof",
          },
        ]}
      />,
    );

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://media.example/proof/u1/inline.jpg",
    );
  });
});
