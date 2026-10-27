import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapStateProvider } from "@/contexts/MapStateContext";
import { ApiError } from "@/lib/api";
import type { Site, SiteListItem } from "@/lib/sites";
import { eventDetail } from "@/test/eventDetail";

// MapLibre touches `window` at module scope. One stub stands for both dynamic imports: the map
// offers one button per pin and one that reports a viewport, and mounts its children; the sites
// layer offers one button and the preview of site s1.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({
      onPointClick,
      onBoundsChange,
      onSelect,
      renderPreview,
      children,
    }: {
      onPointClick?: (id: string) => void;
      onBoundsChange?: (bounds: { south: number; west: number; north: number; east: number }) => void;
      onSelect?: (id: string) => void;
      renderPreview?: (id: string) => ReactNode;
      children?: ReactNode;
    }) {
      if (onSelect) {
        return (
          <>
            <button type="button" onClick={() => onSelect("s1")}>
              site s1
            </button>
            <div data-testid="site preview">{renderPreview?.("s1")}</div>
          </>
        );
      }
      return (
        <>
          <button type="button" onClick={() => onPointClick?.("a")}>
            pin a
          </button>
          <button type="button" onClick={() => onPointClick?.("b")}>
            pin b
          </button>
          <button
            type="button"
            onClick={() => onBoundsChange?.({ south: 9, west: 29, north: 11, east: 31 })}
          >
            report viewport
          </button>
          {children}
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

describe("map sites layer", () => {
  const filtersButton = () => screen.getByRole("button", { name: /^Filters/ });
  const sitesSwitch = () => screen.getByRole("switch", { name: "Show sites" });

  const SITE_NAME = "Rail depot";
  const ROW = {
    id: "s1",
    name: SITE_NAME,
    kind: "depot",
    last_source: {
      id: "i1",
      captured_at: "2026-09-07T10:30:00Z",
      provider: { id: "copernicus_browser", name: "Copernicus Browser" },
    },
    latest_link_effect: { effect: "damage", occurred_date: "2026-09-05", event_id: "e1" },
    zone: { type: "Polygon", coordinates: [[[30, 10], [30.01, 10], [30.01, 10.01], [30, 10]]] },
    centroid: { lat: 10.003, lng: 30.006 },
  } as unknown as SiteListItem;
  const SITE = {
    ...ROW,
    owner: { id: "u1", username: "mira", avatar_url: null },
    sources: [],
    linked_events: [],
  } as unknown as Site;

  async function showSites() {
    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sites" }));
    fireEvent.click(sitesSwitch());
    fireEvent.click(screen.getByRole("button", { name: "report viewport" }));
    // The list read is debounced on the viewport.
    const list = await waitFor(() => {
      const read = reads.find((r) => r.path.startsWith("/sites?"));
      if (!read) throw new Error("no sites read yet");
      return read;
    });
    await act(async () => list.resolve([ROW]));
  }

  it("previews a site from its list row", async () => {
    renderMap();
    await showSites();
    const preview = screen.getByTestId("site preview");
    expect(preview).toHaveTextContent(SITE_NAME);
    expect(preview).toHaveTextContent("Depot");
    expect(preview).toHaveTextContent("Damage");
    expect(preview).toHaveTextContent("Last source: 7 Sept 2026, Copernicus Browser");
  });

  it("opens a site in the event's side panel slot, one record at a time", async () => {
    renderMap();
    await showSites();

    fireEvent.click(pin("a"));
    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));
    expect(heading(TITLE_A)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "site s1" }));
    expect(heading(TITLE_A)).not.toBeInTheDocument();
    await act(async () => reads.findLast((r) => r.path === "/sites/s1")?.resolve(SITE));
    expect(heading(SITE_NAME)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SITE_NAME })).toHaveAttribute("href", "/sites/s1");

    fireEvent.click(pin("b"));
    expect(heading(SITE_NAME)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close detail panel" })).toHaveLength(1);
  });

  it("turns the layer on from the filter panel and counts it as an active filter", () => {
    renderMap();
    expect(screen.queryByRole("switch", { name: "Show sites" })).not.toBeInTheDocument();

    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sites" }));
    expect(sitesSwitch()).toHaveAttribute("aria-checked", "false");

    fireEvent.click(sitesSwitch());
    expect(sitesSwitch()).toHaveAttribute("aria-checked", "true");
    expect(filtersButton()).toHaveTextContent(/^Filters1/);

    // Collapsed, the count and the pill still say the layer is on.
    fireEvent.click(filtersButton());
    expect(screen.queryByRole("switch", { name: "Show sites" })).not.toBeInTheDocument();
    expect(filtersButton()).toHaveTextContent(/^Filters1/);

    fireEvent.click(screen.getByTitle("Remove filter: Sites"));
    expect(filtersButton()).not.toHaveTextContent(/^Filters1/);
    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sites" }));
    expect(sitesSwitch()).toHaveAttribute("aria-checked", "false");
  });
});
