import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectionCover } from "./CollectionCover";
import type { CollectionCoverTile } from "@/lib/collections";

/**
 * What the mosaic has to get right is the files it was handed and how many.
 *
 * The tiles are the media of the collection's own items, so each carries the
 * kind of file it is. Most source media in the corpus are clips, and an `<img>`
 * pointed at one paints an empty band, which is the defect the kind locks out.
 * The arrangement is the count, and one tile more or fewer is a different
 * picture, so each count is pinned on what a reader can see: how many pictures
 * there are, and whether the earliest one is the tall cell.
 */
const IMAGE: CollectionCoverTile = {
  url: "https://media.example/uploads/geo/abc.jpg",
  media_type: "image",
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

  it("stands the earliest of three tiles tall beside the other two", () => {
    const { container } = render(<CollectionCover cover={tiles(3)} />);

    const cells = container.firstElementChild!.children;
    expect(cells).toHaveLength(3);
    expect(cells[0].className).toContain("row-span-2");
    expect(cells[1].className).not.toContain("row-span-2");
  });

  it("fills a square with four tiles, and no cell takes two rows", () => {
    const { container } = render(<CollectionCover cover={tiles(4)} />);

    const cells = container.firstElementChild!.children;
    expect(cells).toHaveLength(4);
    expect(document.querySelectorAll("img")).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.className).not.toContain("row-span-2");
    }
  });

  it("plays a video tile as a clip, seeked to its first frame", () => {
    render(
      <CollectionCover
        cover={[
          { url: "https://media.example/clip.mp4", media_type: "video" },
          IMAGE,
        ]}
      />,
    );

    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "https://media.example/clip.mp4#t=0.1");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });
});
