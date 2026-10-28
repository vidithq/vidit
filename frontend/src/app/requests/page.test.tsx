import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/requests",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const apiFetchPage = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetchPage: (path: string) => apiFetchPage(path),
}));

import type { Conflict, EventListItem, Tag } from "@/types";

import RequestsPage from "./page";

const NOW = new Date("2026-10-14T12:00:00Z");

const REQUEST: EventListItem = {
  id: "r1",
  title: "Footage wanted near Bakhmut",
  status: "requested",
  before_closed_status: null,
  requested_at: "2026-10-11T09:00:00Z",
  coords: null,
  occurred_date: null,
  is_graphic: false,
  media: null,
  owner: { id: "u1", username: "ana", avatar_url: null },
  geolocators: [],
  tags: [],
  conflicts: [],
};

const TAGS: Tag[] = [{ id: "t1", name: "Drone" }];
const CONFLICTS: Conflict[] = [
  {
    id: "c1",
    name: "Russian invasion of Ukraine",
    wikidata_id: null,
    start_year: 2022,
    end_year: null,
    is_ongoing: true,
    tier: "major",
  },
];

const lastPath = () => apiFetchPage.mock.calls.at(-1)?.[0] as string;
const lastQuery = () => new URLSearchParams(lastPath().split("?")[1]);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  useApiResource.mockImplementation((path: string | null) => ({
    data: path === "/tags" ? TAGS : path?.startsWith("/conflicts") ? CONFLICTS : null,
  }));
  apiFetchPage.mockReset();
  apiFetchPage.mockResolvedValue({ items: [REQUEST], nextCursor: null });
});

afterEach(() => {
  vi.useRealTimers();
});

const rail = () => screen.getByRole("complementary", { name: "Filters" });
const line = (name: string) => within(rail()).getByRole("button", { name });
const editor = (name: string) => screen.getByRole("dialog", { name });

describe("RequestsPage", () => {
  it("mounts the filter panel with the status locked to requested", async () => {
    render(<RequestsPage />);

    expect(await screen.findByText(REQUEST.title)).toBeInTheDocument();
    expect(within(rail()).queryByRole("button", { name: "Show" })).not.toBeInTheDocument();
    expect(within(rail()).queryByRole("switch", { name: "Approved only" })).not.toBeInTheDocument();
    for (const name of ["Conflict", "Tags", "Source kind", "Level", "Media", "Location guess", "Author"]) {
      expect(line(name)).toBeInTheDocument();
    }

    fireEvent.click(line("Source kind"));
    fireEvent.click(within(editor("Source kind")).getByRole("button", { name: "Drone" }));

    await waitFor(() => expect(lastQuery().getAll("source_kind")).toEqual(["drone"]));
    expect(lastQuery().get("view")).toBe("requested");
    expect(lastQuery().getAll("status")).toEqual(["requested"]);
  });

  it("sends the location guess as has_coords and the media as media", async () => {
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);
    expect(lastQuery().has("has_coords")).toBe(false);

    fireEvent.click(line("Location guess"));
    fireEvent.click(within(editor("Location guess")).getByRole("button", { name: "No guess" }));
    await waitFor(() => expect(lastQuery().get("has_coords")).toBe("false"));

    // Both options match every row, so the filter drops off the query.
    fireEvent.click(within(editor("Location guess")).getByRole("button", { name: "With a guess" }));
    await waitFor(() => expect(lastQuery().has("has_coords")).toBe(false));

    fireEvent.click(line("Media"));
    fireEvent.click(within(editor("Media")).getByRole("button", { name: "Video" }));
    await waitFor(() => expect(lastQuery().getAll("media")).toEqual(["video"]));
  });

  it("reads its timelines from the open requests search lists", async () => {
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);

    const datesPath = useApiResource.mock.calls
      .map(([path]) => path as string | null)
      .find((path) => path?.startsWith("/search/dates"));
    const query = new URLSearchParams(datesPath?.split("?")[1]);
    expect(query.getAll("type")).toEqual(["event"]);
    expect(query.getAll("status")).toEqual(["requested"]);
  });

  it("changes the sort through the query", async () => {
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);
    expect(lastQuery().get("sort")).toBe("newest");

    fireEvent.click(screen.getByRole("button", { name: "Oldest" }));

    await waitFor(() => expect(lastQuery().get("sort")).toBe("oldest"));
    expect(screen.getByRole("button", { name: "Oldest" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("shows how long each request has been open, from requested_at", async () => {
    apiFetchPage.mockResolvedValue({
      items: [
        REQUEST,
        { ...REQUEST, id: "r2", title: "Opened today", requested_at: "2026-10-14T08:00:00Z" },
        { ...REQUEST, id: "r3", title: "Never stamped", requested_at: null },
      ],
      nextCursor: null,
    });

    render(<RequestsPage />);

    expect(await screen.findByText("Open 3 days")).toBeInTheDocument();
    expect(screen.getByText("Open today")).toBeInTheDocument();
    expect(screen.getAllByText(/^Open /)).toHaveLength(2);
  });

  it("holds the panel in the Filters rail and opens it in a sheet below lg", async () => {
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Conflict" }));
    fireEvent.click(
      within(editor("Conflict")).getByRole("button", { name: /^Russian invasion of Ukraine/ }),
    );
    await waitFor(() =>
      expect(lastQuery().getAll("conflict")).toEqual(["Russian invasion of Ukraine"])
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Remove filter Conflict: Russian invasion of Ukraine (2022-present)"),
    ).toBeInTheDocument();
    expect(
      within(rail()).getByRole("button", { name: "Remove Russian invasion of Ukraine (2022-present)" }),
    ).toBeInTheDocument();
  });
});
