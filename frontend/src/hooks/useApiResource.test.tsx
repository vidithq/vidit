import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useApiResource } from "./useApiResource";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

// Each apiFetch call is captured with its abort signal and manual
// resolve/reject handles so tests control exactly when and how every
// request settles.
interface CapturedCall {
  path: string;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let calls: CapturedCall[];

beforeEach(() => {
  calls = [];
  const mock = apiFetch as unknown as Mock;
  mock.mockReset();
  mock.mockImplementation(
    (path: string, options?: RequestInit) =>
      new Promise((resolve, reject) => {
        calls.push({ path, signal: options?.signal as AbortSignal, resolve, reject });
      })
  );
});

describe("useApiResource", () => {
  it("skips entirely while path is null", () => {
    const { result } = renderHook(() => useApiResource<string>(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("starts fetching once a null path becomes a string", () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useApiResource<string>(path),
      { initialProps: { path: null as string | null } }
    );
    expect(calls).toHaveLength(0);
    rerender({ path: "/timeline" });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/timeline");
    expect(result.current.loading).toBe(true);
  });

  it("exposes data after a successful fetch", async () => {
    const { result } = renderHook(() => useApiResource<string>("/thing"));
    expect(result.current.loading).toBe(true);
    await act(async () => calls[0].resolve("payload"));
    expect(result.current.data).toBe("payload");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("exposes the error message after a failed fetch", async () => {
    const { result } = renderHook(() => useApiResource<string>("/thing"));
    await act(async () => calls[0].reject(new Error("boom")));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("aborts the in-flight request and never leaks a stale body on path change", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useApiResource<string>(path),
      { initialProps: { path: "/a" } }
    );
    await act(async () => calls[0].resolve("A"));
    expect(result.current.data).toBe("A");

    rerender({ path: "/b" });
    // The previous result belongs to /a — it must not leak into /b's
    // render, and /b reports loading until its own fetch settles.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(calls).toHaveLength(2);

    await act(async () => calls[1].resolve("B"));
    expect(result.current.data).toBe("B");
  });

  it("ignores a late settlement from an aborted request", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useApiResource<string>(path),
      { initialProps: { path: "/a" } }
    );
    rerender({ path: "/b" });
    expect(calls[0].signal.aborted).toBe(true);

    // The aborted /a request settles anyway — must not clobber /b's
    // pending state.
    await act(async () => calls[0].resolve("stale A"));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => calls[1].resolve("B"));
    expect(result.current.data).toBe("B");
  });

  it("aborts the in-flight request on unmount", () => {
    const { unmount } = renderHook(() => useApiResource<string>("/x"));
    expect(calls[0].signal.aborted).toBe(false);
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("refetch after success revalidates in the background, keeping stale data", async () => {
    const { result } = renderHook(() => useApiResource<string>("/thing"));
    await act(async () => calls[0].resolve("v1"));

    act(() => result.current.refetch());
    expect(result.current.data).toBe("v1");
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(2);

    await act(async () => calls[1].resolve("v2"));
    expect(result.current.data).toBe("v2");
  });

  it("refetch after an error resets to the loading state", async () => {
    const { result } = renderHook(() => useApiResource<string>("/thing"));
    await act(async () => calls[0].reject(new Error("down")));
    expect(result.current.error).toBe("down");

    act(() => result.current.refetch());
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => calls[1].resolve("recovered"));
    expect(result.current.data).toBe("recovered");
  });

  it("a failed refetch replaces stale data with the error", async () => {
    const { result } = renderHook(() => useApiResource<string>("/thing"));
    await act(async () => calls[0].resolve("v1"));

    act(() => result.current.refetch());
    await act(async () => calls[1].reject(new Error("now failing")));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("now failing");
  });

  it("reports a generic message for non-Error rejections", async () => {
    const { result } = renderHook(() => useApiResource<string>("/thing"));
    await act(async () => calls[0].reject("string reason"));
    expect(result.current.error).toBe("Request failed");
  });
});
