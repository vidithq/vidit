import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadSourceMedia } from "./DownloadSourceMedia";
import type { TweetImportMedia, TweetImportResponse } from "@/types";

const SOURCE_URL = "https://x.com/kalush/status/1234567890";

function media(overrides: Partial<TweetImportMedia> = {}): TweetImportMedia {
  return {
    kind: "image",
    remote_url: "https://pbs.twimg.com/media/a.jpg",
    content_type: "image/jpeg",
    origin: "op",
    ...overrides,
  };
}

function parsed(mediaItems: TweetImportMedia[]): TweetImportResponse {
  return {
    source_url: null,
    secondary_source_urls: [],
    original_tweet_url: SOURCE_URL,
    posted_at: "2026-01-05T12:00:00Z",
    source_posted_at: null,
    author_handle: "kalush",
    tweet_text: "",
    suggested_title: "",
    parsed_coords: [],
    media: mediaItems,
    quoted_tweet: null,
  };
}

/** Stand in for the two endpoints the control rides: the parse, then the byte
 *  proxy. Returns the mock so a test can read which media URL was proxied. */
function stubEndpoints(response: TweetImportResponse, parseOk = true) {
  const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.includes("/events/import-from-tweet/media")) {
      return {
        ok: true,
        headers: { get: () => "video/mp4" },
        blob: async () => new Blob(["bytes"], { type: "video/mp4" }),
      };
    }
    if (!parseOk) {
      return {
        ok: false,
        status: 502,
        json: async () => ({ detail: "That post is no longer available." }),
      };
    }
    return { ok: true, status: 200, json: async () => response };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function proxiedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/events/import-from-tweet/media"))
    .map((url) => decodeURIComponent(url.split("u=")[1]));
}

function clickDownload() {
  fireEvent.click(screen.getByRole("button", { name: /Download media/ }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DownloadSourceMedia", () => {
  it("renders nothing unless the source URL is an X status URL", () => {
    const { container } = render(
      <DownloadSourceMedia sourceUrl="https://t.me/c/1/2" onFile={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("stages the post's own video even when its images come first", async () => {
    const fetchMock = stubEndpoints(
      parsed([
        media({ remote_url: "https://pbs.twimg.com/media/shot.jpg" }),
        media({ kind: "video", remote_url: "https://video.twimg.com/clip.mp4" }),
      ])
    );
    const onFile = vi.fn();
    render(<DownloadSourceMedia sourceUrl={SOURCE_URL} onFile={onFile} />);

    clickDownload();

    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(proxiedUrls(fetchMock)).toEqual(["https://video.twimg.com/clip.mp4"]);
    expect(onFile.mock.calls[0][0].name).toBe("tweet-1234567890-0.mp4");
  });

  it("passes the abort signal to the parse call, not only to the downloads", async () => {
    const fetchMock = stubEndpoints(parsed([media()]));
    render(<DownloadSourceMedia sourceUrl={SOURCE_URL} onFile={() => {}} />);

    clickDownload();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const parseOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(parseOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses to stage a quoted post's media as this post's source", async () => {
    const fetchMock = stubEndpoints(
      parsed([
        media({
          kind: "video",
          remote_url: "https://video.twimg.com/quoted.mp4",
          origin: "quote",
        }),
      ])
    );
    const onFile = vi.fn();
    render(<DownloadSourceMedia sourceUrl={SOURCE_URL} onFile={onFile} />);

    clickDownload();

    await screen.findByText("That post carries no media to download.");
    expect(onFile).not.toHaveBeenCalled();
    expect(proxiedUrls(fetchMock)).toEqual([]);
  });

  it("surfaces the backend's own wording and drops it once the URL changes", async () => {
    stubEndpoints(parsed([]), false);
    const { rerender } = render(
      <DownloadSourceMedia sourceUrl={SOURCE_URL} onFile={() => {}} />
    );

    clickDownload();
    await screen.findByText("That post is no longer available.");

    rerender(
      <DownloadSourceMedia
        sourceUrl="https://x.com/kalush/status/9999999999"
        onFile={() => {}}
      />
    );
    expect(
      screen.queryByText("That post is no longer available.")
    ).not.toBeInTheDocument();
  });

  it("aborts a parse still in flight when it unmounts", async () => {
    // The parse hangs until aborted, the way a slow syndication round trip
    // does. Unmounting must tear it down rather than let it run to a state
    // write; the abort then lands in `run`'s catch, where it is not a failure
    // to report.
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <DownloadSourceMedia sourceUrl={SOURCE_URL} onFile={() => {}} />
    );

    clickDownload();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
