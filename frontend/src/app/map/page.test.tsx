import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapStateProvider } from "@/contexts/MapStateContext";
import { ApiError } from "@/lib/api";
import { eventDetail } from "@/test/eventDetail";

// MapLibre touches `window` at module scope; the stub offers one button per pin.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({ onPointClick }: { onPointClick?: (id: string) => void }) {
      return (
        <>
          <button type="button" onClick={() => onPointClick?.("a")}>
            pin a
          </button>
          <button type="button" onClick={() => onPointClick?.("b")}>
            pin b
          </button>
        </>
      );
    },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

// Each read waits for the test to settle it; the filter taxonomies stay pending (the panel is what is measured).
interface Read {
  path: string;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}
let reads: Read[];

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: (path: string, options?: RequestInit) =>
    new Promise((resolve, reject) => {
      reads.push({ path, signal: options?.signal ?? undefined, resolve, reject });
    }),
}));

import HomePage from "./page";

function readOf(id: string): Read {
  const read = reads.findLast((r) => r.path === `/events/${id}`);
  if (!read) throw new Error(`no read for event ${id}`);
  return read;
}

const TITLE_A = "Strike on the rail junction";
const TITLE_B = "Damaged locomotive shed";

const pin = (id: string) => screen.getByRole("button", { name: `pin ${id}` });
const heading = (title: string) => screen.queryByRole("heading", { name: title });

function renderMap() {
  return render(
    <MapStateProvider>
      <HomePage />
    </MapStateProvider>,
  );
}

beforeEach(() => {
  reads = [];
});

describe("map detail panel", () => {
  it("shows the error, not the previous event, when the next event fails to load", async () => {
    renderMap();
    fireEvent.click(pin("a"));
    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));
    expect(heading(TITLE_A)).toBeInTheDocument();

    fireEvent.click(pin("b"));
    await act(async () => readOf("b").reject(new ApiError("Event not found", 404)));

    expect(heading(TITLE_A)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Event not found");
  });

  it("shows the selected event when an earlier read lands after it", async () => {
    renderMap();
    fireEvent.click(pin("a"));
    fireEvent.click(pin("b"));

    await act(async () => readOf("b").resolve(eventDetail("b", TITLE_B)));
    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));

    expect(heading(TITLE_B)).toBeInTheDocument();
    expect(heading(TITLE_A)).not.toBeInTheDocument();
  });

  it("clears the panel on close and cancels the read in flight", async () => {
    renderMap();
    fireEvent.click(pin("a"));
    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));

    fireEvent.click(screen.getByRole("button", { name: "Close detail panel" }));
    expect(heading(TITLE_A)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close detail panel" })).not.toBeInTheDocument();

    // The next pin opens on its own loading state, not on the closed event.
    fireEvent.click(pin("b"));
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(heading(TITLE_A)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close detail panel" }));
    expect(readOf("b").signal?.aborted).toBe(true);
  });

  it("retries a failed read and shows the event once it lands", async () => {
    renderMap();
    fireEvent.click(pin("a"));
    await act(async () => readOf("a").reject(new ApiError("Server error", 500)));
    expect(screen.getByRole("alert")).toHaveTextContent("Server error");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));
    expect(heading(TITLE_A)).toBeInTheDocument();
  });

  it("shows a generic message for an error that carries none", async () => {
    renderMap();
    fireEvent.click(pin("a"));
    await act(async () => readOf("a").reject(new ApiError("", 500)));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this event.");
  });

  it("reopens a pin that failed on a fresh read, not on the old error", async () => {
    renderMap();
    fireEvent.click(pin("a"));
    await act(async () => readOf("a").reject(new ApiError("Event not found", 404)));
    fireEvent.click(screen.getByRole("button", { name: "Close detail panel" }));

    fireEvent.click(pin("a"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(reads.filter((r) => r.path === "/events/a")).toHaveLength(2);
  });

  it("reads the selected event again when the map mounts after a navigation", async () => {
    const { rerender } = renderMap();
    fireEvent.click(pin("a"));
    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));

    // Leaving the map unmounts the page; the selection stays in context.
    rerender(<MapStateProvider>{null}</MapStateProvider>);
    rerender(
      <MapStateProvider>
        <HomePage />
      </MapStateProvider>,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));
    expect(heading(TITLE_A)).toBeInTheDocument();
  });
});
