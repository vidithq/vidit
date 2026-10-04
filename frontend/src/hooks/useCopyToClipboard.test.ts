import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCopyToClipboard } from "./useCopyToClipboard";

// The clock is fake and the clipboard a stub: under test is when `copied` flips back.
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
    // The first copy's reset was cleared, so the second gets a full window, not 500 ms.
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
    // A pending reset must be dropped on unmount, or it sets state on an unmounted hook.
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
