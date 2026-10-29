import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { openFilterGroups } from "@/test/filters";
import { pickOption } from "@/test/options";

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

beforeEach(openFilterGroups);

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
  // From lg up: the Filters header over the panel or, collapsed, the active pills. The phone bar
  // renders its own Filters button after it.
  const header = () => screen.getAllByRole("button", { name: /^Filters/ })[0];
  const desktop = () => header().parentElement!;
  const collapsedPills = () =>
    within(desktop())
      .queryAllByTitle(/^Remove filter Show: /)
      .map((p) => p.title.replace("Remove filter Show: ", ""));
  const lineValues = () =>
    within(desktop())
      .queryAllByRole("button", { name: /^Remove / })
      .map((p) => p.textContent);
  /** Toggles a Show option: a pick through the Show line's search, a removal from its pill. */
  const show = (option: string) => {
    const pill = within(desktop()).queryByRole("button", { name: `Remove ${option}` });
    if (pill) fireEvent.click(pill);
    else pickOption(within(desktop()).getByRole("combobox", { name: "Show" }), option);
  };

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
  it("previews a site from its list row", async () => {
    await loadMap();
    const preview = screen.getByTestId("site preview");
    expect(preview).toHaveTextContent(SITE_NAME);
    expect(preview).toHaveTextContent("Depot");
    expect(preview).toHaveTextContent("Damage");
    expect(preview).toHaveTextContent("Site·7 Sept 2026·Damage");
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

  it("shows every event and every site while no Show option is selected", async () => {
    await loadMap();
    expect(drawn()).toEqual({ events: 2, sites: 1 });
    expect(collapsedPills()).toEqual([]);
  });

  it("offers Show the kinds the map draws, no request", async () => {
    await loadMap();
    fireEvent.click(header());
    fireEvent.focus(within(desktop()).getByRole("combobox", { name: "Show" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Detected",
      "Geolocated",
      "Sites",
    ]);
    expect(within(desktop()).queryByRole("combobox", { name: "Location guess" })).toBeNull();
  });

  it("hides the sites when Geolocated alone is selected", async () => {
    await loadMap();
    fireEvent.click(header());
    show("Geolocated");

    expect(drawn()).toEqual({ events: 1, sites: 0 });
    expect(screen.queryByRole("button", { name: "site s1" })).not.toBeInTheDocument();
    expect(lineValues()).toEqual(["Geolocated"]);
  });

  it("hides every event when Sites alone is selected", async () => {
    await loadMap();
    fireEvent.click(header());
    show("Sites");

    expect(drawn()).toEqual({ events: 0, sites: 1 });

    // Collapsed, the pill still says what the map shows, and removes it.
    fireEvent.click(header());
    expect(collapsedPills()).toEqual(["Sites"]);
    fireEvent.click(within(desktop()).getByTitle("Remove filter Show: Sites"));
    expect(drawn()).toEqual({ events: 2, sites: 1 });
    expect(collapsedPills()).toEqual([]);
  });

  it("shows the sites and the named statuses when Sites is mixed with a status", async () => {
    await loadMap();
    fireEvent.click(header());
    show("Sites");
    show("Detected");

    expect(drawn()).toEqual({ events: 1, sites: 1 });
    fireEvent.click(header());
    expect(collapsedPills()).toEqual(["Detected", "Sites"]);
  });

  it("narrows the drawn points by the date windows, in memory", async () => {
    await loadMap();
    fireEvent.click(header());
    const [eventStart] = within(desktop()).getAllByLabelText("Event date window start date");
    fireEvent.change(eventStart, { target: { value: "2026-09-02" } });

    expect(drawn()).toEqual({ events: 1, sites: 1 });
    expect(reads.filter((r) => r.path.startsWith("/events/points?"))).toHaveLength(1);
  });

  it("shows every event and every site again on Clear all", async () => {
    await loadMap();
    fireEvent.click(header());
    show("Detected");
    show("Geolocated");
    expect(drawn()).toEqual({ events: 2, sites: 0 });

    fireEvent.click(within(desktop()).getByRole("button", { name: "Clear all" }));
    expect(drawn()).toEqual({ events: 2, sites: 1 });
    expect(lineValues()).toEqual([]);
  });

  it("opens the same panel in a sheet from the phone bar", async () => {
    await loadMap();
    fireEvent.click(screen.getAllByRole("button", { name: "Filters" }).at(-1)!);
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(within(sheet).getAllByRole("button", { name: "Play timeline" })).toHaveLength(2);
    pickOption(within(sheet).getByRole("combobox", { name: "Show" }), "Sites");
    expect(drawn()).toEqual({ events: 0, sites: 1 });
  });
});
