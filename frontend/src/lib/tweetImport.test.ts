import { describe, expect, it } from "vitest";

import { buildSeedProof, makeFile, splitMedia } from "./tweetImport";
import type { TweetImportMedia, TweetImportResponse } from "@/types";

function media(overrides: Partial<TweetImportMedia> = {}): TweetImportMedia {
  return {
    kind: "image",
    remote_url: "https://pbs.twimg.com/media/abc.jpg",
    content_type: "image/jpeg",
    origin: "op",
    ...overrides,
  };
}

function parsedTweet(
  overrides: Partial<TweetImportResponse> = {}
): TweetImportResponse {
  return {
    source_url: "https://x.com/source/status/2",
    original_tweet_url: "https://x.com/analyst/status/1",
    posted_at: "2026-01-05T12:00:00Z",
    author_handle: "analyst",
    tweet_text: "Geolocated the strike.",
    suggested_title: "Strike",
    parsed_coords: [],
    media: [],
    quoted_tweet: null,
    detected: [],
    ...overrides,
  };
}

describe("splitMedia", () => {
  it("routes videos to primary and images to proof, preserving order", () => {
    const v1 = media({ kind: "video", remote_url: "https://video.twimg.com/a.mp4" });
    const i1 = media({ remote_url: "https://pbs.twimg.com/1.jpg" });
    const v2 = media({
      kind: "video",
      remote_url: "https://video.twimg.com/b.mp4",
      origin: "quote",
    });
    const i2 = media({ remote_url: "https://pbs.twimg.com/2.jpg", origin: "quote" });
    expect(splitMedia([v1, i1, v2, i2])).toEqual({
      primary: [v1, v2],
      proof: [i1, i2],
    });
  });

  it("buckets by kind only — origin never changes the split", () => {
    const quoteImage = media({ origin: "quote" });
    const opVideo = media({ kind: "video", origin: "op" });
    const { primary, proof } = splitMedia([quoteImage, opVideo]);
    expect(primary).toEqual([opVideo]);
    expect(proof).toEqual([quoteImage]);
  });
});

describe("makeFile", () => {
  const fetched = { blob: new Blob(["x"]), contentType: "video/mp4" };

  it("takes the extension from the URL path", () => {
    const f = makeFile(
      fetched,
      media({ kind: "video", remote_url: "https://video.twimg.com/vid/a.mp4" }),
      "123",
      0
    );
    expect(f.name).toBe("tweet-123-0.mp4");
    expect(f.type).toBe("video/mp4");
  });

  it("reads the extension through a query string", () => {
    const f = makeFile(
      fetched,
      media({ remote_url: "https://pbs.twimg.com/media/a.jpg?name=large" }),
      "123",
      2
    );
    expect(f.name).toBe("tweet-123-2.jpg");
  });

  it("falls back by kind when the URL has no usable extension", () => {
    // ``?format=mp4`` is a query param, not a dot-extension — the
    // regex must not be fooled by it (or by the ``.com`` in the host).
    expect(
      makeFile(
        fetched,
        media({ kind: "video", remote_url: "https://pbs.twimg.com/media/abc?format=mp4" }),
        "9",
        0
      ).name
    ).toBe("tweet-9-0.mp4");
    expect(
      makeFile(
        fetched,
        media({ kind: "image", remote_url: "https://pbs.twimg.com/media/abc" }),
        "9",
        1
      ).name
    ).toBe("tweet-9-1.jpg");
  });
});

describe("buildSeedProof", () => {
  it("credits the OP and embeds each proof image", () => {
    const doc = buildSeedProof(parsedTweet(), [
      "https://cdn/a.png",
      "https://cdn/b.png",
    ]);
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Geolocation by @analyst — Geolocated the strike.",
            },
          ],
        },
        { type: "image", attrs: { src: "https://cdn/a.png" } },
        { type: "image", attrs: { src: "https://cdn/b.png" } },
      ],
    });
  });

  it("adds a source-attribution paragraph when the OP quote-retweeted", () => {
    const doc = buildSeedProof(
      parsedTweet({
        quoted_tweet: {
          source_url: "https://x.com/src/status/2",
          author_handle: "src",
          tweet_text: "original footage",
        },
      }),
      []
    );
    expect(doc.content).toHaveLength(2);
    expect(doc.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Source: @src — original footage" }],
    });
  });
});
