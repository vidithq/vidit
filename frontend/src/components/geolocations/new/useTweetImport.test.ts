import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTweetImport } from "./useTweetImport";
import type { TweetImportResponse } from "@/types";

function bindings() {
  return {
    lat: "",
    lng: "",
    setTitle: vi.fn(),
    setLat: vi.fn(),
    setLng: vi.fn(),
    setSourceUrl: vi.fn(),
    setSecondarySourceUrls: vi.fn(),
    setEventDate: vi.fn(),
    setSourcePostedAt: vi.fn(),
    setFiles: vi.fn(),
    setProof: vi.fn(),
  };
}

/** A parsed tweet with no media, so applying it stages no downloads. */
function parsed(overrides: Partial<TweetImportResponse> = {}): TweetImportResponse {
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

describe("useTweetImport", () => {
  it("prefills the secondary source rows from the parsed post", async () => {
    const form = bindings();
    const { result } = renderHook(() => useTweetImport(form));
    await act(async () => {
      await result.current.applyTweetImport(
        parsed({
          secondary_source_urls: [
            "https://t.me/mirror/1",
            "https://www.youtube.com/watch?v=abc",
          ],
        })
      );
    });
    expect(form.setSecondarySourceUrls).toHaveBeenCalledWith([
      "https://t.me/mirror/1",
      "https://www.youtube.com/watch?v=abc",
    ]);
  });

  it("empties the rows on a re-import that declares no mirror", async () => {
    const form = bindings();
    const { result } = renderHook(() => useTweetImport(form));
    await act(async () => {
      await result.current.applyTweetImport(
        parsed({ secondary_source_urls: ["https://t.me/mirror/1"] })
      );
    });
    await act(async () => {
      await result.current.applyTweetImport(parsed());
    });
    expect(form.setSecondarySourceUrls).toHaveBeenLastCalledWith([]);
  });

  it("clears the rows along with the rest of the import", () => {
    const form = bindings();
    const { result } = renderHook(() => useTweetImport(form));
    act(() => result.current.clearImportedTweet());
    expect(form.setSecondarySourceUrls).toHaveBeenCalledWith([]);
    expect(form.setSourceUrl).toHaveBeenCalledWith("");
  });
});
