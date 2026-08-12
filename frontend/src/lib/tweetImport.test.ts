import { describe, expect, it, vi } from "vitest";

import {
  buildSeedProof,
  fetchFirstMediaFile,
  fetchProofFiles,
  isXStatusUrl,
  makeFile,
  sourceMediaCandidates,
  splitMedia,
  tweetIdFrom,
} from "./tweetImport";
import { PROOF_PLACEHOLDER_PREFIX } from "./proofImages";
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
    secondary_source_urls: [],
    original_tweet_url: "https://x.com/analyst/status/1",
    posted_at: "2026-01-05T12:00:00Z",
    source_posted_at: "2026-01-04T09:00:00Z",
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

describe("isXStatusUrl", () => {
  it("recognises both hosts, the www prefix, and a trailing path", () => {
    expect(isXStatusUrl("https://x.com/kalush/status/1234567890")).toBe(true);
    expect(isXStatusUrl("  http://twitter.com/kalush/status/1234  ")).toBe(true);
    expect(isXStatusUrl("https://www.x.com/kalush/status/1234")).toBe(true);
    expect(isXStatusUrl("https://www.twitter.com/kalush/status/1234")).toBe(true);
    expect(isXStatusUrl("https://x.com/kalush/status/1234/photo/1")).toBe(true);
  });

  it("recognises the handle-less /i/web/status form the backend accepts", () => {
    expect(isXStatusUrl("https://x.com/i/web/status/1234567890")).toBe(true);
    expect(isXStatusUrl("https://twitter.com/i/status/1234567890")).toBe(true);
  });

  it("rejects the mobile. host the backend's allowlist leaves out", () => {
    // `normalise_tweet_url` accepts x.com / twitter.com ± www. only, so
    // offering the download here would offer a button that always 400s.
    expect(isXStatusUrl("https://mobile.twitter.com/kalush/status/1234")).toBe(
      false
    );
    expect(isXStatusUrl("https://mobile.x.com/kalush/status/1234")).toBe(false);
  });

  it("rejects another host, a profile URL, and an empty field", () => {
    expect(isXStatusUrl("https://t.me/c/1/2")).toBe(false);
    expect(isXStatusUrl("https://x.com/kalush")).toBe(false);
    expect(isXStatusUrl("https://evil.com/x.com/kalush/status/1")).toBe(false);
    expect(isXStatusUrl("")).toBe(false);
  });
});

describe("tweetIdFrom", () => {
  it("reads the status id, whatever trails it", () => {
    expect(tweetIdFrom("https://x.com/kalush/status/1234")).toBe("1234");
    expect(tweetIdFrom("https://x.com/kalush/status/1234/")).toBe("1234");
    expect(tweetIdFrom("https://x.com/kalush/status/1234/photo/1")).toBe("1234");
    expect(tweetIdFrom("https://x.com/i/web/status/1234")).toBe("1234");
  });

  it("falls back when the URL carries no status id", () => {
    expect(tweetIdFrom("https://x.com/kalush")).toBe("tweet");
    expect(tweetIdFrom("")).toBe("tweet");
  });
});

describe("sourceMediaCandidates", () => {
  it("puts the post's own video ahead of its images", () => {
    const i1 = media({ remote_url: "https://pbs.twimg.com/1.jpg" });
    const v1 = media({ kind: "video", remote_url: "https://video.twimg.com/a.mp4" });
    const i2 = media({ remote_url: "https://pbs.twimg.com/2.jpg" });
    expect(sourceMediaCandidates([i1, v1, i2])).toEqual([v1, i1, i2]);
  });

  it("drops the quoted post's media, down to nothing when it is all there is", () => {
    const own = media({ remote_url: "https://pbs.twimg.com/own.jpg" });
    const quoted = media({
      kind: "video",
      remote_url: "https://video.twimg.com/quoted.mp4",
      origin: "quote",
    });
    expect(sourceMediaCandidates([quoted, own])).toEqual([own]);
    expect(sourceMediaCandidates([quoted])).toEqual([]);
  });
});

