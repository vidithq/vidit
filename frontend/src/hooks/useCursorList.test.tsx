import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetchPage }));

import { useCursorList } from "./useCursorList";

const buildPath = (cursor: string | null) => (cursor ? `/rows?cursor=${cursor}` : "/rows");

beforeEach(() => {
  apiFetchPage.mockReset();
});

/** A page whose answer the test releases, to hold a request in flight. */
function deferred() {
  let resolve: (value: { items: string[]; nextCursor: string | null }) => void = () => {};
  const promise = new Promise<{ items: string[]; nextCursor: string | null }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useCursorList", () => {
  it("does not walk a returning path's old cursor while its first page refetches", async () => {
    const refetch = deferred();
    apiFetchPage
      .mockResolvedValueOnce({ items: ["a1"], nextCursor: "old" })
      .mockReturnValueOnce(deferred().promise)
      .mockReturnValueOnce(refetch.promise)
      .mockResolvedValueOnce({ items: ["a3"], nextCursor: null });
    const { result, rerender } = renderHook(
      ({ scope }) => useCursorList<string>((cursor) => `/${scope}${cursor ? `?c=${cursor}` : ""}`),
      { initialProps: { scope: "a" } },
    );
    await waitFor(() => expect(result.current.items).toEqual(["a1"]));
    // A quick toggle: away to `b` and back before `b` answers.
    rerender({ scope: "b" });
    rerender({ scope: "a" });

    // Back on path `a` with its first page in flight: no rows and no cursor from the old walk.
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.loadMore());
    expect(apiFetchPage.mock.calls.map((call) => call[0])).toEqual(["/a", "/b", "/a"]);

    await act(async () => refetch.resolve({ items: ["a2"], nextCursor: "fresh" }));
    expect(result.current.items).toEqual(["a2"]);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toEqual(["a2", "a3"]));
    expect(apiFetchPage.mock.calls.at(-1)?.[0]).toBe("/a?c=fresh");
  });

  it("drops the rows on reload until the first page lands again", async () => {
    const refetch = deferred();
    apiFetchPage
      .mockResolvedValueOnce({ items: ["a"], nextCursor: "c1" })
      .mockReturnValueOnce(refetch.promise);
    const { result } = renderHook(() => useCursorList<string>(buildPath));
    await waitFor(() => expect(result.current.items).toEqual(["a"]));

    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);
    expect(result.current.hasMore).toBe(false);

    await act(async () => refetch.resolve({ items: ["a'"], nextCursor: null }));
    expect(result.current.items).toEqual(["a'"]);
  });

  it("keeps the walk through a failed page and clears the error when the retry lands", async () => {
    apiFetchPage
      .mockResolvedValueOnce({ items: ["a"], nextCursor: "c1" })
      .mockRejectedValueOnce(new Error("API error 500"))
      .mockResolvedValueOnce({ items: ["b"], nextCursor: null });
    const { result } = renderHook(() => useCursorList<string>(buildPath));
    await waitFor(() => expect(result.current.items).toEqual(["a"]));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe("API error 500"));
    expect(result.current.items).toEqual(["a"]);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]));
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(apiFetchPage.mock.calls.map((call) => call[0])).toEqual([
      "/rows",
      "/rows?cursor=c1",
      "/rows?cursor=c1",
    ]);
  });

  it("fetches nothing for a null path", () => {
    const { result } = renderHook(() => useCursorList<string>(() => null));

    expect(apiFetchPage).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it("posts the body with every page", async () => {
    apiFetchPage
      .mockResolvedValueOnce({ items: ["a"], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: ["b"], nextCursor: null });
    const body = JSON.stringify({ q: "dam" });
    const { result } = renderHook(() =>
      useCursorList<string>(buildPath, undefined, undefined, body),
    );
    await waitFor(() => expect(result.current.items).toEqual(["a"]));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]));
    expect(apiFetchPage.mock.calls.map(([path, init]) => [path, init.method, init.body])).toEqual([
      ["/rows", "POST", body],
      ["/rows?cursor=c1", "POST", body],
    ]);
  });
});
