import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCopyToClipboard } from "./useCopyToClipboard";

// The hook's whole job is the flash window and its timer, so the clock is fake
// and the clipboard is a stub: what is under test is when `copied` flips back,
// not whether a real browser wrote anything.
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCopyToClipboard", () => {
  it("flashes copied and clears it after the reset window", async () => {
    const { result } = renderHook(() => useCopyToClipboard(1500));
    expect(result.current.copied).toBe(false);

    await act(async () => {
      await result.current.copy("https://vidit.app/profile/ana-demo");
    });
    expect(writeText).toHaveBeenCalledWith("https://vidit.app/profile/ana-demo");
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.copied).toBe(false);
  });

  it("replaces the pending reset when a second copy lands inside the window", async () => {
    const { result } = renderHook(() => useCopyToClipboard(1500));

    await act(async () => {
      await result.current.copy("first");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      await result.current.copy("second");
    });
    // The first copy's reset would have fired here; it was cleared, so the
    // second copy gets a full window rather than a 500 ms one.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copied).toBe(false);
  });

  it("clears the pending reset on unmount", async () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard(1500));

    await act(async () => {
      await result.current.copy("value");
    });
    // The reset is pending; unmount has to drop it, or it fires setState on an
    // unmounted hook.
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves false and skips the flash when the write is rejected", async () => {
    writeText.mockRejectedValue(new Error("not allowed"));
    const { result } = renderHook(() => useCopyToClipboard(1500));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.copy("value");
    });

    expect(outcome).toBe(false);
    expect(result.current.copied).toBe(false);
  });
});
