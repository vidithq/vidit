import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapStateProvider } from "@/contexts/MapStateContext";
import { ApiError } from "@/lib/api";
import type { EventDetail } from "@/types";

// MapLibre touches `window` at module scope, so the canvas never loads under
// jsdom. The stub offers one button per pin, which is how a test selects one.
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

// Every read waits for the test to settle it, in the order the test picks. The
// filter taxonomies (`/tags`, `/conflicts`) are left pending: the panel is what
// this file measures.
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

const eventDetail = (id: string, title: string): EventDetail => ({
  id,
  title,
  event_coords: { lat: 49.71, lng: 37.616 },
  capture_source_coords: null,
  archived_source: null,
  archived_detected_from: null,
  event_date: "2026-03-14",
  event_time: null,
  source_posted_at: null,
  status: "geolocated",
  version_no: 1,
  is_graphic: false,
  close_reason: null,
  before_closed_status: null,
  detected_from_url: null,
  detected_via: null,
  owner: { id: "u1", username: "ana" },
  tags: [],
  conflicts: [],
  source_url: "https://t.me/channel/12345",
  secondary_source_urls: [],
  archived_secondary_sources: [],
  proof: null,
  created_at: "2026-03-15T10:00:00Z",
  geolocated_at: "2026-03-15T10:00:00Z",
  closed_at: null,
  media: [],
  thumbnail: null,
  requested_by: null,
  geolocators: [],
});

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
