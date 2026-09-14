import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCollectionSequence = vi.fn();
vi.mock("@/lib/collections", () => ({
  fetchCollectionSequence: (id: string, signal?: AbortSignal) =>
    fetchCollectionSequence(id, signal),
}));

import type { EventListItem } from "@/types";

import { useCollectionSequence } from "./useCollectionSequence";

const ITEMS = [{ id: "e1" }, { id: "e2" }] as unknown as EventListItem[];

beforeEach(() => {
  fetchCollectionSequence.mockReset();
  fetchCollectionSequence.mockResolvedValue(ITEMS);
});

describe("useCollectionSequence", () => {
  it("hands the walk over once it lands", async () => {
    const { result } = renderHook(() => useCollectionSequence("c1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.items).toBeNull();

    await waitFor(() => expect(result.current.items).toEqual(ITEMS));
    expect(fetchCollectionSequence).toHaveBeenCalledWith(
      "c1",
      expect.any(AbortSignal),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reads nothing without an id, since the route params are not ready", () => {
    const { result } = renderHook(() => useCollectionSequence(""));

    expect(fetchCollectionSequence).not.toHaveBeenCalled();
    expect(result.current.items).toBeNull();
  });

  it("says what went wrong rather than waiting forever", async () => {
    fetchCollectionSequence.mockRejectedValue(new Error("Gone."));

    const { result } = renderHook(() => useCollectionSequence("c1"));

    await waitFor(() => expect(result.current.error).toBe("Gone."));
    // A page that asked and was refused is not a page still reading.
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toBeNull();
  });

  it("aborts the walk it leaves behind", async () => {
    const { unmount } = renderHook(() => useCollectionSequence("c1"));

    const signal = fetchCollectionSequence.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();

    expect(signal.aborted).toBe(true);
  });
});
