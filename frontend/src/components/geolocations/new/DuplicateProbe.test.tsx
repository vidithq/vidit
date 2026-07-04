import { act, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { DuplicateProbe } from "./DuplicateProbe";
import { apiFetch } from "@/lib/api";
import type { PossibleDuplicate } from "@/types";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

// Capture each apiFetch call with its abort signal and manual
// resolve/reject handles so tests control when and how every probe settles.
interface CapturedCall {
  path: string;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let calls: CapturedCall[];

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  const mock = apiFetch as unknown as Mock;
  mock.mockReset();
  mock.mockImplementation(
    (path: string, options?: RequestInit) =>
      new Promise((resolve, reject) => {
        calls.push({
          path,
          signal: options?.signal as AbortSignal,
          resolve,
          reject,
        });
      })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function hit(id: string, title: string): PossibleDuplicate {
  return {
    id,
    title,
    event_coords: { lat: 48, lng: 37 },
    event_date: "2026-01-05",
    source_url: "https://t.me/channel/1",
    distance_m: 120,
    owner: {
      id: "u1",
      username: "ana",
      is_trusted: false,
      trust_reason: null,
    },
  };
}

const baseProps = {
  lat: "48.0",
  lng: "37.0",
  sourceUrl: "https://t.me/channel/1",
  eventDate: "",
  skip: false,
};

function renderProbe(overrides: Partial<typeof baseProps> = {}) {
  return render(<DuplicateProbe {...baseProps} {...overrides} />);
}

describe("DuplicateProbe", () => {
  it("never probes without valid coordinates", () => {
    renderProbe({ lat: "not-a-number" });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(calls).toHaveLength(0);
  });

  it("never probes when both source URL and event date are empty", () => {
    renderProbe({ sourceUrl: "", eventDate: "" });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(calls).toHaveLength(0);
  });

  it("never probes in request-fulfilment mode", () => {
    renderProbe({ skip: true });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(calls).toHaveLength(0);
  });

  it("debounces, then probes with the populated params and renders hits", async () => {
    renderProbe({ eventDate: "2026-01-05" });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(calls).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(
      "/events/possible-duplicates?lat=48&lng=37&source_url=https%3A%2F%2Ft.me%2Fchannel%2F1&event_date=2026-01-05"
    );
    await act(async () => {
      calls[0].resolve([hit("1", "Existing geo")]);
    });
    expect(
      screen.getByText("1 possibly related geolocation")
    ).toBeInTheDocument();
    expect(screen.getByText("Existing geo")).toBeInTheDocument();
  });

  it("aborts the in-flight probe when an input changes", () => {
    const { rerender } = renderProbe();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);
    rerender(<DuplicateProbe {...baseProps} lat="48.1" />);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("keeps the previous hits when a later probe fails", async () => {
    const { rerender } = renderProbe();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      calls[0].resolve([hit("1", "Existing geo")]);
    });
    expect(screen.getByText("Existing geo")).toBeInTheDocument();

    rerender(<DuplicateProbe {...baseProps} lat="48.1" />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1].reject(new Error("429"));
    });
    // Stale-but-truthful: a transient failure must not wipe a warning
    // the analyst was already looking at.
    expect(screen.getByText("Existing geo")).toBeInTheDocument();
  });

  it("clears the warning when the coordinates go invalid", async () => {
    const { rerender } = renderProbe();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      calls[0].resolve([hit("1", "Existing geo")]);
    });
    expect(screen.getByText("Existing geo")).toBeInTheDocument();

    rerender(<DuplicateProbe {...baseProps} lat="" />);
    expect(screen.queryByText("Existing geo")).not.toBeInTheDocument();
  });
});
