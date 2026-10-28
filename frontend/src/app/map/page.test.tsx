import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapStateProvider } from "@/contexts/MapStateContext";
import { ApiError } from "@/lib/api";
import type { Site, SiteListItem } from "@/lib/sites";
import { eventDetail } from "@/test/eventDetail";

// MapLibre touches `window` at module scope. One stub stands for both dynamic imports: the map
// offers one button per pin and one that reports a viewport, counts the event points and sites it
// draws, and mounts its children; the sites layer offers one button and the preview of site s1.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({
      points,
      sites,
      onPointClick,
      onBoundsChange,
      onSelect,
      renderPreview,
      children,
    }: {
      points?: unknown[];
      sites?: unknown[];
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
          <output aria-label="event points">{points?.length}</output>
          <output aria-label="sites">{sites?.length}</output>
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
    await act(async () =>
      readOf("a").reject(new ApiError("Vidit hit a problem.", 500, null, false, { title: "Vidit hit a problem", message: "Retry in a moment.", fields: {} })),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Vidit hit a problem");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await act(async () => readOf("a").resolve(eventDetail("a", TITLE_A)));
    expect(heading(TITLE_A)).toBeInTheDocument();
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
  // The Sites pill shares the chip's name; only the pill carries a title.
  const sitesChip = () => screen.getAllByRole("button", { name: "Sites" }).find((b) => !b.title)!;
  const sitesPill = () => screen.queryByTitle("Remove filter Show: Sites");

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

  // A detection and a geolocation.
  const POINTS = [
    ["d1", 10, 30, "2026-09-01", "2026-09-02", 1],
    ["g1", 10, 30.002, "2026-09-03", "2026-09-04", 0],
  ];

  async function loadMap() {
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "report viewport" }));
    const points = reads.find((r) => r.path.startsWith("/events/points?"))!;
    await act(async () => points.resolve(POINTS));
    // The list read is debounced on the viewport.
    const list = await waitFor(() => {
      const read = reads.find((r) => r.path.startsWith("/sites?"));
      if (!read) throw new Error("no sites read yet");
      return read;
    });
    await act(async () => list.resolve([ROW]));
  }

  const drawn = () => ({
    events: Number(screen.getByRole("status", { name: "event points" }).textContent),
    sites: Number(screen.getByRole("status", { name: "sites" }).textContent),
  });
  // The button reads "Filters", the active filter count, then the point count.
  const filterCount = () => filtersButton().firstElementChild!.textContent!.replace("Filters", "");
  const chip = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
  const pills = () =>
    screen.queryAllByTitle(/^Remove filter Show: /).map((p) => p.title.replace("Remove filter Show: ", ""));

  it("previews a site from its list row", async () => {
    await loadMap();
    const preview = screen.getByTestId("site preview");
    expect(preview).toHaveTextContent(SITE_NAME);
    expect(preview).toHaveTextContent("Depot");
    expect(preview).toHaveTextContent("Damage");
    expect(preview).toHaveTextContent("Last source: 7 Sept 2026, Copernicus Browser");
  });

  it("opens a site in the event's side panel slot, one record at a time", async () => {
    await loadMap();

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

  it("shows every event and every site while no Show chip is selected", async () => {
    await loadMap();
    expect(drawn()).toEqual({ events: 2, sites: 1 });
    expect(filterCount()).toBe("");
    expect(pills()).toEqual([]);

    fireEvent.click(filtersButton());
    expect(screen.getByText(/^Zones as of/)).toBeInTheDocument();
  });

  it("hides the sites when Geolocated alone is selected", async () => {
    await loadMap();
    fireEvent.click(filtersButton());
    chip("Geolocated");

    expect(drawn()).toEqual({ events: 1, sites: 0 });
    expect(screen.queryByRole("button", { name: "site s1" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Zones as of/)).not.toBeInTheDocument();
    expect(filterCount()).toBe("1");
    expect(pills()).toEqual(["Geolocated"]);
  });

  it("hides every event when Sites alone is selected", async () => {
    await loadMap();
    fireEvent.click(filtersButton());
    fireEvent.click(sitesChip());

    expect(drawn()).toEqual({ events: 0, sites: 1 });
    expect(screen.getByText(/^Zones as of/)).toBeInTheDocument();
    expect(filterCount()).toBe("1");
    expect(pills()).toEqual(["Sites"]);

    // Collapsed, the count and the pill still say what the map shows.
    fireEvent.click(filtersButton());
    expect(filterCount()).toBe("1");
    fireEvent.click(sitesPill()!);
    expect(drawn()).toEqual({ events: 2, sites: 1 });
    expect(filterCount()).toBe("");
  });

  it("shows the sites and the named statuses when Sites is mixed with status chips", async () => {
    await loadMap();
    fireEvent.click(filtersButton());
    fireEvent.click(sitesChip());
    chip("Requested");
    // The map draws no requests, so Sites and Requested leave the sites alone.
    expect(drawn()).toEqual({ events: 0, sites: 1 });

    chip("Detected");
    expect(drawn()).toEqual({ events: 1, sites: 1 });
    expect(screen.getByText(/^Zones as of/)).toBeInTheDocument();
    expect(filterCount()).toBe("3");
    expect(pills()).toEqual(["Requested", "Detected", "Sites"]);
  });

  it("shows every event and every site again on Clear all", async () => {
    await loadMap();
    fireEvent.click(filtersButton());
    chip("Detected");
    chip("Geolocated");
    expect(drawn()).toEqual({ events: 2, sites: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(drawn()).toEqual({ events: 2, sites: 1 });
    expect(pills()).toEqual([]);
    expect(filterCount()).toBe("");
    expect(screen.getByText(/^Zones as of/)).toBeInTheDocument();
  });
});
