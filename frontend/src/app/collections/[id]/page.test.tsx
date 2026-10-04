import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const replace = vi.fn();
const push = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "c1" }),
  usePathname: () => "/collections/c1",
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

// MapLibre touches `window` at module scope; the stub reports the pins and which is lit.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({
      points,
      selectedId,
    }: {
      points: unknown[];
      selectedId?: string | null;
    }) {
      return (
        <div
          data-testid="map"
          data-points={points.length}
          data-selected={selectedId ?? ""}
        />
      );
    },
}));

// The panel is covered on the map page; stubbed so the step header and the handed event are what is measured.
vi.mock("@/components/map/DetailSidePanel", () => ({
  DetailSidePanel: ({
    header,
    detail,
  }: {
    header?: ReactNode;
    detail: { title: string } | null;
  }) => (
    <div data-testid="panel">
      {header}
      <p>{detail?.title ?? "Loading..."}</p>
    </div>
  ),
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

// The page walks the cursor once and hands that sequence to the player, panel and list.
const fetchCollectionSequence = vi.fn();
const deleteCollection = vi.fn();
const reportCollection = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  fetchCollectionSequence: (id: string, signal?: AbortSignal) =>
    fetchCollectionSequence(id, signal),
  deleteCollection: (id: string) => deleteCollection(id),
  reportCollection: (id: string, body: unknown) => reportCollection(id, body),
}));

import type { Collection } from "@/lib/collections";
import type { EventListItem } from "@/types";

import CollectionPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: OWNER,
  title: "Kupiansk rail corridor",
  description: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Three days of strikes on the eastern approach." },
        ],
      },
    ],
  },
  description_text: "Three days of strikes on the eastern approach.",
  cover: [],
  tags: [],
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
  ...over,
});

const ITEMS: EventListItem[] = [
  {
    id: "e1",
    title: "Strike on the rail junction",
    status: "geolocated",
    event_date: "2026-03-14",
    event_coords: { lat: 49.71, lng: 37.616 },
    before_closed_status: null,
    conflicts: [],
    is_graphic: false,
    media: null,
    owner: OWNER,
    tags: [],
  },
  {
    id: "e2",
    title: "Damaged locomotive shed",
    status: "detected",
    event_date: "2026-03-15",
    event_coords: { lat: 49.613, lng: 37.492 },
    before_closed_status: null,
    conflicts: [],
    is_graphic: false,
    media: null,
    owner: OWNER,
    tags: [],
  },
];

/** Paths the page reads: the collection for the header, the current step's event for the panel. */
function mockReads(data: Collection) {
  useApiResource.mockImplementation((path: string | null) =>
    path?.startsWith("/events/")
      ? {
          data: { id: path.slice("/events/".length), title: `event ${path}` },
          error: null,
          loading: false,
          refetch: vi.fn(),
        }
      : { data, error: null, loading: false, refetch: vi.fn() },
  );
}

/** Render, then wait for the sequence walk: the player and list draw from it. */
async function renderPage() {
  render(<CollectionPage />);
  await screen.findByRole("heading", { name: "Kupiansk rail corridor" });
  await waitFor(() => expect(fetchCollectionSequence).toHaveBeenCalled());
}

beforeEach(() => {
  useAuth.mockReset();
  useApiResource.mockReset();
  fetchCollectionSequence.mockReset();
  deleteCollection.mockReset();
  reportCollection.mockReset();
  replace.mockReset();
  push.mockReset();
  searchParams.delete("step");
  useAuth.mockReturnValue({ user: null });
  mockReads(collection());
  fetchCollectionSequence.mockResolvedValue(ITEMS);
});

