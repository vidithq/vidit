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

  it("shows nothing of the collection just left while the next one reads", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCollectionSequence(id),
      { initialProps: { id: "c1" } },
    );

    await waitFor(() => expect(result.current.items).toEqual(ITEMS));

    let land: (items: EventListItem[]) => void = () => {};
    fetchCollectionSequence.mockReturnValue(
      new Promise<EventListItem[]>((resolve) => {
        land = resolve;
      }),
    );
    rerender({ id: "c2" });

    expect(result.current.items).toBeNull();
    expect(result.current.loading).toBe(true);

    const NEXT = [{ id: "e3" }] as unknown as EventListItem[];
    land(NEXT);
    await waitFor(() => expect(result.current.items).toEqual(NEXT));
  });

  it("clears the error of the collection just left", async () => {
    fetchCollectionSequence.mockRejectedValue(new Error("Gone."));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCollectionSequence(id),
      { initialProps: { id: "c1" } },
    );

    await waitFor(() => expect(result.current.error).toBe("Gone."));

    fetchCollectionSequence.mockResolvedValue(ITEMS);
    rerender({ id: "c2" });

    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.items).toEqual(ITEMS));
  });

  it("drops a walk that lands after the id moved on", async () => {
    let land: (items: EventListItem[]) => void = () => {};
    fetchCollectionSequence.mockReturnValueOnce(
      new Promise<EventListItem[]>((resolve) => {
        land = resolve;
      }),
    );
    const NEXT = [{ id: "e3" }] as unknown as EventListItem[];
    fetchCollectionSequence.mockResolvedValue(NEXT);

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCollectionSequence(id),
      { initialProps: { id: "c1" } },
    );
    rerender({ id: "c2" });

    // The first walk answers after the reader opened another collection.
    land(ITEMS);
    await waitFor(() => expect(result.current.items).toEqual(NEXT));
    expect(result.current.items).not.toEqual(ITEMS);
  });

  it("aborts the walk it leaves behind", async () => {
    const { unmount } = renderHook(() => useCollectionSequence("c1"));

    const signal = fetchCollectionSequence.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();

    expect(signal.aborted).toBe(true);
  });
});