describe("fetchFirstMediaFile", () => {
  function fakeResponse(body: string, contentType: string) {
    return {
      ok: true,
      headers: { get: () => contentType },
      blob: () => Promise.resolve(new Blob([body], { type: contentType })),
    };
  }

  it("returns the first item the proxy serves, skipping the ones it refuses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(fakeResponse("v", "video/mp4"));
    vi.stubGlobal("fetch", fetchMock);

    const file = await fetchFirstMediaFile(
      [
        media({ kind: "video", remote_url: "https://video.twimg.com/a.mp4" }),
        media({ kind: "video", remote_url: "https://video.twimg.com/b.mp4" }),
      ],
      "42",
      new AbortController().signal
    );

    expect(file?.name).toBe("tweet-42-1.mp4");
    expect(file?.type).toBe("video/mp4");
    // Stops at the first success rather than downloading the whole set.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("returns null on an empty list and when every download fails", async () => {
    expect(
      await fetchFirstMediaFile([], "42", new AbortController().signal)
    ).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(
      await fetchFirstMediaFile(
        [media()],
        "42",
        new AbortController().signal
      )
    ).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("buildSeedProof", () => {
  it("credits the OP and embeds each proof image as a placeholder node", () => {
    const a = new File(["x"], "tweet-1-0.jpg", { type: "image/jpeg" });
    const b = new File(["y"], "tweet-1-1.jpg", { type: "image/jpeg" });
    const doc = buildSeedProof(parsedTweet(), [a, b]);
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Geolocation by @analyst: Geolocated the strike.",
            },
          ],
        },
        {
          type: "image",
          attrs: { src: `${PROOF_PLACEHOLDER_PREFIX}tweet-1-0.jpg` },
        },
        {
          type: "image",
          attrs: { src: `${PROOF_PLACEHOLDER_PREFIX}tweet-1-1.jpg` },
        },
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
      content: [{ type: "text", text: "Source: @src: original footage" }],
    });
  });
});

describe("fetchProofFiles", () => {
  function fakeResponse(body: string, contentType: string) {
    return {
      ok: true,
      headers: { get: () => contentType },
      blob: () => Promise.resolve(new Blob([body], { type: contentType })),
    };
  }

  it("downloads each proof image and names it like a manually picked file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse("a", "image/jpeg"))
      .mockResolvedValueOnce(fakeResponse("b", "image/png"));
    vi.stubGlobal("fetch", fetchMock);

    const mediaItems: TweetImportMedia[] = [
      media({ remote_url: "https://pbs.twimg.com/media/a.jpg" }),
      media({ remote_url: "https://pbs.twimg.com/media/b.png" }),
    ];
    const files = await fetchProofFiles(mediaItems, "42", new AbortController().signal);

    expect(files.map((f) => f.name)).toEqual(["tweet-42-0.jpg", "tweet-42-1.png"]);
    expect(files.map((f) => f.type)).toEqual(["image/jpeg", "image/png"]);

    vi.unstubAllGlobals();
  });

  it("drops an item whose download fails, keeping the rest", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(fakeResponse("b", "image/png"));
    vi.stubGlobal("fetch", fetchMock);

    const mediaItems: TweetImportMedia[] = [
      media({ remote_url: "https://pbs.twimg.com/media/a.jpg" }),
      media({ remote_url: "https://pbs.twimg.com/media/b.png" }),
    ];
    const files = await fetchProofFiles(mediaItems, "42", new AbortController().signal);

    expect(files.map((f) => f.name)).toEqual(["tweet-42-1.png"]);

    vi.unstubAllGlobals();
  });

  it("seeds a doc whose placeholder nodes match the downloaded files by name", async () => {
    // The end-to-end contract: `fetchProofFiles` names each file, and
    // `buildSeedProof` must reference those exact names so the publish-time
    // intake (matching `placeholder://<filename>` to `proof_files[]` by
    // `safe_original_filename`) pairs every image up.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse("a", "image/jpeg"))
      .mockResolvedValueOnce(fakeResponse("b", "image/png"));
    vi.stubGlobal("fetch", fetchMock);

    const mediaItems: TweetImportMedia[] = [
      media({ remote_url: "https://pbs.twimg.com/media/a.jpg" }),
      media({ remote_url: "https://pbs.twimg.com/media/b.png" }),
    ];
    const files = await fetchProofFiles(mediaItems, "7", new AbortController().signal);
    const doc = buildSeedProof(parsedTweet(), files);

    const imageSrcs = doc.content
      .filter((n) => n.type === "image")
      .map((n) => (n.attrs as { src: string }).src);
    expect(imageSrcs).toEqual(files.map((f) => `${PROOF_PLACEHOLDER_PREFIX}${f.name}`));

    vi.unstubAllGlobals();
  });
});
