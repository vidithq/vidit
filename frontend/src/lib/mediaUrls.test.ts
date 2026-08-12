import { describe, expect, it } from "vitest";
import { displayUrlsFor, posterFrameUrl } from "./mediaUrls";

const image = (storage_url: string) =>
  ({ storage_url, media_type: "image" }) as const;

describe("displayUrlsFor", () => {
  it("derives _hero/_thumb siblings for an image", () => {
    expect(
      displayUrlsFor(image("https://cdn.example.com/uploads/g1/abc.jpg"))
    ).toEqual({
      original: "https://cdn.example.com/uploads/g1/abc.jpg",
      hero: "https://cdn.example.com/uploads/g1/abc_hero.jpg",
      thumbnail: "https://cdn.example.com/uploads/g1/abc_thumb.jpg",
    });
  });

  it("always returns the original for videos", () => {
    const url = "https://cdn.example.com/uploads/g1/clip.mp4";
    expect(displayUrlsFor({ storage_url: url, media_type: "video" })).toEqual({
      original: url,
      hero: url,
      thumbnail: url,
    });
  });

  it("does not mistake the domain dot for an extension", () => {
    // Extensionless path — the only dots are in the host. A naive
    // lastIndexOf(".") would rewrite "example.com" into a derivative.
    const url = "https://cdn.example.com/uploads/abc";
    expect(displayUrlsFor(image(url))).toEqual({
      original: url,
      hero: url,
      thumbnail: url,
    });
  });

  it("keeps query strings out of the stem and re-appends them", () => {
    expect(
      displayUrlsFor(image("https://cdn.example.com/a/b.png?sig=x&exp=1"))
    ).toEqual({
      original: "https://cdn.example.com/a/b.png?sig=x&exp=1",
      hero: "https://cdn.example.com/a/b_hero.jpg?sig=x&exp=1",
      thumbnail: "https://cdn.example.com/a/b_thumb.jpg?sig=x&exp=1",
    });
  });

  it("treats fragments like query strings", () => {
    expect(displayUrlsFor(image("https://cdn.example.com/a/b.webp#frag")).hero).toBe(
      "https://cdn.example.com/a/b_hero.jpg#frag"
    );
  });

  it("is idempotent on URLs that are already derivatives", () => {
    const hero = "https://cdn.example.com/a/b_hero.jpg";
    expect(displayUrlsFor(image(hero))).toEqual({
      original: hero,
      hero,
      thumbnail: hero,
    });
    const thumb = "https://cdn.example.com/a/b_thumb.jpg";
    expect(displayUrlsFor(image(thumb)).thumbnail).toBe(thumb);
  });

  it("handles relative storage URLs (local-dev storage backend)", () => {
    expect(displayUrlsFor(image("/media/uploads/g1/abc.jpg")).hero).toBe(
      "/media/uploads/g1/abc_hero.jpg"
    );
  });
});

describe("posterFrameUrl", () => {
  it("appends the poster-frame fragment to a plain clip URL", () => {
    expect(posterFrameUrl("https://cdn.example.com/uploads/g1/clip.mp4")).toBe(
      "https://cdn.example.com/uploads/g1/clip.mp4#t=0.1"
    );
  });

  it("handles relative storage URLs (local-dev storage backend)", () => {
    expect(posterFrameUrl("/media/uploads/g1/clip.mp4")).toBe(
      "/media/uploads/g1/clip.mp4#t=0.1"
    );
  });

  it("leaves a URL that already names a fragment alone", () => {
    // An explicit start time from a caller wins; appending would produce two
    // fragments and the browser would honour neither.
    const url = "https://cdn.example.com/a/clip.mp4#t=12";
    expect(posterFrameUrl(url)).toBe(url);
  });

  it("is idempotent", () => {
    const once = posterFrameUrl("/media/clip.mp4");
    expect(posterFrameUrl(once)).toBe(once);
  });
});
