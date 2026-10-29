import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page's URL: what it reads on load and what it writes back on each change.
const nav = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/requests",
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
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
import { openFilterGroups, sheetButton } from "@/test/filters";
import { pickOption } from "@/test/options";

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

beforeEach(openFilterGroups);

beforeEach(() => {
  nav.query = "";
  nav.replace.mockReset();
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
const line = (name: string) => within(rail()).queryByRole("combobox", { name });

describe("RequestsPage", () => {
  it("mounts the filter panel with the status locked to requested", async () => {
    render(<RequestsPage />);

    expect(await screen.findByText(REQUEST.title)).toBeInTheDocument();
    expect(line("Show")).not.toBeInTheDocument();
    expect(within(rail()).queryByRole("switch", { name: "Approved only" })).not.toBeInTheDocument();
    for (const name of ["Conflict", "Tags", "Source kind", "Level", "Media", "Location guess", "Author"]) {
      expect(line(name)).toBeInTheDocument();
    }

    pickOption(line("Source kind")!, "Drone");

    await waitFor(() => expect(lastQuery().getAll("source_kind")).toEqual(["drone"]));
    expect(lastQuery().get("view")).toBe("requested");
    expect(lastQuery().getAll("status")).toEqual(["requested"]);
  });

  it("writes each filter change to the URL and reads its filters off it", async () => {
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);
    expect(nav.replace).not.toHaveBeenCalled();

    pickOption(line("Media")!, "Video");
    await waitFor(() =>
      expect(nav.replace).toHaveBeenLastCalledWith("/requests?media=video", { scroll: false }),
    );
    cleanup();

    nav.query = "tag=Drone&author=ana";
    nav.replace.mockReset();
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);
    expect(lastQuery().getAll("tag")).toEqual(["Drone"]);
    expect(lastQuery().get("author")).toBe("ana");
    expect(within(rail()).getByRole("button", { name: "Remove ana" })).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("sends the location guess as has_coords and the media as media", async () => {
    render(<RequestsPage />);
    await screen.findByText(REQUEST.title);
    expect(lastQuery().has("has_coords")).toBe(false);

    pickOption(line("Location guess")!, "No guess");
    await waitFor(() => expect(lastQuery().get("has_coords")).toBe("false"));

    // Both options match every row, so the filter drops off the query.
    pickOption(line("Location guess")!, "With a guess");
    await waitFor(() => expect(lastQuery().has("has_coords")).toBe(false));

    pickOption(line("Media")!, "Video");
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

    fireEvent.click(sheetButton());
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.focus(within(sheet).getByRole("combobox", { name: "Conflict" }));
    fireEvent.click(screen.getByRole("option", { name: /^Russian invasion of Ukraine/ }));
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