describe("CollectionPage", () => {
  it("titles itself with the collection and names its owner", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute(
      "href",
      "/profile/ana",
    );
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });

  it("prints the description whole, through the proof renderer", async () => {
    mockReads(
      collection({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Three days of " },
                { type: "text", text: "strikes", marks: [{ type: "bold" }] },
                { type: "text", text: "." },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "The eastern approach." }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    await renderPage();

    expect(screen.getByText("Description")).toBeInTheDocument();
    // Written in the proof editor, so marks and the list are painted, not flattened.
    expect(screen.getByText("strikes").tagName).toBe("STRONG");
    expect(
      screen.getByText("The eastern approach.").closest("li"),
    ).not.toBeNull();
  });

  it("counts the items and names the span they cover", async () => {
    await renderPage();

    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(screen.getByText("14 Mar 2026 to 16 Mar 2026")).toBeInTheDocument();
  });

  it("shows the tags the collection's items carry, under the meta line", async () => {
    // Derived server-side from the items.
    mockReads(
      collection({
        tags: [
          { id: "t1", name: "satellite", category: "capture_source" },
          { id: "t2", name: "rail", category: "free" },
        ],
      }),
    );

    await renderPage();

    expect(screen.getByText("satellite")).toBeInTheDocument();
    expect(screen.getByText("rail")).toBeInTheDocument();
  });

  it("says one event in the singular", async () => {
    mockReads(collection({ event_count: 1, last_date: "2026-03-14" }));
    fetchCollectionSequence.mockResolvedValue([ITEMS[0]]);

    await renderPage();

    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(await screen.findByText("1 event on the map")).toBeInTheDocument();
  });

  it("carries no cover upload and no per-row byline", async () => {
    // The header renders no mosaic, and the byline is the slot a row drops (the header names the analyst).
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });
    mockReads(
      collection({
        cover: [
          { url: "https://media.example/item.jpg", media_type: "image", role: "source" },
        ],
      }),
    );

    await renderPage();

    expect(document.querySelector("header img")).toBeNull();
    expect(document.querySelector("header video")).toBeNull();
    expect(document.querySelector("input[type=file]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /picture|cover/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^by/)).not.toBeInTheDocument();
  });

  it("maps the items' pins and lists them in order, each with its status", async () => {
    await renderPage();

    expect(await screen.findByTestId("map")).toHaveAttribute("data-points", "2");
    expect(screen.getByText("2 events on the map")).toBeInTheDocument();
    const rows = screen.getAllByRole("heading", { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual([
      "Strike on the rail junction",
      "Damaged locomotive shed",
    ]);
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    expect(screen.getByText("Detected")).toBeInTheDocument();
  });

  it("opens on the first item and lights it on the map and in the list", async () => {
    await renderPage();

    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "e1");
    expect(useApiResource).toHaveBeenCalledWith("/events/e1");
    expect(
      screen.getByRole("button", {
        name: "Read this collection from Strike on the rail junction",
      }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("opens on the step a shared link carries", async () => {
    searchParams.set("step", "2");

    await renderPage();

    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "e2");
  });

  it("clamps a step the collection does not hold", async () => {
    searchParams.set("step", "99");

    await renderPage();

    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
  });

  it("moves to the row a reader picks, and says so in the URL", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Read this collection from Damaged locomotive shed",
      }),
    );

    // `replace`, so Back leaves the page instead of walking every step.
    expect(replace).toHaveBeenCalledWith("/collections/c1?step=2", {
      scroll: false,
    });
  });

  it("carries one gesture per row: the title is plain text, not a second link", async () => {
    await renderPage();

    expect(
      screen.queryByRole("link", { name: "Strike on the rail junction" }),
    ).not.toBeInTheDocument();
    // The stretched button keeps the row's accessible name and still moves the player.
    expect(
      screen.getByRole("button", {
        name: "Read this collection from Strike on the rail junction",
      }),
    ).toBeInTheDocument();
  });

  it("offers no player for a collection with nothing on it", async () => {
    mockReads(collection({ event_count: 0, first_date: null, last_date: null }));
    fetchCollectionSequence.mockResolvedValue([]);

    await renderPage();

    await waitFor(() =>
      expect(screen.getByText("Nothing on this collection yet.")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
  });

  it("shares the collection on X for a visitor, prefilled with the title, the byline line and its url", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Share on X" }));

    expect(openMock).toHaveBeenCalledTimes(1);
    const [href, target, features] = openMock.mock.calls[0];
    const url = new URL(href as string);
    expect(url.origin).toBe("https://twitter.com");
    expect(url.pathname).toBe("/intent/tweet");
    expect(url.searchParams.get("text")).toBe(
      "Kupiansk rail corridor\nby ana · 5 events · 14 Mar 2026 to 16 Mar 2026",
    );
    expect(url.searchParams.get("url")).toBe(
      `${window.location.origin}/collections/c1`,
    );
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");

    openMock.mockRestore();
  });

  it("shares the collection on X for the owner too", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    await renderPage();

    expect(
      screen.getByRole("button", { name: "Share on X" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share on X" }));
    expect(openMock).toHaveBeenCalledTimes(1);

    openMock.mockRestore();
  });

  it("hands a visitor the report flag and no owner control", async () => {
    await renderPage();

    // Reporting works signed out.
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Drop this collection" }),
    ).not.toBeInTheDocument();
    for (const name of ["Edit this collection", "Your geolocations"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("sends the owner to their own catalogue, where an event is shelved from", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    await renderPage();

    // The owner's own events, detections included; no picker (an event joins from its own page).
    expect(
      screen.getByRole("link", { name: "Your geolocations" }),
    ).toHaveAttribute("href", "/search?type=event&author=ana");
    expect(
      screen.getByText(/An event joins a collection from its own page/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /add events/i }),
    ).not.toBeInTheDocument();
  });

  it("gives the owner Edit and Drop, and no per-item control", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });

    await renderPage();

    // Details and picker live on the edit page; the header has the two acts and no per-row control.
    expect(
      screen.getByRole("link", { name: "Edit this collection" }),
    ).toHaveAttribute("href", "/collections/c1/edit");
    expect(
      screen.getByRole("button", { name: "Drop this collection" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Remove Strike on the rail junction from this collection",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("reports the collection from the header, with no account", async () => {
    reportCollection.mockResolvedValue(undefined);

    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    // The panel names its subject so the flag is not mistaken for a report on the player's item.
    expect(screen.getByText("Report this collection")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "copyright" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(reportCollection).toHaveBeenCalledWith("c1", {
        reason: "copyright",
        details: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Report received",
    );
  });

  it("drops the collection on a second click, then lands on the profile", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });
    deleteCollection.mockResolvedValue(undefined);

    await renderPage();

    // One click arms; nothing is written.
    fireEvent.click(screen.getByRole("button", { name: "Drop this collection" }));
    expect(deleteCollection).not.toHaveBeenCalled();

    const armed = screen.getByRole("button", {
      name: "Confirm dropping this collection",
    });
    fireEvent.click(armed);

    await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith("c1"));
    // The owner lands where their other collections are.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile/ana"));
  });

  it("keeps the collection and says so when the drop fails", async () => {
    useAuth.mockReturnValue({ user: { id: "u1", username: "ana" } });
    deleteCollection.mockRejectedValue(new Error("nope"));

    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Drop this collection" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm dropping this collection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(push).not.toHaveBeenCalled();
  });
});
